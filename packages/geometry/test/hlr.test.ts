import { beforeAll, describe, expect, it } from "vitest";
import { Document, applyResidentialTemplate, createWall, createWallOpening, type Vec2 } from "@open-bim/core";
import { OcctKernel, extrudePolygon, planLinework, type MeshData } from "../src/index.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const box = (x0: number, y0: number, x1: number, y1: number, z0: number, z1: number): MeshData =>
  extrudePolygon(rect(x0, y0, x1, y1), [], z0, z1);
const range = { bottom: 0, cut: 1200 };

/** Total projected length of an element's visible linework. */
const length = (seg: number[]) => {
  let s = 0;
  for (let i = 0; i < seg.length; i += 4) s += Math.hypot(seg[i + 2]! - seg[i]!, seg[i + 3]! - seg[i + 1]!);
  return s;
};
const loopArea = (l: Vec2[]) => Math.abs(l.reduce((s, p, i) => s + p.x * l[(i + 1) % l.length]!.y - l[(i + 1) % l.length]!.x * p.y, 0) / 2);

describe("plan linework", () => {
  it("cuts a wall into one closed loop and hides everything under the cut", () => {
    const [wall] = planLinework([{ id: "w", mesh: box(0, 0, 4000, 110, 0, 2400) }], range);
    expect(wall!.cutLoops).toHaveLength(1);
    expect(wall!.cutLoops[0]).toHaveLength(4);
    expect(loopArea(wall!.cutLoops[0]!)).toBeCloseTo(4000 * 110);
    // Its bottom edges are under its own cut face; vertical edges are points in plan.
    expect(wall!.projection).toEqual([]);
  });

  it("draws a low element below the cut in full", () => {
    const [bench] = planLinework([{ id: "b", mesh: box(0, 0, 2000, 600, 0, 900) }], range);
    expect(bench!.cutLoops).toEqual([]);
    expect(length(bench!.projection)).toBeCloseTo(2 * (2000 + 600)); // top outline; bottom outline hidden by the top
  });

  it("hides the part of a slab's outline under a wall", () => {
    const out = planLinework(
      [
        { id: "slab", mesh: box(0, 0, 5000, 4000, -100, 0) },
        { id: "wall", mesh: box(2000, -500, 2110, 4500, 0, 2400) },
      ],
      range,
    );
    const slab = out.find((l) => l.id === "slab")!;
    // Top outline 2*(5000+4000), minus the two 110 mm crossings under the wall.
    expect(length(slab.projection)).toBeCloseTo(2 * (5000 + 4000) - 2 * 110, 3);
  });

  it("hides things under an overhead surface that is still below the cut", () => {
    const out = planLinework(
      [
        { id: "low", mesh: box(0, 0, 1000, 1000, 0, 300) },
        { id: "shelf", mesh: box(-100, -100, 1100, 1100, 800, 900) },
      ],
      range,
    );
    expect(out.find((l) => l.id === "low")!.projection).toEqual([]);
    expect(length(out.find((l) => l.id === "shelf")!.projection)).toBeCloseTo(4 * 1200);
  });
});

describe("plan linework from real walls", () => {
  let kernel: OcctKernel;
  beforeAll(async () => {
    kernel = await OcctKernel.create();
  }, 60_000);

  it("a door opening splits the wall's cut into two loops", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const w = doc.transact("W", (tx) => createWall(tx, ids.wallTypes.interior, { x: 0, y: 0 }, { x: 4000, y: 0 }, ids.levels.ground, { height: 2400 }));
    doc.transact("O", (tx) => createWallOpening(tx, doc, w.id, 2000, { width: 900, height: 2100 }));
    const [lw] = planLinework([{ id: w.id, mesh: kernel.build(doc, w)! }], range);
    expect(lw!.cutLoops).toHaveLength(2);
    const total = lw!.cutLoops.reduce((s, l) => s + loopArea(l), 0);
    expect(total).toBeCloseTo((4000 - 900) * 110, -1);
  });
});
