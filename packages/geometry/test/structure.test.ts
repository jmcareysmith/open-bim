import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createBeam,
  createColumn,
  createPadFooting,
  createStripFooting,
  createWall,
  ensureStructuralTypes,
  floorPlanFor,
  type StructuralSectionParams,
} from "@open-bim/core";
import { SimpleKernel, boundingBox, meshVolume, viewDrawing } from "../src/index.ts";

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const types = doc.transact("Types", (tx) => ensureStructuralTypes(tx, doc));
  const byName = (n: string) => types.find((id) => doc.require(id).name === n)!;
  return { doc, ids, byName };
}

describe("structure", () => {
  it("columns extrude their section between levels and cut in plan", () => {
    const { doc, ids, byName } = setup();
    const c = doc.transact("C", (tx) => createColumn(tx, doc, byName("Steel SHS 100x100x4"), ids.levels.ground, ids.levels.first, { x: 1000, y: 1000 }));
    const m = new SimpleKernel().build(doc, c)!;
    const bb = boundingBox(m);
    expect(bb.max[2]).toBeCloseTo(2700);
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(100);
    // Hollow: (100² − 92²) × 2700.
    expect(meshVolume(m)).toBeCloseTo((100 * 100 - 92 * 92) * 2700, -3);
    expect(viewDrawing(doc, new SimpleKernel(), floorPlanFor(doc, ids.levels.ground)!).strokes.some((s) => s.id === c.id)).toBe(true);
  });

  it("beams hang from the level along their line; I-sections have the right area", () => {
    const { doc, ids, byName } = setup();
    const t = byName("Steel 200UB25");
    const b = doc.transact("B", (tx) => createBeam(tx, doc, t, ids.levels.first, { x: 0, y: 0 }, { x: 0, y: 5000 }));
    const m = new SimpleKernel().build(doc, b)!;
    const bb = boundingBox(m);
    expect(bb.max[2]).toBeCloseTo(2700);
    expect(bb.min[2]).toBeCloseTo(2700 - 203);
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(5000);
    const s = doc.require<StructuralSectionParams>(t).params;
    const area = 2 * s.b * s.tf + (s.d - 2 * s.tf) * s.tw;
    expect(meshVolume(m)).toBeCloseTo(area * 5000, -3);
  });

  it("pad and strip footings sit below their level / wall", () => {
    const { doc, ids } = setup();
    const pad = doc.transact("P", (tx) => createPadFooting(tx, doc, ids.levels.ground, { x: 0, y: 0 }));
    expect(boundingBox(new SimpleKernel().build(doc, pad)!).max[2]).toBeCloseTo(-100);
    const w = doc.transact("W", (tx) => createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 4000, y: 0 }, ids.levels.ground, { topLevelId: ids.levels.first }));
    const strip = doc.transact("S", (tx) => createStripFooting(tx, doc, w.id));
    const m = new SimpleKernel().build(doc, strip)!;
    expect(meshVolume(m)).toBeCloseTo(4400 * 400 * 300, -3);
    doc.transact("Del", (tx) => tx.delete(w.id));
    expect(doc.has(strip.id)).toBe(false);
  });
});
