import { describe, expect, it } from "vitest";
import { Document, applyResidentialTemplate, createRoof, type RoofParams, type Vec2 } from "@open-bim/core";
import { SimpleKernel, boundingBox, meshVolume } from "../src/index.ts";

const deg = (d: number) => (d * Math.PI) / 180;
const p = (x: number, y: number): Vec2 => ({ x, y });
const T = 211; // template roof type thickness
const BASE = 5400;

function roof(boundary: Vec2[], slopes?: (number | null)[]) {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const r = doc.transact("Roof", (tx) => createRoof(tx, ids.roofTypes.steel, ids.levels.roof, boundary, { slopes }));
  return new SimpleKernel().build(doc, r)!;
}

describe("roof geometry", () => {
  it("hip roof: closed solid of footprint area × thickness, ridge at the right height", () => {
    const m = roof([p(0, 0), p(10000, 0), p(10000, 6000), p(0, 6000)], Array(4).fill(deg(30)));
    expect(meshVolume(m)).toBeCloseTo(10000 * 6000 * T, -4);
    const bb = boundingBox(m);
    expect(bb.min[2]).toBeCloseTo(BASE);
    expect(bb.max[2]).toBeCloseTo(BASE + 3000 * Math.tan(deg(30)) + T, 1);
  });

  it("gable roof keeps full-height gable ends", () => {
    const m = roof([p(0, 0), p(10000, 0), p(10000, 6000), p(0, 6000)], [deg(30), null, deg(30), null]);
    expect(meshVolume(m)).toBeCloseTo(10000 * 6000 * T, -4);
    // A vertex at the gable apex.
    const top = BASE + 3000 * Math.tan(deg(30)) + T;
    let found = false;
    for (let i = 0; i < m.positions.length; i += 3) {
      if (Math.abs(m.positions[i]!) < 1e-3 && Math.abs(m.positions[i + 1]! - 3000) < 1e-3 && Math.abs(m.positions[i + 2]! - top) < 0.1) found = true;
    }
    expect(found).toBe(true);
  });

  it("L-shaped hip roof with a valley stays a closed solid", () => {
    const L = [p(0, 0), p(10000, 0), p(10000, 4000), p(4000, 4000), p(4000, 8000), p(0, 8000)];
    const m = roof(L);
    const area = 10000 * 4000 + 4000 * 4000;
    expect(meshVolume(m)).toBeCloseTo(area * T, -4);
    expect(boundingBox(m).max[2]).toBeCloseTo(BASE + 2000 * Math.tan(deg(25)) + T, 1);
  });

  it("flat roof is a slab", () => {
    const m = roof([p(0, 0), p(4000, 0), p(4000, 3000), p(0, 3000)], [null, null, null, null]);
    expect(meshVolume(m)).toBeCloseTo(4000 * 3000 * T, -4);
    expect(boundingBox(m).max[2]).toBeCloseTo(BASE + T);
  });

  it("vertical openings cut through, faced down their sides", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const r = doc.transact("Roof", (tx) => createRoof(tx, ids.roofTypes.steel, ids.levels.roof, [p(0, 0), p(10000, 0), p(10000, 6000), p(0, 6000)], { slopes: Array(4).fill(deg(30)) }));
    const k = new SimpleKernel();
    const before = meshVolume(k.build(doc, r)!);
    // A 1000 × 1000 skylight on one slope, and one straddling the hip/ridge.
    doc.transact("Openings", (tx) =>
      tx.update<RoofParams>(r.id, {
        openings: [
          [p(4000, 500), p(5000, 500), p(5000, 1500), p(4000, 1500)],
          [p(4500, 2500), p(5500, 2500), p(5500, 3500), p(4500, 3500)],
        ],
      }),
    );
    const after = meshVolume(k.build(doc, doc.require(r.id))!);
    expect(before - after).toBeCloseTo(2e6 * T, -5);
  });
});

describe("roofs on any footprint (straight skeleton)", () => {
  it("a U and an irregular plan build closed solids peaking at the skeleton's highest node", async () => {
    const { skeletonFaces } = await import("@open-bim/core");
    const area = (l: Vec2[]) => Math.abs(l.reduce((s, q, i) => s + q.x * l[(i + 1) % l.length]!.y - l[(i + 1) % l.length]!.x * q.y, 0)) / 2;
    const peak = (b: Vec2[], s: number) => {
      const f = skeletonFaces(b, b.map(() => s))!;
      let h = 0;
      f.forEach((face, e) => {
        const a = b[e]!;
        const c = b[(e + 1) % b.length]!;
        const l = Math.hypot(c.x - a.x, c.y - a.y);
        for (const q of face) h = Math.max(h, Math.tan(s) * ((-(c.y - a.y) / l) * (q.x - a.x) + ((c.x - a.x) / l) * (q.y - a.y)));
      });
      return h;
    };
    for (const b of [
      [p(0, 0), p(20000, 0), p(20000, 9000), p(14000, 9000), p(14000, 3000), p(6000, 3000), p(6000, 9000), p(0, 9000)],
      [p(0, 0), p(12000, 1000), p(13000, 7000), p(8000, 6000), p(7000, 11000), p(2000, 12000), p(3000, 6000), p(-1000, 5000)],
    ]) {
      const m = roof(b, b.map(() => deg(30)));
      expect(meshVolume(m)).toBeCloseTo(area(b) * T, -5);
      expect(boundingBox(m).max[2]).toBeCloseTo(BASE + peak(b, deg(30)) + T, 0);
    }
  });
});
