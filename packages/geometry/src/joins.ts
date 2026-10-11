import {
  wallDirection,
  wallEndPoint,
  wallJoins,
  wallThickness,
  type Document,
  type Vec2,
  type Wall,
  type WallEnd,
  type WallJoin,
} from "@open-bim/core";

/** Mitre points further than this many half-thicknesses from the joint are squared off (very acute angles). */
const MITRE_LIMIT = 10;

/** One wall end seen from the joint: `a` points from the joint into the wall. */
interface EndFrame {
  p: Vec2;
  a: Vec2;
  /** Half thickness, mm. */
  h: number;
}

interface Line {
  p: Vec2;
  d: Vec2;
}

const perp = (v: Vec2): Vec2 => ({ x: -v.y, y: v.x });
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

/** Intersection of two infinite lines, or null if (nearly) parallel. */
function intersect(l1: Line, l2: Line): Vec2 | null {
  const den = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((l2.p.x - l1.p.x) * l2.d.y - (l2.p.y - l1.p.y) * l2.d.x) / den;
  return { x: l1.p.x + l1.d.x * t, y: l1.p.y + l1.d.y * t };
}

function frame(doc: Document, wall: Wall, end: WallEnd): EndFrame {
  const d = wallDirection(wall);
  return {
    p: wallEndPoint(wall, end),
    a: end === "start" ? d : { x: -d.x, y: -d.y },
    h: wallThickness(doc, wall) / 2,
  };
}

/** Wall face line on the left (+1) or right (−1) of the frame's direction. */
function face(f: EndFrame, s: 1 | -1): Line {
  const n = perp(f.a);
  return { p: { x: f.p.x + n.x * f.h * s, y: f.p.y + n.y * f.h * s }, d: f.a };
}

/** Where face `s` of `f` meets `line`; falls back to a square end if parallel or too far. */
function meet(f: EndFrame, s: 1 | -1, line: Line, limit: number): Vec2 {
  const own = face(f, s);
  const x = intersect(own, line);
  return x && dist(x, f.p) <= limit ? x : own.p;
}

/**
 * Plan footprint of a wall with its ends cleaned up against joined walls:
 * L corners mitre, T stems stop at the through wall's face, and junctions of three or
 * more wall ends are split into wedges around the joint. Neighbouring walls compute
 * matching cut points, so joined footprints tile without overlaps or gaps.
 */
export function joinedWallFootprint(doc: Document, wall: Wall): Vec2[] {
  const joins = wallJoins(doc, wall);
  // Each cap runs from its frame's left face to its right face; end then start gives a CCW loop.
  return [...endCap(doc, wall, "end", joins.end), ...endCap(doc, wall, "start", joins.start)];
}

function endCap(doc: Document, wall: Wall, end: WallEnd, join: WallJoin | null): Vec2[] {
  const f = frame(doc, wall, end);
  if (!join) return [face(f, 1).p, face(f, -1).p];

  if (join.kind === "tee") {
    const target = doc.require(join.wallId) as Wall;
    const u = wallDirection(target);
    const n = perp(u);
    const s = n.x * f.a.x + n.y * f.a.y >= 0 ? 1 : -1; // side of the target this wall runs off
    const ht = wallThickness(doc, target) / 2;
    const { start } = target.params;
    const targetFace: Line = { p: { x: start.x + n.x * ht * s, y: start.y + n.y * ht * s }, d: u };
    const limit = MITRE_LIMIT * Math.max(f.h, ht);
    return [meet(f, 1, targetFace, limit), meet(f, -1, targetFace, limit)];
  }

  const frames = [f, ...join.others.map((o) => frame(doc, doc.require(o.wallId) as Wall, o.end))];
  const base = Math.atan2(f.a.y, f.a.x);
  const rel = (g: EndFrame) => {
    const r = (Math.atan2(g.a.y, g.a.x) - base) % (2 * Math.PI);
    return r < 0 ? r + 2 * Math.PI : r;
  };
  const sorted = [...frames].sort((g1, g2) => rel(g1) - rel(g2)); // stable: f stays first
  const ccw = sorted[1]!;
  const cw = sorted[sorted.length - 1]!;
  const limit = MITRE_LIMIT * Math.max(...frames.map((g) => g.h));
  const left = meet(f, 1, face(ccw, -1), limit);
  const right = meet(f, -1, face(cw, 1), limit);
  return frames.length === 2 ? [left, right] : [left, f.p, right];
}
