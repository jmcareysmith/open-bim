import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  barMassPerMetre,
  createBeam,
  createFloor,
  createPadFooting,
  createRebar,
  createWall,
  ensureFoundationSlabType,
  ensureStructuralTypes,
  rebarBars,
  rebarQuantities,
  lapLength,
  type RebarParams,
  type StructuralSectionParams,
  type Vec2,
} from "@open-bim/core";
import { SimpleKernel, boundingBox, meshVolume } from "../src/index.ts";

const p = (x: number, y: number): Vec2 => ({ x, y });

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  return { doc, ids };
}

describe("rebar", () => {
  it("area reinforcement lays bars both ways inside the cover of a slab, cut by holes", () => {
    const { doc, ids } = setup();
    const slabType = doc.transact("T", (tx) => ensureFoundationSlabType(tx, doc));
    const f = doc.transact("F", (tx) =>
      createFloor(tx, slabType, ids.levels.ground, [p(0, 0), p(6000, 0), p(6000, 3000), p(0, 3000)], { holes: [[p(2000, 1000), p(2000, 2000), p(3000, 2000), p(3000, 1000)]] }),
    );
    const r = doc.transact("R", (tx) => createRebar(tx, doc, f.id, { bar: "HD12", spacing: 300, cover: 50 }));
    const bars = rebarBars(doc, r);
    // Every bar stays 50 inside the edges.
    for (const b of bars) for (const q of b.points) {
      expect(q[0]).toBeGreaterThanOrEqual(50 - 1e-6);
      expect(q[0]).toBeLessThanOrEqual(5950 + 1e-6);
      expect(q[1]).toBeGreaterThanOrEqual(50 - 1e-6);
      expect(q[1]).toBeLessThanOrEqual(2950 + 1e-6);
    }
    // No bar crosses the hole.
    for (const b of bars) {
      const a = b.points[0]!;
      const c = b.points[1]!;
      const midInHole = (x: number, y: number) => x > 2000 && x < 3000 && y > 1000 && y < 2000;
      expect(midInHole((a[0] + c[0]) / 2, (a[1] + c[1]) / 2)).toBe(false);
    }
    // Two directions at two heights, the cross bars on top of the outer ones.
    const zs = [...new Set(bars.map((b) => Math.round(b.points[0]![2])))].sort((a, b) => a - b);
    expect(zs).toHaveLength(2);
    expect(zs[1]! - zs[0]!).toBe(12);
    const q = rebarQuantities(doc, r);
    expect(q.mass).toBeCloseTo((q.length / 1000) * barMassPerMetre("HD12"), 6);
    expect(barMassPerMetre("HD12")).toBeCloseTo(0.888, 2);
  });

  it("pad footings take top and bottom mats; the mesh is solid bars", () => {
    const { doc, ids } = setup();
    const pad = doc.transact("P", (tx) => createPadFooting(tx, doc, ids.levels.ground, p(0, 0), { width: 1000, length: 1000, depth: 400, offset: 0 }));
    const r = doc.transact("R", (tx) => createRebar(tx, doc, pad.id, { layers: "both", spacing: 200, cover: 75, bar: "HD16" }));
    const bars = rebarBars(doc, r);
    // 1000 - 2x75 - 16 = 834 → 5 bars at 200 each way, per mat.
    expect(bars).toHaveLength(20);
    const m = new SimpleKernel().build(doc, r)!;
    const bb = boundingBox(m);
    // Hexagons stand on two corners: the bars reach r·sin 60 below their centres.
    const r60 = 8 * Math.sin(Math.PI / 3);
    expect(bb.min[2]).toBeCloseTo(-400 + 75 + 8 - r60, 0);
    expect(bb.max[2]).toBeCloseTo(-75 - 8 + r60, 0);
    // Hexagonal bars: volume a little under the round bar's.
    const L = rebarQuantities(doc, r).length;
    const hex = ((3 * Math.sqrt(3)) / 2) * 8 * 8;
    expect(meshVolume(m)).toBeCloseTo(hex * L, -2);
  });

  it("beam cages: corner bars inside cover and ties, ties at spacing", () => {
    const { doc, ids } = setup();
    const t = doc.transact("T", (tx) => {
      ensureStructuralTypes(tx, doc);
      return tx.create<StructuralSectionParams>("StructuralType", { shape: "rect", d: 500, b: 300, tf: 0, tw: 0 }, { name: "Concrete 300x500" }).id;
    });
    const beam = doc.transact("B", (tx) => createBeam(tx, doc, t, ids.levels.first, p(0, 0), p(4000, 0)));
    const r = doc.transact("R", (tx) => createRebar(tx, doc, beam.id, {}));
    const bars = rebarBars(doc, r);
    const longs = bars.filter((b) => !b.closed);
    const ties = bars.filter((b) => b.closed);
    expect(longs).toHaveLength(4);
    // Corner bar: cover 40 + tie 10 + 8 = 58 in from the side and bottom.
    const ys = longs.map((b) => b.points[0]![1]).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(-150 + 58);
    const zs = longs.map((b) => b.points[0]![2]).sort((a, b) => a - b);
    expect(zs[0]).toBeCloseTo(2700 - 500 + 58);
    expect(zs.at(-1)).toBeCloseTo(2700 - 58);
    // Ties every 200 within the length.
    expect(ties.length).toBe(Math.floor((4000 - 80 - 50) / 200) + 1);
    expect(ties[1]!.points[0]![0] - ties[0]!.points[0]![0]).toBeCloseTo(200);
  });
  it("walls take vertical and horizontal bars on each face, inside the cover", () => {
    const { doc, ids } = setup();
    const t = doc.byCategory("WallType")[0]!.id;
    const w = doc.transact("W", (tx) => createWall(tx, t, { x: 0, y: 0 }, { x: 4000, y: 0 }, ids.levels.ground, { height: 2400 }));
    const r = doc.transact("R", (tx) => createRebar(tx, doc, w.id, { bar: "HD12", spacing: 400, cover: 20, layers: "top" }));
    const bars = rebarBars(doc, r);
    const vertical = bars.filter((b) => b.points[0]![0] === b.points[1]![0]);
    const horizontal = bars.filter((b) => b.points[0]![2] === b.points[1]![2]);
    // (4000 − 2·26) / 400 → 10 spaces → 10 verticals; (2400 − 52) / 400 → 5 spaces → 6 horizontals.
    expect(vertical).toHaveLength(10);
    expect(horizontal).toHaveLength(6);
    // Exterior face (+y), verticals outermost.
    expect(Math.min(...vertical.map((b) => b.points[0]![1]))).toBeGreaterThan(Math.max(...horizontal.map((b) => b.points[0]![1])));
    expect(vertical.every((b) => b.points[0]![2] === 20 && b.points[1]![2] === 2380)).toBe(true);
  });
  it("cogs turn slab bar ends to the other face; long runs lap at stock length; sets get marks", () => {
    const { doc, ids } = setup();
    const slabType = doc.transact("T", (tx) => ensureFoundationSlabType(tx, doc));
    const f = doc.transact("F", (tx) => createFloor(tx, slabType, ids.levels.ground, [p(0, 0), p(20000, 0), p(20000, 3000), p(0, 3000)]));
    const r = doc.transact("R", (tx) => createRebar(tx, doc, f.id, { bar: "HD12", spacing: 300, cover: 50 }));
    expect(r.params.mark).toBe("S1");
    expect(doc.transact("R2", (tx) => createRebar(tx, doc, f.id)).params.mark).toBe("S2");
    // 20 m bars along x (19.9 m long inside the cover) lap: 12 m stock, 480 mm laps → 2 pieces.
    const along = (bars: ReturnType<typeof rebarBars>) => bars.filter((b) => Math.abs(b.points[0]![1] - b.points.at(-1)![1]) < 1 && b.points[0]![2] < 100);
    const runs = along(rebarBars(doc, r));
    const ys = new Set(runs.map((b) => Math.round(b.points[0]![1])));
    expect(runs.length).toBe(ys.size * 2);
    const first = runs.find((b) => b.points[0]![0] < 100)!;
    const second = runs.find((b) => Math.round(b.points[0]![1]) === Math.round(first.points[0]![1]) && b !== first)!;
    expect(first.points.at(-1)![0] - second.points[0]![0]).toBeCloseTo(lapLength("HD12"));
    // Cogs: each bar gains a 144 mm leg up from the bottom mat at both ends.
    doc.transact("Cogs", (tx) => tx.update<RebarParams>(r.id, { cogs: true, stockLength: 30000 }));
    const cogged = along(rebarBars(doc, doc.require(r.id) as never));
    const b = cogged[0]!;
    expect(b.points).toHaveLength(4);
    expect(b.points[0]![2] - b.points[1]![2]).toBeCloseTo(144);
  });
});
