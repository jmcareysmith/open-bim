import type { Document } from "../document.ts";
import type { ElementId, Vec2 } from "../element.ts";
import { Cat, totalThickness, type LayeredTypeParams, type LevelParams, type Wall, type WallParams } from "./architecture.ts";

// Wall joins are derived from geometry, not stored: wall ends that meet, or a wall end that
// runs into the side of another wall, join automatically (Revit's default behaviour).

export type WallEnd = "start" | "end";
export const WALL_ENDS: readonly WallEnd[] = ["start", "end"];

/** How one end of a wall meets other walls. */
export type WallJoin =
  /** Other wall ends meeting at the same point: two walls = L, three or more = T/X junction. */
  | { kind: "corner"; others: { wallId: ElementId; end: WallEnd }[] }
  /** This end butts into the side of another wall (the stem of a T). */
  | { kind: "tee"; wallId: ElementId };

/** Wall ends closer than this (mm) meet. */
export const JOIN_TOLERANCE = 1;
/** Search radius when a wall's type is gone (only during regeneration of deleted walls). */
const UNKNOWN_HALF_THICKNESS = 500;
/** Walls closer to parallel than this (sine of angle) don't form a tee. */
const PARALLEL_SIN = 1e-3;

export function wallEndPoint(wall: Wall, end: WallEnd): Vec2 {
  return end === "start" ? wall.params.start : wall.params.end;
}

/** Unit vector from start to end. */
export function wallDirection(wall: Wall): Vec2 {
  const { start, end } = wall.params;
  const len = Math.hypot(end.x - start.x, end.y - start.y);
  return { x: (end.x - start.x) / len, y: (end.y - start.y) / len };
}

/** How each end of `wall` joins its neighbours. */
export function wallJoins(doc: Document, wall: Wall): Record<WallEnd, WallJoin | null> {
  const others = joinCandidates(doc, wall);
  return { start: joinAt(doc, wall, "start", others), end: joinAt(doc, wall, "end", others) };
}

/**
 * Walls whose joined geometry may change when `wall` changes: walls it joins, plus walls that
 * tee into it. Errs on the side of including too many — extra regeneration is harmless.
 */
export function relatedWalls(doc: Document, wall: Wall): ElementId[] {
  const others = joinCandidates(doc, wall);
  const out = new Set<ElementId>();
  for (const end of WALL_ENDS) {
    const j = joinAt(doc, wall, end, others);
    if (j?.kind === "corner") for (const o of j.others) out.add(o.wallId);
    else if (j) out.add(j.wallId);
  }
  const half = halfThickness(doc, wall) ?? UNKNOWN_HALF_THICKNESS;
  for (const o of others) {
    for (const end of WALL_ENDS) {
      if (teeDistance(wallEndPoint(o, end), wallDirection(o), wall, half) !== null) out.add(o.id);
    }
  }
  return [...out];
}

// ---- internals -------------------------------------------------------------

/** True if this end of the wall has Disallow Join set. */
export function joinDisallowed(wall: Wall, end: WallEnd): boolean {
  return !!wall.params.disallowJoin?.[end];
}

function joinAt(doc: Document, wall: Wall, end: WallEnd, others: Wall[]): WallJoin | null {
  if (joinDisallowed(wall, end)) return null;
  const p = wallEndPoint(wall, end);
  const meeting: { wallId: ElementId; end: WallEnd }[] = [];
  for (const o of others) {
    for (const e of WALL_ENDS) {
      if (joinDisallowed(o, e)) continue;
      const q = wallEndPoint(o, e);
      if (Math.hypot(q.x - p.x, q.y - p.y) <= JOIN_TOLERANCE) meeting.push({ wallId: o.id, end: e });
    }
  }
  if (meeting.length) return { kind: "corner", others: meeting };

  const dir = wallDirection(wall);
  let best: Wall | null = null;
  let bestDist = Infinity;
  for (const o of others) {
    const d = teeDistance(p, dir, o, halfThickness(doc, o) ?? UNKNOWN_HALF_THICKNESS);
    if (d !== null && d < bestDist) {
      best = o;
      bestDist = d;
    }
  }
  return best ? { kind: "tee", wallId: best.id } : null;
}

/**
 * Distance from `p` to `target`'s location line if `p` lies within the target's thickness and
 * clear of its ends, for a wall running in direction `dir`. Null if it doesn't tee.
 */
function teeDistance(p: Vec2, dir: Vec2, target: Wall, half: number): number | null {
  const { start } = target.params;
  const u = wallDirection(target);
  const len = Math.hypot(target.params.end.x - start.x, target.params.end.y - start.y);
  const rx = p.x - start.x;
  const ry = p.y - start.y;
  const along = rx * u.x + ry * u.y;
  if (along <= JOIN_TOLERANCE || along >= len - JOIN_TOLERANCE) return null;
  const off = Math.abs(rx * u.y - ry * u.x);
  if (off > half + JOIN_TOLERANCE) return null;
  if (Math.abs(dir.x * u.y - dir.y * u.x) < PARALLEL_SIN) return null;
  return off;
}

/** Other walls that overlap `wall` vertically (walls on different storeys never join). */
function joinCandidates(doc: Document, wall: Wall): Wall[] {
  const range = zRange(doc, wall);
  return doc.byCategory<WallParams>(Cat.Wall).filter((o) => {
    if (o.id === wall.id) return false;
    const r = zRange(doc, o);
    if (!range || !r) return true;
    return Math.min(range[1], r[1]) > Math.max(range[0], r[0]);
  });
}

function halfThickness(doc: Document, wall: Wall): number | null {
  const type = wall.typeId ? doc.get<LayeredTypeParams>(wall.typeId) : undefined;
  return type ? totalThickness(type) / 2 : null;
}

/** Like `wallExtent`, but null instead of throwing when a level is missing. */
function zRange(doc: Document, wall: Wall): [number, number] | null {
  const p = wall.params;
  const base = doc.get<LevelParams>(p.baseLevelId);
  if (!base) return null;
  const bottom = base.params.elevation + p.baseOffset;
  if (!p.topLevelId) return [bottom, bottom + p.height];
  const top = doc.get<LevelParams>(p.topLevelId);
  return top ? [bottom, top.params.elevation + p.topOffset] : null;
}
