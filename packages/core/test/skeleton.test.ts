import { describe, expect, it } from "vitest";
import { skeletonFaces, type Vec2 } from "../src/index.ts";

const p = (x: number, y: number): Vec2 => ({ x, y });
const deg = (d: number) => (d * Math.PI) / 180;
const area = (l: Vec2[]) => Math.abs(l.reduce((s, q, i) => s + q.x * l[(i + 1) % l.length]!.y - l[(i + 1) % l.length]!.x * q.y, 0)) / 2;
const sum = (faces: Vec2[][]) => faces.reduce((s, f) => s + (f.length ? area(f) : 0), 0);

describe("weighted straight skeleton", () => {
  it("hips a rectangle: two trapezoids and two triangles meeting on a ridge", () => {
    const b = [p(0, 0), p(10000, 0), p(10000, 6000), p(0, 6000)];
    const f = skeletonFaces(b, b.map(() => deg(30)))!;
    expect(f).not.toBeNull();
    expect(f.map((x) => x.length)).toEqual([4, 3, 4, 3]);
    expect(area(f[0]!)).toBeCloseTo(((10000 + 4000) / 2) * 3000, 0);
    expect(area(f[1]!)).toBeCloseTo((6000 * 3000) / 2, 0);
    expect(sum(f)).toBeCloseTo(60e6, -1);
  });

  it("gables a rectangle: two halves, no faces on the gable ends", () => {
    const b = [p(0, 0), p(10000, 0), p(10000, 6000), p(0, 6000)];
    const f = skeletonFaces(b, [deg(30), null, deg(30), null])!;
    expect(f[1]).toEqual([]);
    expect(area(f[0]!)).toBeCloseTo(30e6, -1);
    expect(area(f[2]!)).toBeCloseTo(30e6, -1);
  });

  it("handles a pyramid, an L and a cross", () => {
    const sq = [p(0, 0), p(6000, 0), p(6000, 6000), p(0, 6000)];
    expect(sum(skeletonFaces(sq, sq.map(() => deg(25)))!)).toBeCloseTo(36e6, -1);
    const L = [p(0, 0), p(10000, 0), p(10000, 4000), p(4000, 4000), p(4000, 9000), p(0, 9000)];
    expect(sum(skeletonFaces(L, L.map(() => deg(30)))!)).toBeCloseTo(10000 * 4000 + 4000 * 5000, -1);
    const plus = [p(4, 0), p(8, 0), p(8, 4), p(12, 4), p(12, 8), p(8, 8), p(8, 12), p(4, 12), p(4, 8), p(0, 8), p(0, 4), p(4, 4)].map((q) => p(q.x * 1000, q.y * 1000));
    const f = skeletonFaces(plus, plus.map(() => deg(30)))!;
    expect(f).not.toBeNull();
    expect(sum(f)).toBeCloseTo(80e6, -1);
  });

  it("splits an irregular plan where a reflex corner meets a far edge", () => {
    // A wide U whose arms are long and close: the inner corners run into the base edge's wavefront.
    const U = [p(0, 0), p(20000, 0), p(20000, 9000), p(14000, 9000), p(14000, 3000), p(6000, 3000), p(6000, 9000), p(0, 9000)];
    const f = skeletonFaces(U, U.map(() => deg(30)))!;
    expect(f).not.toBeNull();
    expect(sum(f)).toBeCloseTo(20000 * 9000 - 8000 * 6000, -1);
    // An irregular eight-sided plan with mixed slopes.
    const odd = [p(0, 0), p(12000, 1000), p(13000, 7000), p(8000, 6000), p(7000, 11000), p(2000, 12000), p(3000, 6000), p(-1000, 5000)];
    const g = skeletonFaces(odd, odd.map((_, i) => deg(i % 2 ? 25 : 35)))!;
    expect(g).not.toBeNull();
    expect(sum(g)).toBeCloseTo(area(odd), -2);
  });
});

describe("skeleton heights agree", () => {
  const check = (b: Vec2[], slopes: (number | null)[]) => {
    const f = skeletonFaces(b, slopes)!;
    expect(f).not.toBeNull();
    const n = b.length;
    const heights = new Map<string, number[]>();
    f.forEach((face, e) => {
      const s = slopes[e];
      if (!face.length || s === null || s === undefined) return;
      const a = b[e]!;
      const c = b[(e + 1) % n]!;
      const l = Math.hypot(c.x - a.x, c.y - a.y);
      const nrm = { x: -(c.y - a.y) / l, y: (c.x - a.x) / l };
      for (const q of face) {
        const h = Math.tan(s) * (nrm.x * (q.x - a.x) + nrm.y * (q.y - a.y));
        expect(h).toBeGreaterThan(-1e-3);
        const k = `${Math.round(q.x)},${Math.round(q.y)}`;
        heights.set(k, [...(heights.get(k) ?? []), h]);
      }
    });
    for (const hs of heights.values()) for (const h of hs) expect(Math.abs(h - hs[0]!)).toBeLessThan(1);
  };
  it("on every face meeting at a node", () => {
    const U = [p(0, 0), p(20000, 0), p(20000, 9000), p(14000, 9000), p(14000, 3000), p(6000, 3000), p(6000, 9000), p(0, 9000)];
    check(U, U.map(() => deg(30)));
    const odd = [p(0, 0), p(12000, 1000), p(13000, 7000), p(8000, 6000), p(7000, 11000), p(2000, 12000), p(3000, 6000), p(-1000, 5000)];
    check(odd, odd.map((_, i) => deg(i % 2 ? 25 : 35)));
    const plus = [p(4, 0), p(8, 0), p(8, 4), p(12, 4), p(12, 8), p(8, 8), p(8, 12), p(4, 12), p(4, 8), p(0, 8), p(0, 4), p(4, 4)].map((q) => p(q.x * 1000, q.y * 1000));
    check(plus, plus.map(() => deg(30)));
    const L = [p(0, 0), p(10000, 0), p(10000, 4000), p(4000, 4000), p(4000, 9000), p(0, 9000)];
    check(L, [deg(30), null, deg(30), deg(30), null, deg(30)]);
  });
});
