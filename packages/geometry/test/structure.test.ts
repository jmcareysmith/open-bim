import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createBeam,
  createBrace,
  ensureFoundationSlabType,
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
  it("braces slope from the level up to the level above, section square to the axis", () => {
    const { doc, ids, byName } = setup();
    const t = byName("Steel SHS 100x100x4");
    const b = doc.transact("B", (tx) => createBrace(tx, doc, t, ids.levels.ground, { x: 0, y: 0 }, { x: 2700, y: 0 }));
    expect(b.params.brace).toBe(true);
    expect(b.params.endOffset).toBe(2700);
    const m = new SimpleKernel().build(doc, b)!;
    const bb = boundingBox(m);
    // Top of section from 100 (bottom on the level) at the start to 2700 at the end; the section
    // is square to the axis, so its bottom edge at the start dips below 100 - d by the slope.
    const L = Math.hypot(2700, 2600);
    expect(bb.min[2]).toBeCloseTo(100 - (100 * 2700) / L, 0);
    expect(bb.max[2]).toBeCloseTo(2700, 0);
    // Volume: section area x axis length.
    const area = 100 * 100 - 92 * 92;
    expect(meshVolume(m)).toBeCloseTo(area * L, -3);
  });

  it("foundation slab type is added once, 300 concrete", () => {
    const { doc } = setup();
    const a = doc.transact("T", (tx) => ensureFoundationSlabType(tx, doc));
    const b = doc.transact("T", (tx) => ensureFoundationSlabType(tx, doc));
    expect(a).toBe(b);
    expect((doc.require(a).params as { layers: { thickness: number }[] }).layers[0]!.thickness).toBe(300);
  });

  it("beams show as a dashed centreline in plans of their level only", () => {
    const { doc, ids, byName } = setup();
    const b = doc.transact("B", (tx) => createBeam(tx, doc, byName("Steel 200UB25"), ids.levels.first, { x: 0, y: 0 }, { x: 0, y: 5000 }));
    const k = new SimpleKernel();
    const lines = k.buildLines(doc, b)!;
    expect(lines.dashed).toBe(true);
    expect(lines.segments[2]).toBeCloseTo(2701);
    const first = viewDrawing(doc, k, floorPlanFor(doc, ids.levels.first)!).strokes.filter((s) => s.id === b.id && s.dashed);
    expect(first).toHaveLength(1);
    expect(first[0]!.segments).toEqual([0, 0, 0, 5000]);
    expect(viewDrawing(doc, k, floorPlanFor(doc, ids.levels.ground)!).strokes.some((s) => s.id === b.id && s.dashed)).toBe(false);
  });

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
