import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createBuildingPad,
  createSubregion,
  createToposolid,
  cutFill,
  recordExistingGround,
  subregions,
  surfaceHeightAt,
  toposolidSurface,
  type BuildingPadParams,
  type Toposolid,
  type ToposolidParams,
} from "../src/index.ts";

const sq = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  // A 20 × 20 m site, level at 500 everywhere.
  const pts = sq(-5000, -5000, 25000, 25000).map((p) => ({ ...p, z: 500 }));
  const topo = doc.transact("Topo", (tx) => createToposolid(tx, doc, ids.levels.ground, sq(0, 0, 20000, 20000), pts));
  return { doc, ids, topo: () => doc.require(topo.id) as Toposolid };
}

describe("building pads", () => {
  it("grade the toposolid down to the pad's underside and report the cut", () => {
    const { doc, topo } = setup();
    expect(cutFill(doc, topo())).toEqual({ cut: 0, fill: 0 });
    // Pad top at the level (0), 300 thick: ground at 500 cut down to −300 under it.
    const pad = doc.transact("Pad", (tx) => createBuildingPad(tx, doc, sq(8000, 8000, 12000, 12000)));
    expect(pad.params.toposolidId).toBe(topo().id);
    const s = toposolidSurface(doc, topo());
    expect(surfaceHeightAt(s, { x: 10000, y: 10000 })).toBeCloseTo(-300);
    expect(surfaceHeightAt(toposolidSurface(doc, topo(), { existing: true }), { x: 10000, y: 10000 })).toBeCloseTo(500);
    const { cut, fill } = cutFill(doc, topo());
    // At least the box under the pad (16 m² × 0.8 m), plus the batters round it.
    expect(cut).toBeGreaterThan(16 * 0.8 * 0.99);
    expect(cut).toBeLessThan(16 * 0.8 * 4);
    expect(fill).toBeCloseTo(0);
    // Raise the pad above the ground: now it's fill.
    doc.transact("Raise", (tx) => tx.update<BuildingPadParams>(pad.id, { offset: 1100 }));
    expect(cutFill(doc, topo()).fill).toBeGreaterThan(16 * 0.3 * 0.99);
  });

  it("measure cut and fill against recorded existing ground (graded region)", () => {
    const { doc, topo } = setup();
    doc.transact("Record", (tx) => recordExistingGround(tx, doc, topo().id));
    // Regrade: raise every spot height by 200.
    doc.transact("Regrade", (tx) => tx.update<ToposolidParams>(topo().id, { points: topo().params.points.map((p) => ({ ...p, z: p.z + 200 })) }));
    const { cut, fill } = cutFill(doc, topo());
    expect(cut).toBeCloseTo(0);
    expect(fill).toBeCloseTo(400 * 0.2, 0);
  });

  it("subregions sit on the toposolid they're sketched in, and go with it", () => {
    const { doc, topo } = setup();
    doc.transact("Sub", (tx) => createSubregion(tx, doc, sq(1000, 1000, 4000, 3000)));
    expect(subregions(doc, topo().id)).toHaveLength(1);
    expect(() => doc.transact("Out", (tx) => createSubregion(tx, doc, sq(50000, 50000, 51000, 51000)))).toThrow(/inside a toposolid/);
    doc.transact("Delete", (tx) => tx.delete(topo().id));
    expect(subregions(doc)).toHaveLength(0);
  });
});
