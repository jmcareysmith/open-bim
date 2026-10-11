import { describe, expect, it } from "vitest";
import {
  Cat,
  Document,
  applyResidentialTemplate,
  ceilingExtent,
  createCeiling,
  createFloor,
  isSimplePolygon,
  polygonArea,
  regionArea,
  regionFromLoops,
  validateRegion,
  type Vec2,
} from "../src/index.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

describe("sketch regions", () => {
  it("classifies the largest loop as boundary and normalises winding", () => {
    const hole = rect(1000, 1000, 2000, 2000);
    const r = regionFromLoops([hole, [...rect(0, 0, 5000, 4000)].reverse()]);
    expect(polygonArea(r.boundary)).toBeGreaterThan(0);
    expect(r.holes).toHaveLength(1);
    expect(polygonArea(r.holes[0]!)).toBeLessThan(0);
    expect(regionArea(r)).toBe(5000 * 4000 - 1000 * 1000);
  });

  it("drops a repeated closing point", () => {
    const loop = [...rect(0, 0, 1000, 1000), { x: 0, y: 0 }];
    expect(regionFromLoops([loop]).boundary).toHaveLength(4);
  });

  it("rejects self-intersecting loops", () => {
    const bowtie = [
      { x: 0, y: 0 },
      { x: 1000, y: 1000 },
      { x: 1000, y: 0 },
      { x: 0, y: 1000 },
    ];
    expect(isSimplePolygon(bowtie)).toBe(false);
    expect(() => regionFromLoops([bowtie])).toThrow(/crosses itself/);
    const spike = [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }];
    expect(isSimplePolygon(spike)).toBe(false);
  });

  it("rejects holes outside, crossing the boundary, or overlapping each other", () => {
    const outer = rect(0, 0, 5000, 5000);
    expect(() => validateRegion({ boundary: outer, holes: [rect(6000, 0, 7000, 1000)] })).toThrow(/inside the boundary/);
    expect(() => validateRegion({ boundary: outer, holes: [rect(4500, 1000, 5500, 2000)] })).toThrow(/inside the boundary/);
    expect(() =>
      validateRegion({ boundary: outer, holes: [rect(1000, 1000, 2000, 2000), rect(1500, 1500, 2500, 2500)] }),
    ).toThrow(/overlap/);
    expect(() =>
      validateRegion({ boundary: outer, holes: [rect(1000, 1000, 3000, 3000), rect(1500, 1500, 2000, 2000)] }),
    ).toThrow(/overlap/);
  });

  it("rejects loops with too few points or no area", () => {
    expect(() => regionFromLoops([])).toThrow(/no closed loops/);
    expect(() => regionFromLoops([[{ x: 0, y: 0 }, { x: 1, y: 1 }]])).toThrow(/at least 3/);
    expect(() => regionFromLoops([[{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 2000, y: 0 }]])).toThrow();
  });
});

describe("floors and ceilings from sketches", () => {
  it("floors validate their sketch", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const bad = [{ x: 0, y: 0 }, { x: 1000, y: 1000 }, { x: 1000, y: 0 }, { x: 0, y: 1000 }];
    expect(() => doc.transact("F", (tx) => createFloor(tx, ids.floorTypes.slab, ids.levels.ground, bad))).toThrow(/crosses/);
    const f = doc.transact("F", (tx) =>
      createFloor(tx, ids.floorTypes.slab, ids.levels.ground, [...rect(0, 0, 3000, 3000)].reverse()),
    );
    expect(polygonArea(f.params.boundary)).toBeGreaterThan(0);
  });

  it("ceilings sit at their offset, build upwards, and go with their level", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const c = doc.transact("C", (tx) =>
      createCeiling(tx, ids.ceilingTypes.plasterboard, ids.levels.first, rect(0, 0, 4000, 3000), {
        holes: [rect(1000, 1000, 1600, 1600)],
      }),
    );
    expect(c.params.offset).toBe(2400);
    expect(ceilingExtent(doc, c)).toEqual({ bottom: 2700 + 2400, top: 2700 + 2400 + 48 });
    expect(doc.byCategory(Cat.CeilingType)).toHaveLength(1);
    doc.transact("Delete level", (tx) => tx.delete(ids.levels.first));
    expect(doc.has(c.id)).toBe(false);
  });
});
