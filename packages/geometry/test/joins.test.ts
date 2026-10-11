import { describe, expect, it } from "vitest";
import { Cat, Document, applyResidentialTemplate, createWall, type LayeredTypeParams, type Vec2, type Wall } from "@open-bim/core";
import { SimpleKernel, boundingBox, joinedWallFootprint, meshVolume, signedArea } from "../src/index.ts";

const H = 2400;

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const types = doc.transact("Types", (tx) => {
    const t = (thickness: number) =>
      tx.create<LayeredTypeParams>(Cat.WallType, { layers: [{ function: "structure", material: "Concrete", thickness }] }).id;
    return { t100: t(100), t200: t(200) };
  });
  const wall = (a: Vec2, b: Vec2, type = types.t100) =>
    doc.transact("Wall", (tx) => createWall(tx, type, a, b, ids.levels.ground, { height: H }));
  return { doc, wall, types };
}

const p = (x: number, y: number): Vec2 => ({ x, y });
const area = (doc: Document, w: Wall) => Math.abs(signedArea(joinedWallFootprint(doc, w)));
const volume = (doc: Document, walls: Wall[]) => {
  const k = new SimpleKernel();
  return walls.reduce((v, w) => v + meshVolume(k.build(doc, w)!), 0);
};

describe("joined wall footprints", () => {
  it("leaves free walls rectangular", () => {
    const { doc, wall } = setup();
    const w = wall(p(0, 0), p(1000, 0));
    expect(joinedWallFootprint(doc, w)).toEqual([p(1000, -50), p(1000, 50), p(0, 50), p(0, -50)]);
  });

  it("mitres an L corner so the walls meet without overlap", () => {
    const { doc, wall } = setup();
    const a = wall(p(0, 0), p(1000, 0));
    const b = wall(p(0, 0), p(0, 1000));
    const fp = joinedWallFootprint(doc, a);
    expect(fp).toContainEqual(p(-50, -50)); // outer corner
    expect(fp).toContainEqual(p(50, 50)); // inner corner
    // Union of the two 100-wide arms incl. the corner square, no double counting.
    expect(volume(doc, [a, b])).toBeCloseTo((1050 * 100 * 2 - 100 * 100) * H, -2);
    expect(boundingBox(new SimpleKernel().build(doc, b)!).min).toEqual([-50, -50, 0]);
  });

  it("mitres walls of different thickness consistently", () => {
    const { doc, wall, types } = setup();
    const a = wall(p(0, 0), p(1000, 0));
    const b = wall(p(0, 1000), p(0, 0), types.t200);
    // Union of [-100,1000]x[-50,50] and [-100,100]x[-50,1000]
    expect(volume(doc, [a, b])).toBeCloseTo((1100 * 100 + 200 * 1050 - 200 * 100) * H, -2);
  });

  it("stops a tee stem at the face of the through wall", () => {
    const { doc, wall } = setup();
    const through = wall(p(0, 0), p(2000, 0));
    const stem = wall(p(1000, 1000), p(1000, 0)); // drawn to the centreline
    expect(area(doc, stem)).toBeCloseTo(950 * 100);
    expect(area(doc, through)).toBeCloseTo(2000 * 100);
    expect(boundingBox(new SimpleKernel().build(doc, stem)!).min[1]).toBeCloseTo(50);
  });

  it("extends a stem drawn short of the centreline to the face", () => {
    const { doc, wall } = setup();
    wall(p(0, 0), p(2000, 0));
    const stem = wall(p(1000, -1000), p(1000, -40));
    expect(area(doc, stem)).toBeCloseTo(950 * 100);
  });

  it("splits an X junction of four wall ends into wedges", () => {
    const { doc, wall } = setup();
    const arms = [p(1000, 0), p(0, 1000), p(-1000, 0), p(0, -1000)].map((q) => wall(p(0, 0), q));
    for (const a of arms) expect(area(doc, a)).toBeCloseTo(950 * 100 + 2500);
    expect(volume(doc, arms)).toBeCloseTo((2 * 2000 * 100 - 100 * 100) * H, -2);
  });

  it("joins three wall ends at a T junction without overlap", () => {
    const { doc, wall } = setup();
    const left = wall(p(0, 0), p(-1000, 0));
    const right = wall(p(0, 0), p(1000, 0));
    const stem = wall(p(0, 0), p(0, 1000));
    expect(volume(doc, [left, right, stem])).toBeCloseTo((2000 * 100 + 950 * 100) * H, -2);
  });

  it("keeps collinear walls square-ended", () => {
    const { doc, wall } = setup();
    const a = wall(p(0, 0), p(1000, 0));
    wall(p(1000, 0), p(2000, 0));
    expect(area(doc, a)).toBeCloseTo(1000 * 100);
  });
});

