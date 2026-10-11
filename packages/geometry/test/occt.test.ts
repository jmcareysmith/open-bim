import { beforeAll, describe, expect, it } from "vitest";
import { Document, applyResidentialTemplate, createWall, createWallOpening, type Vec2, type Wall } from "@open-bim/core";
import { OcctKernel, SimpleKernel, boundingBox, meshVolume } from "../src/index.ts";

let kernel: OcctKernel;
beforeAll(async () => {
  kernel = await OcctKernel.create();
}, 60_000);

const p = (x: number, y: number): Vec2 => ({ x, y });

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const wall = (a: Vec2, b: Vec2) =>
    doc.transact("W", (tx) => createWall(tx, ids.wallTypes.interior, a, b, ids.levels.ground, { height: 2400 }));
  return { doc, ids, wall };
}
const T = 110; // interior wall type

describe("OcctKernel", () => {
  it("matches SimpleKernel for walls without openings", () => {
    const { doc, wall } = setup();
    const w = wall(p(0, 0), p(4000, 0));
    expect(meshVolume(kernel.build(doc, w)!)).toBeCloseTo(meshVolume(new SimpleKernel().build(doc, w)!), -3);
  });

  it("cuts a door-sized opening right through the wall", () => {
    const { doc, wall } = setup();
    const w = wall(p(0, 0), p(4000, 0));
    doc.transact("Opening", (tx) => createWallOpening(tx, doc, w.id, 2000, { width: 900, height: 2100 }));
    const m = kernel.build(doc, w)!;
    expect(meshVolume(m)).toBeCloseTo((4000 * 2400 - 900 * 2100) * T, -4);
    expect(boundingBox(m)).toEqual(boundingBox(new SimpleKernel().build(doc, w)!));
  });

  it("cuts several openings, including a window with a sill, in a mitred corner wall", () => {
    const { doc, wall } = setup();
    const a = wall(p(0, 0), p(5000, 0));
    const b = wall(p(0, 0), p(0, 4000));
    doc.transact("Openings", (tx) => {
      createWallOpening(tx, doc, a.id, 1000, { width: 800, sillHeight: 900, height: 1200 });
      createWallOpening(tx, doc, a.id, 3500, { width: 1200, height: 2100 });
    });
    const plain = meshVolume(new SimpleKernel().build(doc, a)!);
    const cut = meshVolume(kernel.build(doc, a)!);
    expect(plain - cut).toBeCloseTo((800 * 1200 + 1200 * 2100) * T, -4);
    // The joined neighbour is untouched.
    expect(meshVolume(kernel.build(doc, b)!)).toBeCloseTo(meshVolume(new SimpleKernel().build(doc, b)!), -3);
  });

  it("follows the wall when it moves", () => {
    const { doc, wall } = setup();
    const w = wall(p(0, 0), p(4000, 0));
    doc.transact("Opening", (tx) => createWallOpening(tx, doc, w.id, 2000));
    doc.transact("Move", (tx) => tx.update<Wall["params"]>(w.id, { start: p(0, 3000), end: p(4000, 3000) }));
    const m = kernel.build(doc, doc.require(w.id))!;
    expect(boundingBox(m).min[1]).toBeCloseTo(3000 - T / 2);
    expect(meshVolume(m)).toBeCloseTo((4000 * 2400 - 900 * 2100) * T, -4);
  });
});
