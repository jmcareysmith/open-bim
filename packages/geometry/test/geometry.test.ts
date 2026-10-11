import { describe, expect, it } from "vitest";
import { Document, applyResidentialTemplate, createFloor, createWall } from "@open-bim/core";
import { SimpleKernel, boundingBox, extrudePolygon, meshVolume, wallFootprint } from "../src/index.ts";

const square = [
  { x: 0, y: 0 },
  { x: 1000, y: 0 },
  { x: 1000, y: 1000 },
  { x: 0, y: 1000 },
];

describe("extrudePolygon", () => {
  it("produces a closed solid with correct volume", () => {
    const m = extrudePolygon(square, [], 0, 500);
    expect(meshVolume(m)).toBeCloseTo(1000 * 1000 * 500);
    expect(boundingBox(m)).toEqual({ min: [0, 0, 0], max: [1000, 1000, 500] });
  });

  it("is winding-independent", () => {
    const m = extrudePolygon([...square].reverse(), [], 0, 500);
    expect(meshVolume(m)).toBeCloseTo(5e8);
  });

  it("subtracts holes", () => {
    const hole = [
      { x: 250, y: 250 },
      { x: 750, y: 250 },
      { x: 750, y: 750 },
      { x: 250, y: 750 },
    ];
    const m = extrudePolygon(square, [hole], 0, 100);
    expect(meshVolume(m)).toBeCloseTo((1e6 - 250_000) * 100);
  });

  it("rejects invalid ranges", () => {
    expect(() => extrudePolygon(square, [], 10, 10)).toThrow();
  });
});

describe("wallFootprint", () => {
  it("is centred on the location line", () => {
    const fp = wallFootprint({ x: 0, y: 0 }, { x: 1000, y: 0 }, 100);
    const ys = fp.map((p) => p.y).sort((a, b) => a - b);
    expect(ys).toEqual([-50, -50, 50, 50]);
  });
});

describe("SimpleKernel", () => {
  it("builds walls and floors from the model", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const { wall, floor } = doc.transact("Model", (tx) => ({
      wall: createWall(tx, ids.wallTypes.interior, { x: 0, y: 0 }, { x: 4000, y: 0 }, ids.levels.ground, {
        topLevelId: ids.levels.first,
      }),
      floor: createFloor(tx, ids.floorTypes.slab, ids.levels.ground, square),
    }));
    const k = new SimpleKernel();

    const wm = k.build(doc, wall)!;
    expect(meshVolume(wm)).toBeCloseTo(4000 * 110 * 2700, -3);
    expect(boundingBox(wm).max[2]).toBe(2700);

    const fm = k.build(doc, floor)!;
    expect(boundingBox(fm).min[2]).toBe(-100);

    expect(k.build(doc, doc.require(ids.levels.ground))).toBeNull();
  });
});
