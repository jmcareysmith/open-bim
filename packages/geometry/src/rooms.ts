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
/** Half-width of a room separation line as an obstacle, mm (its effect on area is negligible). */
const SEPARATOR_HALF = 0.5;
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
  const obstacles: Polygon[] = [];
  for (const w of doc.byCategory<WallParams>(Cat.Wall) as Wall[]) {
    if (w.params.roomBounding === false) continue;
    const e = wallExtent(doc, w);
    if (e.bottom > z || e.top <= z) continue;
    try {
      obstacles.push([ring(joinedWallFootprint(doc, w))]);
    } catch {
      // A wall that can't be built doesn't bound.
    }
  }
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
