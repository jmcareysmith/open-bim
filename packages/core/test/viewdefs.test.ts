import { describe, expect, it } from "vitest";
import {
  Cat,
  DEFAULT_VIEW_RANGE,
  Document,
  applyResidentialTemplate,
  create3DView,
  createFloorPlan,
  createLevel,
  createBuildingElevations,
  createCallout,
  createSection,
  toViewCoords,
  viewCrop,
  viewFrame,
  ensureDefaultViews,
  floorPlanFor,
  renameView,
  viewRange,
  views,
  type LevelParams,
  type ViewParams,
} from "../src/index.ts";

describe("view elements", () => {
  it("the template creates a floor plan per level and a 3D view", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    expect(views(doc).map((v) => [v.params.kind, v.name])).toEqual([
      ["floorPlan", "Ground Floor"],
      ["floorPlan", "First Floor"],
      ["floorPlan", "Roof"],
      ["3d", "{3D}"],
    ]);
    expect(floorPlanFor(doc, ids.levels.first)!.params.range).toEqual(DEFAULT_VIEW_RANGE);
  });

  it("plan range follows the level and its offsets", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const plan = floorPlanFor(doc, ids.levels.first)!;
    expect(viewRange(doc, plan)).toEqual({ bottom: 2700, cut: 3900 });
    doc.transact("Range", (tx) =>
      tx.update<ViewParams>(plan.id, { range: { top: 2300, cut: 1500, bottom: 0, depth: -300 } }),
    );
    doc.transact("Raise", (tx) => tx.update<LevelParams>(ids.levels.first, { elevation: 3000 }));
    expect(viewRange(doc, doc.require(plan.id))).toEqual({ bottom: 2700, cut: 4500 });
  });

  it("plans go with their level; names are unique per kind", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const plan = floorPlanFor(doc, ids.levels.roof)!;
    doc.transact("Delete level", (tx) => tx.delete(ids.levels.roof));
    expect(doc.has(plan.id)).toBe(false);

    const second = doc.transact("Dup", (tx) => createFloorPlan(tx, doc, ids.levels.ground));
    expect(second.name).toBe("Ground Floor (2)");
    expect(() => doc.transact("R", (tx) => renameView(tx, doc, second.id, "Ground Floor"))).toThrow(/already called/);
    expect(() => doc.transact("3D", (tx) => create3DView(tx, doc))).toThrow(/already exists/);
  });

  it("rejects inverted view ranges", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    expect(() =>
      doc.transact("P", (tx) => createFloorPlan(tx, doc, ids.levels.ground, { name: "Bad", range: { top: 1000, cut: 1200, bottom: 0, depth: 0 } })),
    ).toThrow(/bottom ≤ cut/);
    expect(() =>
      doc.transact("P", (tx) => createFloorPlan(tx, doc, ids.levels.ground, { name: "Bad", range: { top: 2300, cut: 1200, bottom: 0, depth: 100 } })),
    ).toThrow(/depth/);
  });

  it("fills in views for older documents", () => {
    const doc = new Document();
    doc.transact("Levels", (tx) => {
      createLevel(tx, "L1", 0);
      createLevel(tx, "L2", 3000);
    });
    const created = doc.transact("Views", (tx) => ensureDefaultViews(tx, doc));
    expect(created.map((v) => v.name)).toEqual(["L1", "L2", "{3D}"]);
    expect(doc.transact("Again", (tx) => ensureDefaultViews(tx, doc))).toEqual([]);
    expect(doc.byCategory(Cat.View)).toHaveLength(3);
  });
});

describe("sections, elevations and callouts", () => {
  it("sections look to the left of their line; view coords put depth beyond the cut negative", () => {
    const doc = new Document();
    applyResidentialTemplate(doc);
    const s = doc.transact("S", (tx) => createSection(tx, doc, { x: 0, y: 2000 }, { x: 10000, y: 2000 }));
    expect(s.name).toBe("Section 1");
    const f = viewFrame(s);
    expect(f.dir).toEqual([-0, 1, 0]);
    // A point 3 m beyond the line (north), 1.5 m along it, 2 m up.
    expect(toViewCoords(f, [1500, 5000, 2000])).toEqual([1500, 2000, -3000]);
    expect(viewCrop(s)).toEqual({ min: { x: 0, y: -1000 }, max: { x: 10000, y: 5400 + 3000 } });
    expect(doc.transact("S2", (tx) => createSection(tx, doc, { x: 0, y: 0 }, { x: 0, y: 1000 })).name).toBe("Section 2");
  });

  it("building elevations face the building from all four sides", () => {
    const doc = new Document();
    applyResidentialTemplate(doc);
    const els = doc.transact("E", (tx) => createBuildingElevations(tx, doc, { x: 0, y: 0 }, { x: 10000, y: 8000 }));
    expect(els.map((e) => e.name)).toEqual(["South", "East", "North", "West"]);
    const centre: [number, number, number] = [5000, 4000, 0];
    for (const e of els) expect(toViewCoords(viewFrame(e), centre)[2]).toBeLessThan(0); // building is beyond the line
    expect(doc.transact("Again", (tx) => createBuildingElevations(tx, doc, { x: 0, y: 0 }, { x: 1, y: 1 }))).toEqual([]);
  });

  it("callouts crop a floor plan and go with it", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const plan = floorPlanFor(doc, ids.levels.ground)!;
    const c = doc.transact("C", (tx) => createCallout(tx, doc, plan.id, { x: 3000, y: 2000 }, { x: 1000, y: 4000 }));
    expect(c.params.crop).toEqual({ min: { x: 1000, y: 2000 }, max: { x: 3000, y: 4000 } });
    expect(c.params.scale).toBe(20);
    expect(viewRange(doc, c)).toEqual(viewRange(doc, plan));
    expect(() => doc.transact("Bad", (tx) => createCallout(tx, doc, c.id, { x: 0, y: 0 }, { x: 500, y: 500 }))).toThrow(/floor plans/);
    doc.transact("Delete plan", (tx) => tx.delete(plan.id));
    expect(doc.has(c.id)).toBe(false);
  });

  it("validates lines and crops", () => {
    const doc = new Document();
    applyResidentialTemplate(doc);
    expect(() => doc.transact("S", (tx) => createSection(tx, doc, { x: 0, y: 0 }, { x: 50, y: 0 }))).toThrow(/100 mm/);
    expect(() =>
      doc.transact("S", (tx) => createSection(tx, doc, { x: 0, y: 0 }, { x: 5000, y: 0 }, { zRange: { bottom: 10, top: 0 } })),
    ).toThrow(/Crop top/);
  });
});
