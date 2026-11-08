import { describe, expect, it } from "vitest";
import {
  Document,
  addFloorShapePoint,
  applyResidentialTemplate,
  createFloor,
  floorExtent,
  floorThickness,
  floorTopAt,
  setFloorShape,
  setSlabEdge,
  type Floor,
  type Vec2,
} from "@open-bim/core";
import { SimpleKernel, boundingBox, meshVolume } from "../src/index.ts";

const p = (x: number, y: number): Vec2 => ({ x, y });

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const f = doc.transact("F", (tx) => createFloor(tx, ids.floorTypes.slab, ids.levels.ground, [p(0, 0), p(4000, 0), p(4000, 3000), p(0, 3000)]));
  const get = () => doc.require(f.id) as Floor;
  return { doc, ids, f, get };
}

describe("floor shape editing and slab edges", () => {
  it("a drain point pulls the top down; the bottom stays flat", () => {
    const { doc, get } = setup();
    const k = new SimpleKernel();
    const t = floorThickness(doc, get());
    const flat = meshVolume(k.build(doc, get())!);
    expect(flat).toBeCloseTo(12e6 * t, -4);
    doc.transact("Drain", (tx) => addFloorShapePoint(tx, doc, get().id, p(2000, 1500), -20));
    expect(floorTopAt(doc, get(), p(2000, 1500))).toBeCloseTo(-20);
    expect(floorTopAt(doc, get(), p(1000, 750))).toBeCloseTo(-10);
    expect(floorTopAt(doc, get(), p(0, 0))).toBeCloseTo(0);
    const m = k.build(doc, get())!;
    // A pyramid-shaped dip: area × depth / 3 less concrete.
    expect(meshVolume(m)).toBeCloseTo(12e6 * t - (12e6 * 20) / 3, -4);
    const bb = boundingBox(m);
    expect(bb.min[2]).toBeCloseTo(-t);
    expect(bb.max[2]).toBeCloseTo(0);
    expect(floorExtent(doc, get())).toEqual({ top: 0, bottom: -t });
    // A raised corner, then Reset Shape.
    doc.transact("Corner", (tx) => addFloorShapePoint(tx, doc, get().id, p(4000, 3000), 30));
    expect(floorTopAt(doc, get(), p(4000, 3000))).toBeCloseTo(30);
    expect(() => doc.transact("Out", (tx) => addFloorShapePoint(tx, doc, get().id, p(9000, 0), -5))).toThrow(/on the floor/);
    doc.transact("Reset", (tx) => setFloorShape(tx, doc, get().id, null));
    expect(meshVolume(k.build(doc, get())!)).toBeCloseTo(flat, -4);
  });

  it("slab edges thicken the floor's edges", () => {
    const { doc, get } = setup();
    const k = new SimpleKernel();
    const t = floorThickness(doc, get());
    const before = meshVolume(k.build(doc, get())!);
    doc.transact("Edge", (tx) => setSlabEdge(tx, doc, get().id, { profile: "Thickening 300 x 300" }));
    const m = k.build(doc, get())!;
    const bb = boundingBox(m);
    expect(bb.min[2]).toBeCloseTo(-t - 300);
    // Stays inside the outline.
    expect(bb.min[0]).toBeCloseTo(0);
    expect(bb.max[0]).toBeCloseTo(4000);
    expect(meshVolume(m)).toBeGreaterThan(before);
    expect(() => doc.transact("Bad", (tx) => setSlabEdge(tx, doc, get().id, { profile: "Nope" }))).toThrow(/Unknown slab edge/);
  });
});
