import { describe, expect, it } from "vitest";
import { Cat, Document, applyResidentialTemplate, boundaryFromWalls, createWall, polygonArea, wallLineOffset, type LayeredTypeParams, type Vec2, type Wall } from "../src/index.ts";

const p = (x: number, y: number): Vec2 => ({ x, y });

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  // 10 lining, 90 framing, 10 lining (110 thick).
  const type = doc.transact("Type", (tx) =>
    tx.create<LayeredTypeParams>(Cat.WallType, {
      layers: [
        { function: "finish1", material: "Cladding", thickness: 10 },
        { function: "structure", material: "Framing", thickness: 90 },
        { function: "finish2", material: "Lining", thickness: 10 },
      ],
    }),
  ).id;
  const wall = (a: Vec2, b: Vec2) => doc.transact("Wall", (tx) => createWall(tx, type, a, b, ids.levels.ground, { height: 2400 }));
  return { doc, wall };
}

/** A 4000 × 3000 box drawn clockwise, so exteriors face out. */
function box(wall: (a: Vec2, b: Vec2) => Wall) {
  return [wall(p(0, 0), p(0, 3000)), wall(p(0, 3000), p(4000, 3000)), wall(p(4000, 3000), p(4000, 0)), wall(p(4000, 0), p(0, 0))];
}

const xs = (l: Vec2[]) => [Math.min(...l.map((q) => q.x)), Math.max(...l.map((q) => q.x))];

describe("pick walls", () => {
  it("measures the wall's faces and core faces from its location line", () => {
    const { doc, wall } = setup();
    const w = wall(p(0, 0), p(1000, 0));
    expect(wallLineOffset(doc, w, "exterior")).toBe(55);
    expect(wallLineOffset(doc, w, "coreExterior")).toBe(45);
    expect(wallLineOffset(doc, w, "centre")).toBe(0);
    expect(wallLineOffset(doc, w, "coreInterior")).toBe(-45);
    expect(wallLineOffset(doc, w, "interior")).toBe(-55);
  });

  it("follows the interior faces of a box of walls, picked in any order", () => {
    const { doc, wall } = setup();
    const [a, b, c, d] = box(wall);
    const loop = boundaryFromWalls(doc, [c!.id, a!.id, d!.id, b!.id], "interior");
    expect(loop).toHaveLength(4);
    expect(polygonArea(loop)).toBeCloseTo(3890 * 2890);
    expect(xs(loop)).toEqual([55, 3945]);
  });

  it("uses exterior faces, the centreline and an outward offset", () => {
    const { doc, wall } = setup();
    const ids = box(wall).map((w) => w.id);
    expect(polygonArea(boundaryFromWalls(doc, ids, "exterior"))).toBeCloseTo(4110 * 3110);
    expect(polygonArea(boundaryFromWalls(doc, ids, "centre"))).toBeCloseTo(4000 * 3000);
    // Roof overhang: 600 out from the exterior face.
    expect(xs(boundaryFromWalls(doc, ids, "exterior", 600))).toEqual([-655, 4655]);
    expect(xs(boundaryFromWalls(doc, ids, "interior", -45))).toEqual([100, 3900]);
  });

  it("handles a wall that runs past the corner and a wall split in two", () => {
    const { doc, wall } = setup();
    const ids = [
      wall(p(-1000, 0), p(-1000, 3000)).id, // runs from below y = 0 ... see next wall
      wall(p(-1000, 3000), p(2000, 3000)).id,
      wall(p(2000, 3000), p(4000, 3000)).id, // split top wall
      wall(p(4000, 3000), p(4000, -1000)).id, // runs past the bottom wall
      wall(p(4000, 0), p(-1000, 0)).id,
    ];
    const loop = boundaryFromWalls(doc, ids, "centre");
    expect(loop).toHaveLength(4);
    expect(polygonArea(loop)).toBeCloseTo(5000 * 3000);
  });

  it("refuses walls that don't close a loop", () => {
    const { doc, wall } = setup();
    const ids = [wall(p(0, 0), p(0, 3000)).id, wall(p(0, 3000), p(4000, 3000)).id];
    expect(() => boundaryFromWalls(doc, ids)).toThrow(/at least three/);
    const far = [...ids, wall(p(20000, 0), p(20000, 3000)).id];
    expect(() => boundaryFromWalls(doc, far)).toThrow();
  });
});
