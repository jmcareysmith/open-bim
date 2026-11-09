import { describe, expect, it } from "vitest";
import {
  Cat,
  Document,
  applyResidentialTemplate,
  createMaterial,
  createWall,
  createWallOpening,
  flipWall,
  splitElement,
  wallJoins,
  type LayeredTypeParams,
  type Vec2,
  type Wall,
  type WallParams,
} from "@open-bim/core";
import { cleanCuts, joinedWallFootprint, planFrame, signedArea, subtractCoincident, type PlanLinework } from "../src/index.ts";

const p = (x: number, y: number): Vec2 => ({ x, y });

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const types = doc.transact("Types", (tx) => {
    const gib = createMaterial(tx, doc, "Lining").id;
    const timber = createMaterial(tx, doc, "Framing").id;
    const lined = tx.create<LayeredTypeParams>(Cat.WallType, {
      layers: [
        { function: "finish1", material: "Lining", materialId: gib, thickness: 10 },
        { function: "structure", material: "Framing", materialId: timber, thickness: 90 },
        { function: "finish1", material: "Lining", materialId: gib, thickness: 10 },
      ],
    }).id;
    const t100 = tx.create<LayeredTypeParams>(Cat.WallType, { layers: [{ function: "structure", material: "Framing", materialId: timber, thickness: 100 }] }).id;
    const t200 = tx.create<LayeredTypeParams>(Cat.WallType, { layers: [{ function: "structure", material: "Framing", materialId: timber, thickness: 200 }] }).id;
    return { lined, t100, t200, timber, gib };
  });
  const wall = (a: Vec2, b: Vec2, type = types.lined) => doc.transact("Wall", (tx) => createWall(tx, type, a, b, ids.levels.ground, { height: 2400 }));
  return { doc, wall, types };
}

// Cut loops straight from the joined footprints (what the plan cut of each wall's mesh gives).
const linework = (doc: Document, walls: Wall[]): PlanLinework[] =>
  walls.map((w) => ({ id: w.id, cutLoops: [joinedWallFootprint(doc, w)], projection: [], surface: [] }));
const area = (l: Vec2[]) => Math.abs(signedArea(l));
const hasSegment = (segs: number[], a: Vec2, b: Vec2, tol = 0.5) => {
  for (let i = 0; i < segs.length; i += 4) {
    const s = p(segs[i]!, segs[i + 1]!);
    const e = p(segs[i + 2]!, segs[i + 3]!);
    const near = (u: Vec2, v: Vec2) => Math.hypot(u.x - v.x, u.y - v.y) < tol;
    if ((near(s, a) && near(e, b)) || (near(s, b) && near(e, a))) return true;
  }
  return false;
};
/** Total length of segments lying on the line y = c between x0 and x1. */
const lengthOnY = (segs: number[], c: number, x0: number, x1: number) => {
  let len = 0;
  for (let i = 0; i < segs.length; i += 4) {
    if (Math.abs(segs[i + 1]! - c) > 0.5 || Math.abs(segs[i + 3]! - c) > 0.5) continue;
    const lo = Math.max(x0, Math.min(segs[i]!, segs[i + 2]!));
    const hi = Math.min(x1, Math.max(segs[i]!, segs[i + 2]!));
    if (hi > lo) len += hi - lo;
  }
  return len;
};

describe("wall join cleanup in plan", () => {
  it("runs a tee stem's core through the through wall's lining to its core", () => {
    const { doc, wall, types } = setup();
    const through = wall(p(0, 0), p(2000, 0)); // lining faces at y = ±55, core faces at ±45
    const stem = wall(p(1000, 0), p(1000, 1000));
    const cuts = cleanCuts(doc, linework(doc, [through, stem]), planFrame(1200), true, true);
    const sc = cuts.get(stem.id)!.regions!.filter((r) => r.materialId === types.timber);
    const tc = cuts.get(through.id)!.regions!;
    // Stem core reaches the through wall's core face (y = 45), not just its face (y = 55).
    expect(Math.min(...sc.flatMap((r) => r.loop.map((q) => q.y)))).toBeCloseTo(45);
    // The through wall's lining on that side is cut where the stem core passes: 2000 − 90 long.
    const lining = tc.filter((r) => r.materialId === types.gib && r.loop.every((q) => q.y >= 44.9));
    expect(lining.reduce((s, r) => s + area(r.loop), 0)).toBeCloseTo((2000 - 90) * 10);
    // Core meets core with no line between them; lining meets lining with none either.
    const through45 = tc.filter((r) => r.materialId === types.timber).flatMap((r) => r.lines);
    expect(lengthOnY(through45, 45, 955, 1045)).toBeCloseTo(0);
    expect(lengthOnY(through45, 45, 0, 900)).toBeCloseTo(900);
    // The heavy outline runs round both walls without a line across the joint.
    expect(lengthOnY(cuts.get(through.id)!.lines, 55, 945, 1055)).toBeCloseTo(0);
    expect(lengthOnY(cuts.get(stem.id)!.lines, 55, 945, 1055)).toBeCloseTo(0);
  });

  it("drops the mitre line at an L corner of walls of the same type", () => {
    const { doc, wall } = setup();
    const a = wall(p(0, 0), p(1000, 0));
    const b = wall(p(0, 1000), p(0, 0));
    const cuts = cleanCuts(doc, linework(doc, [a, b]), planFrame(1200), true, true);
    const fp = joinedWallFootprint(doc, a);
    // The mitre runs between the inner and outer corners; neither outline draws it.
    const inner = fp.find((q) => q.x > 0 && q.x < 100 && q.y > 0)!;
    const outer = fp.find((q) => q.x < 0 && q.y < 0)!;
    expect(hasSegment(cuts.get(a.id)!.lines, inner, outer)).toBe(false);
    expect(hasSegment(cuts.get(b.id)!.lines, inner, outer)).toBe(false);
    // Unjoined faces still draw.
    expect(cuts.get(a.id)!.lines.length).toBeGreaterThan(0);
  });

  it("cleans crossing walls: the thicker wall runs through", () => {
    const { doc, wall, types } = setup();
    const thick = wall(p(0, 0), p(2000, 0), types.t200);
    const thin = wall(p(1000, -1000), p(1000, 1000), types.t100);
    const cuts = cleanCuts(doc, linework(doc, [thick, thin]), planFrame(1200), false, true);
    const thinLoops = cuts.get(thin.id)!.loops;
    expect(thinLoops).toHaveLength(2);
    expect(thinLoops.reduce((s, l) => s + area(l), 0)).toBeCloseTo((2000 - 200) * 100);
    expect(cuts.get(thick.id)!.loops.reduce((s, l) => s + area(l), 0)).toBeCloseTo(2000 * 200);
    // No line across the thick wall where the thin one passes; none of the thin wall's ends there.
    expect(lengthOnY(cuts.get(thick.id)!.lines, 100, 950, 1050)).toBeCloseTo(0);
    expect(lengthOnY(cuts.get(thin.id)!.lines, 100, 950, 1050)).toBeCloseTo(0);
  });

  it("leaves sections and walls that don't meet alone", () => {
    const { doc, wall } = setup();
    const a = wall(p(0, 0), p(1000, 0));
    const b = wall(p(0, 500), p(1000, 500));
    const lw = linework(doc, [a, b]);
    const cuts = cleanCuts(doc, lw, planFrame(1200), true, true);
    expect(cuts.get(a.id)!.lines).toHaveLength(16);
    expect(cuts.get(a.id)!.regions).toHaveLength(3);
  });

  it("removes only the coincident part of a segment", () => {
    expect(subtractCoincident([0, 0, 100, 0], [40, 0, 60, 0.2])).toEqual([0, 0, 40, 0, 60, 0, 100, 0]);
    expect(subtractCoincident([0, 0, 100, 0], [40, 5, 60, 5])).toEqual([0, 0, 100, 0]);
  });
});

describe("disallow join", () => {
  it("keeps a disallowed end square and unjoined", () => {
    const { doc, wall } = setup();
    const a = wall(p(0, 0), p(1000, 0));
    const b = wall(p(0, 0), p(0, 1000));
    expect(wallJoins(doc, a).start?.kind).toBe("corner");
    doc.transact("Disallow", (tx) => tx.update<WallParams>(a.id, { disallowJoin: { start: true } }));
    const a2 = doc.require(a.id) as Wall;
    expect(wallJoins(doc, a2).start).toBeNull();
    // The other wall doesn't join to it either.
    expect(wallJoins(doc, doc.require(b.id) as Wall).start).toBeNull();
    expect(joinedWallFootprint(doc, a2)).toContainEqual(p(0, -55));
  });

  it("follows the wall through Flip and Split", () => {
    const { doc, wall } = setup();
    const a = wall(p(0, 0), p(1000, 0));
    doc.transact("Disallow", (tx) => tx.update<WallParams>(a.id, { disallowJoin: { start: true } }));
    doc.transact("Flip", (tx) => flipWall(tx, doc, a.id));
    expect((doc.require(a.id) as Wall).params.disallowJoin).toEqual({ start: false, end: true });
    const second = doc.transact("Split", (tx) => splitElement(tx, doc, a.id, p(500, 0)));
    expect((doc.require(a.id) as Wall).params.disallowJoin).toEqual({ start: false, end: false });
    expect((doc.require(second) as Wall).params.disallowJoin).toEqual({ start: false, end: true });
    expect(wallJoins(doc, doc.require(a.id) as Wall).end?.kind).toBe("corner");
  });

  it("wraps the finish layers round free ends when the type asks", () => {
    const { doc, wall, types } = setup();
    const w = wall(p(0, 0), p(2000, 0));
    const regionAt = (q: Vec2) => {
      const cuts = cleanCuts(doc, linework(doc, [doc.require(w.id) as Wall]), planFrame(1200), true, true);
      return cuts.get(w.id)!.regions!.find((r) => pointIn(q, r.loop));
    };
    // Unwrapped: the framing runs to the end.
    expect(regionAt(p(5, 0))!.materialId).toBe(types.timber);
    doc.transact("Wrap", (tx) => tx.update<LayeredTypeParams>(types.lined, { wrapEnds: "exterior" }));
    // Wrapped: the lining turns the corner, 10 deep across the end; the framing stops short.
    expect(regionAt(p(5, 0))!.materialId).toBe(types.gib);
    expect(regionAt(p(15, 0))!.materialId).toBe(types.timber);
    expect(regionAt(p(1995, 0))!.materialId).toBe(types.gib);
  });

  it("wraps the finish layers into door jambs when the plan cuts the door", () => {
    const { doc, wall, types } = setup();
    const w = wall(p(0, 0), p(3000, 0));
    doc.transact("Opening", (tx) => createWallOpening(tx, doc, w.id, 1500, { width: 900, sillHeight: 0, height: 2100 }));
    const regionAt = (q: Vec2, cut = 1200) => {
      const cuts = cleanCuts(doc, linework(doc, [doc.require(w.id) as Wall]), planFrame(cut), true, true);
      return cuts.get(w.id)!.regions!.find((r) => pointIn(q, r.loop));
    };
    doc.transact("Wrap", (tx) => tx.update<LayeredTypeParams>(types.lined, { wrapInserts: "exterior" }));
    // Jamb at u = 1050: the exterior half (+y) is lining 10 deep; the interior half stays framing.
    expect(regionAt(p(1045, 20))!.materialId).toBe(types.gib);
    expect(regionAt(p(1045, -20))!.materialId).toBe(types.timber);
    expect(regionAt(p(1955, 20))!.materialId).toBe(types.gib);
    expect(regionAt(p(1030, 20))!.materialId).toBe(types.timber);
    // A plan cut above the head doesn't pass through the opening: no wrap.
    expect(regionAt(p(1045, 20), 2300)!.materialId).toBe(types.timber);
  });
});

function pointIn(q: Vec2, poly: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
