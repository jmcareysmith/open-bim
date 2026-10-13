import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  attachWall,
  attachedTopAt,
  createFloor,
  createWall,
  floorExtent,
  floorSlope,
  floorThickness,
  floorTopAt,
  transformElements,
  translation,
  type Floor,
  type FloorParams,
  type Vec2,
  type Wall,
} from "@open-bim/core";
import { SimpleKernel, boundingBox, meshVolume, planFrame, layerRegions } from "../src/index.ts";

const p = (x: number, y: number): Vec2 => ({ x, y });
const box = [p(0, 0), p(4000, 0), p(4000, 2000), p(0, 2000)];

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const floor = doc.transact("Floor", (tx) => createFloor(tx, ids.floorTypes.slab, ids.levels.ground, box));
  // Falls 40 mm across 4 m towards x = 4000 (1:100).
  doc.transact("Slope", (tx) => tx.update<FloorParams>(floor.id, { slope: { tail: p(0, 1000), head: p(4000, 1000), tailOffset: 0, headOffset: -40 } }));
  return { doc, ids, floor: () => doc.require(floor.id) as Floor };
}

describe("floor slope arrows", () => {
  it("tilts the top as a plane from tail to head", () => {
    const { doc, floor } = setup();
    expect(floorTopAt(doc, floor(), p(0, 0))).toBeCloseTo(0);
    expect(floorTopAt(doc, floor(), p(4000, 2000))).toBeCloseTo(-40);
    expect(floorTopAt(doc, floor(), p(2000, 500))).toBeCloseTo(-20);
    expect(floorSlope(floor())).toBeCloseTo(0.01);
    const t = floorThickness(doc, floor());
    expect(floorExtent(doc, floor())).toEqual({ top: 0, bottom: -40 - t });
  });

  it("builds a sheared slab that keeps its volume and draws the arrow in plan", () => {
    const { doc, floor } = setup();
    const k = new SimpleKernel();
    const mesh = k.build(doc, floor())!;
    const t = floorThickness(doc, floor());
    const bb = boundingBox(mesh);
    expect(bb.max[2]).toBeCloseTo(0);
    expect(bb.min[2]).toBeCloseTo(-40 - t);
    expect(meshVolume(mesh)).toBeCloseTo(4000 * 2000 * t, -3);
    const lines = k.buildLines(doc, floor())!;
    expect(lines.planOnly).toBe(true);
    expect(lines.labels[0]!.text).toBe("1:100");
  });

  it("tilts the layers with the top and moves the arrow with the floor", () => {
    const { doc, floor } = setup();
    // Cut through a section along x: layer boundaries are sloped lines, so regions are quads with uneven heights.
    const frame = { origin: [0, 1000, 0] as [number, number, number], right: [1, 0, 0] as [number, number, number], up: [0, 0, 1] as [number, number, number], dir: [0, 1, 0] as [number, number, number] };
    const t = floorThickness(doc, floor());
    const regions = layerRegions(doc, floor(), [[p(0, -t - 40), p(4000, -t - 40), p(4000, 0), p(0, 0)]], frame);
    const top = regions[0]!.loop;
    expect(Math.max(...top.filter((q) => q.x < 1).map((q) => q.y))).toBeCloseTo(0, 0);
    expect(Math.max(...top.filter((q) => q.x > 3999).map((q) => q.y))).toBeCloseTo(-40, 0);
    expect(planFrame(0).dir).toEqual([0, 0, -1]);
    doc.transact("Move", (tx) => transformElements(tx, doc, [floor().id], translation({ x: 1000, y: 0 })));
    expect(floor().params.slope!.tail).toEqual(p(1000, 1000));
    expect(floorTopAt(doc, floor(), p(5000, 0))).toBeCloseTo(-40);
  });

  it("lets a wall's top follow the sloped floor above", () => {
    const { doc, ids, floor } = setup();
    const w = doc.transact("Wall", (tx) => createWall(tx, ids.wallTypes.exterior, p(0, 1000), p(4000, 1000), ids.levels.ground, { baseOffset: -3000, height: 4000 }));
    doc.transact("Attach", (tx) => attachWall(tx, doc, w.id, "top", floor().id));
    const wall = doc.require(w.id) as Wall;
    const t = floorThickness(doc, floor());
    expect(attachedTopAt(doc, wall, p(4000, 1000))).toBeCloseTo(-40 - t);
    expect(attachedTopAt(doc, wall, p(0, 1000))).toBeCloseTo(-t);
  });
});
