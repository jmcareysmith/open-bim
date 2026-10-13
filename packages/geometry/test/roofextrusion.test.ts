import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  attachedTopAt,
  attachWall,
  createExtrusionRoof,
  createRoof,
  createWall,
  setRoofExtrusion,
  type RoofParams,
  type Vec2,
  type Wall,
} from "@open-bim/core";
import { SimpleKernel, boundingBox, meshVolume } from "../src/index.ts";

const deg = (d: number) => (d * Math.PI) / 180;
const p = (x: number, y: number): Vec2 => ({ x, y });
const T = 211; // template roof type thickness
const BASE = 5400;

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  return { doc, ids };
}

describe("roof by extrusion", () => {
  it("a gable profile across the short side, extruded along the long one", () => {
    const { doc, ids } = setup();
    const r = doc.transact("Roof", (tx) => createExtrusionRoof(tx, ids.roofTypes.steel, ids.levels.roof, p(0, 0), p(6000, 10000), { pitch: deg(30) }));
    const e = r.params.extrusion!;
    expect(e.dir).toEqual({ x: 1, y: 0 });
    expect(e.end - e.start).toBe(10000);
    const m = new SimpleKernel().build(doc, r)!;
    // Vertical thickness T over the 6000 width, 10000 long.
    expect(meshVolume(m)).toBeCloseTo(6000 * 10000 * T, -4);
    const bb = boundingBox(m);
    expect(bb.max[2]).toBeCloseTo(BASE + 3000 * Math.tan(deg(30)) + T, 1);
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(10000, 3);
    // Walls attach to its underside.
    const w = doc.transact("Wall", (tx) => createWall(tx, ids.wallTypes.interior, p(3000, 1000), p(3000, 9000), ids.levels.first, { topLevelId: ids.levels.roof })) as Wall;
    doc.transact("Attach", (tx) => attachWall(tx, doc, w.id, "top", r.id));
    expect(attachedTopAt(doc, doc.require(w.id) as Wall, p(3000, 5000))).toBeCloseTo(BASE + 3000 * Math.tan(deg(30)), 3);
    expect(attachedTopAt(doc, doc.require(w.id) as Wall, p(1500, 5000))).toBeCloseTo(BASE + 1500 * Math.tan(deg(30)), 3);
  });

  it("curved and edited profiles; bad profiles are refused", () => {
    const { doc, ids } = setup();
    const r = doc.transact("Roof", (tx) => createExtrusionRoof(tx, ids.roofTypes.steel, ids.levels.roof, p(0, 0), p(12000, 4000), { shape: "curved", rise: 800 }));
    // Across y this time (4000 wide), extruded along x.
    expect(r.params.extrusion!.dir).toEqual({ x: 0, y: 1 });
    const bb = boundingBox(new SimpleKernel().build(doc, r)!);
    expect(bb.max[2]).toBeCloseTo(BASE + 800 + T, 0);
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(12000, 3);
    const e = r.params.extrusion!;
    expect(() => doc.transact("Bad", (tx) => setRoofExtrusion(tx, doc, r.id, { ...e, profile: [p(0, 0), p(0, 100)] }))).toThrow(/x increasing/);
    doc.transact("Mono", (tx) => setRoofExtrusion(tx, doc, r.id, { ...e, profile: [p(-300, 0), p(4300, 1000)] }));
    expect((doc.require(r.id).params as RoofParams).boundary.map((q) => q.y)).toEqual([-300, 4300, 4300, -300]);
  });

  it("fascias, gutters and soffits run along the eaves", () => {
    const { doc, ids } = setup();
    const r = doc.transact("Roof", (tx) => createRoof(tx, ids.roofTypes.steel, ids.levels.roof, [p(0, 0), p(10000, 0), p(10000, 6000), p(0, 6000)], { slopes: [deg(25), null, deg(25), null] }));
    const plain = new SimpleKernel().build(doc, r)!;
    doc.transact("Trims", (tx) => tx.update<RoofParams>(r.id, { trims: { fascia: "Fascia 185 x 25", gutter: "Gutter - Quad 125", soffit: 450 } }));
    const m = new SimpleKernel().build(doc, doc.require(r.id))!;
    expect(meshVolume(m)).toBeGreaterThan(meshVolume(plain));
    const bb = boundingBox(m);
    // Gutters stand 25 + 125 out from the eaves (y), none on the gable ends (x).
    expect(bb.min[1]).toBeCloseTo(-150, 3);
    expect(bb.max[1]).toBeCloseTo(6150, 3);
    // Extrusion roofs get them at both profile ends.
    const x = doc.transact("Roof", (tx) => createExtrusionRoof(tx, ids.roofTypes.steel, ids.levels.roof, p(20000, 0), p(26000, 10000)));
    doc.transact("Trims", (tx) => tx.update<RoofParams>(x.id, { trims: { fascia: "Fascia 185 x 25" } }));
    const xb = boundingBox(new SimpleKernel().build(doc, doc.require(x.id))!);
    expect(xb.min[0]).toBeCloseTo(20000 - 25, 3);
    expect(xb.max[0]).toBeCloseTo(26000 + 25, 3);
  });
});
