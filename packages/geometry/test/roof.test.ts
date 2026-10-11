import { describe, expect, it } from "vitest";
import { Document, applyResidentialTemplate, createRoof, type Vec2 } from "@open-bim/core";
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
});
