import polygonClipping, { type MultiPolygon, type Polygon, type Ring } from "polygon-clipping";
import {
  Cat,
  formatArea,
  projectUnits,
  roomExtent,
  wallExtent,
  type Document,
  type Element,
  type Room,
  type RoomSeparatorParams,
  areaBoundariesIn,
  type Area,
  type AreaScheme,
  type ElementId,
  type LevelParams,
  type Vec2,
  type Wall,
  type WallParams,
} from "@open-bim/core";
import type { LineData } from "./datums.ts";
import { joinedWallFootprint } from "./joins.ts";

// Room boundaries: the free space left after removing room-bounding walls (their joined
// footprints, so boundaries run along finish faces) and room separation lines from the plan,
// and the region of it that contains the room's point.

/** Revit's room computation height: walls are tested at this height above the room's base. */
export const ROOM_COMPUTATION_HEIGHT = 1200;
/** Half-width of a separation/boundary line as an obstacle, mm (thin enough not to affect areas). */
const SEPARATOR_HALF = 0.01;
/** Model text height of room tags, mm (2.5 mm at 1:100). */
const TAG_SIZE = 250;

export interface RoomBoundary {
  outer: Vec2[];
  holes: Vec2[][];
  /** mm². */
  area: number;
  /** mm, all loops. */
  perimeter: number;
}

/** Boundary of a room, or null when it isn't enclosed (or its point is inside a wall). */
export function roomBoundary(doc: Document, room: Room): RoomBoundary | null {
  const { bottom, top } = roomExtent(doc, room);
  const z = bottom + Math.min(ROOM_COMPUTATION_HEIGHT, (top - bottom) / 2);
  const obstacles: Polygon[] = boundingWalls(doc, z).map((w) => [w.ring]);
  for (const s of doc.byCategory<RoomSeparatorParams>(Cat.RoomSeparator)) {
    if (s.params.levelId === room.params.levelId) obstacles.push([ring(thinRect(s.params.start, s.params.end))]);
  }
  return enclosingRegion(obstacles, room.params.point);
}

/**
 * The region of free space (plan minus obstacles) containing `p`, or null when `p` is in an
 * obstacle or the region is open to the outside.
 */
export function enclosingRegion(obstacles: Polygon[], p: Vec2): RoomBoundary | null {
  if (!obstacles.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of obstacles) {
    for (const [x, y] of poly[0]!) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (p.x <= minX || p.x >= maxX || p.y <= minY || p.y >= maxY) return null;
  const m = 1000;
  const outside: Ring = [
    [minX - m, minY - m],
    [maxX + m, minY - m],
    [maxX + m, maxY + m],
    [minX - m, maxY + m],
  ];
  let free: MultiPolygon;
  try {
    free = polygonClipping.difference([outside], ...obstacles);
  } catch {
    return null;
  }
  for (const poly of free) {
    const [outer, ...holes] = poly.map(loop);
    if (!outer || !inside(p, outer) || holes.some((h) => inside(p, h))) continue;
    // The region touching the padding is the outside world.
    if (outer.some((q) => q.x <= minX - m + 1e-6 || q.x >= maxX + m - 1e-6 || q.y <= minY - m + 1e-6 || q.y >= maxY + m - 1e-6)) return null;
    const area = Math.abs(signedArea(outer)) - holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
    const perimeter = [outer, ...holes].reduce((s, l) => s + loopLength(l), 0);
    return { outer, holes, area, perimeter };
  }
  return null;
}

/** Room-bounding walls cut at height z, as footprint rings. */
function boundingWalls(doc: Document, z: number): { wall: Wall; ring: Ring }[] {
  const out: { wall: Wall; ring: Ring }[] = [];
  for (const w of doc.byCategory<WallParams>(Cat.Wall) as Wall[]) {
    if (w.params.roomBounding === false) continue;
    const e = wallExtent(doc, w);
    if (e.bottom > z || e.top <= z) continue;
    try {
      out.push({ wall: w, ring: ring(joinedWallFootprint(doc, w)) });
    } catch {
      // A wall that can't be built doesn't bound.
    }
  }
  return out;
}

/** Area of an Area: the region of its plan's area boundary lines around its point. */
export function areaBoundary(doc: Document, area: Area): RoomBoundary | null {
  const lines = areaBoundariesIn(doc, area.params.viewId).map((b): Polygon => [ring(thinRect(b.params.start, b.params.end))]);
  return enclosingRegion(lines, area.params.point);
}

/**
 * Area boundary loops from the walls on a level: the outside face of the building (GFA), or the
 * inside face of its external walls (NLA). External walls are those on the outside of the wall union.
 */
export function areaLoopsFromWalls(doc: Document, levelId: ElementId, scheme: AreaScheme): Vec2[][] {
  const z = doc.require<LevelParams>(levelId).params.elevation + ROOM_COMPUTATION_HEIGHT;
  const walls = boundingWalls(doc, z);
  if (!walls.length) return [];
  const polys = walls.map((w): Polygon => [w.ring]);
  const union = polygonClipping.union(polys[0]!, ...polys.slice(1));
  const outers = union.map((poly) => poly[0]!);
  if (scheme === "gross") return outers.map((r) => simplify(loop(r)));
  const out: Vec2[][] = [];
  for (const outer of outers) {
    const o = loop(outer);
    const external = walls.filter((w) => w.ring.some(([x, y]) => onLoop({ x, y }, o)));
    if (!external.length) continue;
    const inner = polygonClipping.difference([outer], ...external.map((w): Polygon => [w.ring]));
    for (const poly of inner) out.push(simplify(loop(poly[0]!)));
  }
  return out;
}

/** Plan line work for an Area: filled region and tag (name, area). */
export function buildAreaLines(doc: Document, el: Element): LineData {
  const area = el as Area;
  const b = areaBoundary(doc, area);
  const { x, y } = area.params.point;
  const labels: LineData["labels"] = [
    { text: area.name ?? "Area", position: [x, y + TAG_SIZE * 0.7, 0], size: TAG_SIZE },
    { text: b ? formatArea(b.area, projectUnits(doc)) : "Not Enclosed", position: [x, y - TAG_SIZE * 0.7, 0], size: TAG_SIZE * 0.8 },
  ];
  if (!b) {
    const c = TAG_SIZE;
    return { segments: new Float32Array([x - c, y - c, 0, x + c, y + c, 0, x - c, y + c, 0, x + c, y - c, 0]), labels };
  }
  // Fill only: the boundary lines draw the edges.
  return { segments: new Float32Array([x, y, 0, x + 1, y, 0]), labels, fill: { loops: [b.outer, ...b.holes], color: 0xf3e2c4 } };
}

export function buildAreaBoundaryLines(_doc: Document, el: Element): LineData {
  const { start, end } = el.params as { start: Vec2; end: Vec2 };
  return { segments: new Float32Array([start.x, start.y, 0, end.x, end.y, 0]), labels: [] };
}

/** Plan line work: the boundary (filled) and the tag (name, number, area in m²). */
export function buildRoomLines(doc: Document, el: Element): LineData | null {
  const room = el as Room;
  const b = roomBoundary(doc, room);
  const { x, y } = room.params.point;
  const labels: LineData["labels"] = [
    { text: room.name ?? "Room", position: [x, y + TAG_SIZE * 0.7, 0], size: TAG_SIZE },
    { text: room.params.number, position: [x, y - TAG_SIZE * 0.7, 0], size: TAG_SIZE },
    { text: b ? formatArea(b.area, projectUnits(doc)) : "Not Enclosed", position: [x, y - TAG_SIZE * 2.1, 0], size: TAG_SIZE * 0.8 },
  ];
  if (!b) {
    // A reference cross marks an unplaced region, as Revit does.
    const c = TAG_SIZE;
    return { segments: new Float32Array([x - c, y - c, 0, x + c, y + c, 0, x - c, y + c, 0, x + c, y - c, 0]), labels, planOnly: true };
  }
  const seg: number[] = [];
  for (const l of [b.outer, ...b.holes]) {
    l.forEach((a, i) => {
      const n = l[(i + 1) % l.length]!;
      seg.push(a.x, a.y, 0, n.x, n.y, 0);
    });
  }
  return { segments: new Float32Array(seg), labels, planOnly: true, fill: { loops: [b.outer, ...b.holes], color: 0xe4edf6 } };
}

export function buildRoomSeparatorLines(_doc: Document, el: Element): LineData {
  const { start, end } = el.params as RoomSeparatorParams;
  return { segments: new Float32Array([start.x, start.y, 0, end.x, end.y, 0]), labels: [], planOnly: true };
}

function thinRect(a: Vec2, b: Vec2): Vec2[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const n = { x: (-(b.y - a.y) / len) * SEPARATOR_HALF, y: ((b.x - a.x) / len) * SEPARATOR_HALF };
  const t = { x: ((b.x - a.x) / len) * SEPARATOR_HALF, y: ((b.y - a.y) / len) * SEPARATOR_HALF };
  return [
    { x: a.x - t.x - n.x, y: a.y - t.y - n.y },
    { x: b.x + t.x - n.x, y: b.y + t.y - n.y },
    { x: b.x + t.x + n.x, y: b.y + t.y + n.y },
    { x: a.x - t.x + n.x, y: a.y - t.y + n.y },
  ];
}

const ring = (pts: Vec2[]): Ring => pts.map((p) => [p.x, p.y]);

function onLoop(p: Vec2, l: Vec2[]): boolean {
  return l.some((a, i) => {
    const b = l[(i + 1) % l.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y) < 0.5;
  });
}

/** Drop collinear (and duplicate) vertices. */
function simplify(l: Vec2[]): Vec2[] {
  const out = l.filter((p, i) => {
    const a = l[(i - 1 + l.length) % l.length]!;
    const b = l[(i + 1) % l.length]!;
    const cross = (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x);
    return Math.abs(cross) > 1e-3 * Math.hypot(b.x - a.x, b.y - a.y);
  });
  return out.length >= 3 ? out : l;
}

/** polygon-clipping ring (closed, first = last) to an open loop. */
function loop(r: Ring): Vec2[] {
  const pts = r.map(([x, y]) => ({ x, y }));
  const f = pts[0];
  const l = pts.at(-1);
  if (f && l && f.x === l.x && f.y === l.y) pts.pop();
  return pts;
}

function inside(p: Vec2, poly: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

function signedArea(l: Vec2[]): number {
  let s = 0;
  l.forEach((a, i) => {
    const b = l[(i + 1) % l.length]!;
    s += a.x * b.y - b.x * a.y;
  });
  return s / 2;
}

function loopLength(l: Vec2[]): number {
  return l.reduce((s, a, i) => {
    const b = l[(i + 1) % l.length]!;
    return s + Math.hypot(b.x - a.x, b.y - a.y);
  }, 0);
}
