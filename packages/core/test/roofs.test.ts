import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROOF_SLOPE,
  Document,
  applyResidentialTemplate,
  createRoof,
  normaliseFootprint,
  roofBaseElevation,
  roofHeightAt,
  roofPlanes,
  type Vec2,
} from "../src/index.ts";

const deg = (d: number) => (d * Math.PI) / 180;
const p = (x: number, y: number): Vec2 => ({ x, y });
const rect = (w: number, d: number) => [p(0, 0), p(w, 0), p(w, d), p(0, d)];
const t30 = Math.tan(deg(30));

describe("roof surface", () => {
  it("hips a rectangle: ridge at half the depth, hip ends", () => {
    const b = rect(10000, 6000);
    const planes = roofPlanes(b, b.map(() => deg(30)));
    expect(roofHeightAt(planes, p(5000, 3000))).toBeCloseTo(3000 * t30);
    expect(roofHeightAt(planes, p(3000, 3000))).toBeCloseTo(3000 * t30); // ridge runs 3000..7000
    expect(roofHeightAt(planes, p(1000, 3000))).toBeCloseTo(1000 * t30); // hip end
    expect(roofHeightAt(planes, p(5000, 0))).toBeCloseTo(0);
  });

  it("gables edges without a slope", () => {
    const b = rect(10000, 6000);
    const planes = roofPlanes(b, [deg(30), null, deg(30), null]);
    expect(roofHeightAt(planes, p(0, 3000))).toBeCloseTo(3000 * t30); // ridge reaches the gable
    expect(roofHeightAt(planes, p(10000, 1500))).toBeCloseTo(1500 * t30);
  });

  it("forms a valley at an L-shaped re-entrant corner", () => {
    // Wings 4000 wide: ridges along y = 2000 and x = 2000, valley from (4000,4000) to (2000,2000).
    const L = [p(0, 0), p(10000, 0), p(10000, 4000), p(4000, 4000), p(4000, 8000), p(0, 8000)];
    const planes = roofPlanes(L, L.map(() => deg(30)));
    expect(roofHeightAt(planes, p(7000, 2000))).toBeCloseTo(2000 * t30);
    expect(roofHeightAt(planes, p(2000, 6000))).toBeCloseTo(2000 * t30);
    expect(roofHeightAt(planes, p(3000, 3000))).toBeCloseTo(1000 * t30); // on the valley
    expect(roofHeightAt(planes, p(2000, 3000))).toBeCloseTo(2000 * t30); // wing ridge, not the far eave
    expect(roofHeightAt(planes, p(6000, 3500))).toBeCloseTo(500 * t30);
  });

  it("is flat when no edge defines a slope", () => {
    const b = rect(4000, 3000);
    expect(roofHeightAt(roofPlanes(b, [null, null, null, null]), p(2000, 1500))).toBe(0);
  });
});

describe("roof elements", () => {
  it("default to 25° on every edge and sit on their level", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const r = doc.transact("Roof", (tx) => createRoof(tx, ids.roofTypes.steel, ids.levels.roof, rect(8000, 6000), { baseOffset: -100 }));
    expect(r.params.slopes).toEqual([DEFAULT_ROOF_SLOPE, DEFAULT_ROOF_SLOPE, DEFAULT_ROOF_SLOPE, DEFAULT_ROOF_SLOPE]);
    expect(roofBaseElevation(doc, r)).toBe(5300);
    doc.transact("Delete level", (tx) => tx.delete(ids.levels.roof));
    expect(doc.has(r.id)).toBe(false);
  });

  it("reverses a clockwise footprint, keeping slopes on the same physical edges", () => {
    // CW rectangle: edge 0 = (0,0)→(0,6000) is the west side, a gable.
    const cw = [p(0, 0), p(0, 6000), p(10000, 6000), p(10000, 0)];
    const { boundary, slopes } = normaliseFootprint(cw, [null, deg(30), null, deg(30)]);
    const westIndex = boundary.findIndex((q, i) => {
      const r = boundary[(i + 1) % 4]!;
      return q.x === 0 && r.x === 0;
    });
    expect(slopes[westIndex]).toBeNull();
    expect(slopes.filter((s) => s === null)).toHaveLength(2);
  });

  it("rejects mismatched or out-of-range slopes and crossing footprints", () => {
    expect(() => normaliseFootprint(rect(1000, 1000), [deg(30)])).toThrow(/one slope/);
    expect(() => normaliseFootprint(rect(1000, 1000), [deg(95), null, null, null])).toThrow(/between/);
    const bowtie = [p(0, 0), p(1000, 1000), p(1000, 0), p(0, 1000)];
    expect(() => normaliseFootprint(bowtie, [null, null, null, null])).toThrow(/crosses/);
  });
});
