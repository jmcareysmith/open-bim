import { describe, expect, it } from "vitest";
import { fromShared, toShared, type SiteLocation } from "../src/index.ts";

describe("shared coordinates", () => {
  const loc: SiteLocation = { epsg: 2193, eastings: 1756000, northings: 5920000, height: 12.5, rotation: Math.PI / 2 };
  it("map project points to NZTM metres and back", () => {
    expect(toShared(loc, { x: 0, y: 0, z: 0 })).toEqual({ e: 1756000, n: 5920000, h: 12.5 });
    // Project north turned 90° anticlockwise from grid north: project +X points grid north.
    const q = toShared(loc, { x: 10000, y: 0, z: 2700 });
    expect(q.e).toBeCloseTo(1756000);
    expect(q.n).toBeCloseTo(5920010);
    expect(q.h).toBeCloseTo(15.2);
    const p = fromShared(loc, q);
    expect(p.x).toBeCloseTo(10000);
    expect(p.y).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(2700);
  });
});
