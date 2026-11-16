import { describe, expect, it } from "vitest";
import {
  Document,
  activeWorkset,
  applyResidentialTemplate,
  createWall,
  createWorkset,
  deleteWorkset,
  effectiveGraphics,
  elementGraphics,
  enableWorksetAssignment,
  enableWorksets,
  floorPlanFor,
  setActiveWorkset,
  worksets,
  type View,
} from "../src/index.ts";

describe("worksets", () => {
  it("enabling puts walls in Workset1 and levels in Shared Levels and Grids; new walls join the active one; views hide worksets", () => {
    const doc = new Document();
    enableWorksetAssignment(doc);
    const ids = applyResidentialTemplate(doc);
    const w0 = doc.transact("W", (tx) => createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 4000, y: 0 }, ids.levels.ground, { height: 2400 }));
    const { main, datums } = doc.transact("On", (tx) => enableWorksets(tx, doc));
    expect(doc.require<{ worksetId: string }>(w0.id).params.worksetId).toBe(main);
    expect(doc.require<{ worksetId: string }>(ids.levels.ground).params.worksetId).toBe(datums);
    expect(activeWorkset(doc)).toBe(main);
    const site = doc.transact("WS", (tx) => createWorkset(tx, doc, "Site"));
    setActiveWorkset(doc, site.id);
    const w1 = doc.transact("W", (tx) => createWall(tx, ids.wallTypes.exterior, { x: 0, y: 3000 }, { x: 4000, y: 3000 }, ids.levels.ground, { height: 2400 }));
    expect(doc.require<{ worksetId: string }>(w1.id).params.worksetId).toBe(site.id);
    const plan = floorPlanFor(doc, ids.levels.ground)! as View;
    doc.transact("Hide", (tx) => tx.update(plan.id, { hiddenWorksets: [site.id] }));
    const g = effectiveGraphics(doc, doc.require(plan.id) as View);
    expect(elementGraphics(doc, g, doc.require(w1.id)).visible).toBe(false);
    expect(elementGraphics(doc, g, doc.require(w0.id)).visible).toBe(true);
    doc.transact("Del", (tx) => deleteWorkset(tx, doc, site.id, main));
    expect(doc.require<{ worksetId: string }>(w1.id).params.worksetId).toBe(main);
    expect(worksets(doc).map((w) => w.name).sort()).toEqual(["Shared Levels and Grids", "Workset1"]);
  });
});

describe("workset default visibility", () => {
  it("new views hide worksets that aren't visible by default", async () => {
    const { createSection } = await import("../src/index.ts");
    const doc = new Document();
    enableWorksetAssignment(doc);
    applyResidentialTemplate(doc);
    doc.transact("On", (tx) => enableWorksets(tx, doc));
    const ws = doc.transact("WS", (tx) => createWorkset(tx, doc, "Furniture"));
    doc.transact("Off", (tx) => tx.update(ws.id, { visibleByDefault: false }));
    const s = doc.transact("S", (tx) => createSection(tx, doc, { x: 0, y: 0 }, { x: 5000, y: 0 }));
    expect(doc.require<{ hiddenWorksets?: string[] }>(s.id).params.hiddenWorksets).toEqual([ws.id]);
  });
});
