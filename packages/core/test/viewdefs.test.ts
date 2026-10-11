import { describe, expect, it } from "vitest";
import {
  Cat,
  DEFAULT_VIEW_RANGE,
  Document,
  applyResidentialTemplate,
  create3DView,
  createFloorPlan,
  createLevel,
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
