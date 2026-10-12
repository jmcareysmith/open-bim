import { beforeAll, describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  attachWall,
  createRoof,
  createWall,
  createWindow,
  roofBaseElevation,
  wallThickness,
  type Vec2,
  type Wall,
} from "@open-bim/core";
import { OcctKernel, SimpleKernel, boundingBox, meshVolume } from "../src/index.ts";

const box: Vec2[] = [
  { x: 0, y: 0 },
  { x: 8000, y: 0 },
  { x: 8000, y: 6000 },
  { x: 0, y: 6000 },
];
const SLOPE = (25 * Math.PI) / 180;

let occt: OcctKernel;
beforeAll(async () => {
  occt = await OcctKernel.create();
}, 60_000);

function gableWall() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  // One free-standing gable-end wall under a gable roof whose ridge runs along X.
  const wall = doc.transact("W", (tx) => createWall(tx, ids.wallTypes.interior, { x: 4000, y: 0 }, { x: 4000, y: 6000 }, ids.levels.ground, { height: 2400 })) as Wall;
  const roof = doc.transact("R", (tx) => createRoof(tx, ids.roofTypes.steel, ids.levels.ground, box, { slopes: [SLOPE, null, SLOPE, null], baseOffset: 2400 }));
  doc.transact("A", (tx) => attachWall(tx, doc, wall.id, "top", roof.id));
  return { doc, ids, wall: doc.require(wall.id) as Wall, roof };
}

describe("walls attached under sloped roofs", () => {
  it("SimpleKernel: a closed gable shape up to the ridge", () => {
    const { doc, wall, roof } = gableWall();
    const mesh = new SimpleKernel().build(doc, wall)!;
    const t = wallThickness(doc, wall);
    const rise = 3000 * Math.tan(SLOPE);
    const bb = boundingBox(mesh);
    expect(bb.max[2]).toBeCloseTo(roofBaseElevation(doc, roof as never) + rise, 0);
    // Rectangle 6000 × 2400 plus the gable triangle, through the thickness.
    const expected = (6000 * 2400 + 0.5 * 6000 * rise) * t;
    expect(meshVolume(mesh) / expected).toBeCloseTo(1, 2);
  });

  it("OcctKernel: still cuts a window out of the sloped wall", () => {
    const { doc, ids, wall } = gableWall();
    const before = meshVolume(occt.build(doc, wall)!);
    doc.transact("Win", (tx) => createWindow(tx, doc, ids.windowTypes.w1200x1200, wall.id, 3000));
    const after = meshVolume(occt.build(doc, wall)!);
    expect(after).toBeLessThan(before * 0.95);
    expect(boundingBox(occt.build(doc, wall)!).max[2]).toBeGreaterThan(3500);
  });
});
