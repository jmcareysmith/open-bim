import type { Document } from "../document.ts";
import type { ElementId, Vec2 } from "../element.ts";
import { Cat, totalThickness, type LayeredTypeParams, type Wall } from "./architecture.ts";
import { isSimplePolygon, polygonArea } from "./sketch.ts";

// Pick Walls (Revit's floor/ceiling/roof sketch option): a boundary loop from picked walls. Each
// wall gives a line on one of its faces (or its core faces, or centreline), moved outwards by an
// offset; neighbouring lines meet at their intersections. Walls can be picked in any order and
// needn't meet end to end (a long wall can run past the corner).

export type PickWallLine = "exterior" | "coreExterior" | "centre" | "coreInterior" | "interior";

export const PICK_WALL_LINES: { value: PickWallLine; label: string }[] = [
  { value: "exterior", label: "Exterior face" },
  { value: "coreExterior", label: "Core exterior" },
  { value: "centre", label: "Wall centreline" },
  { value: "coreInterior", label: "Core interior" },
  { value: "interior", label: "Interior face" },
];

/** Distance from a wall's location line towards its exterior side (its left), mm. */
export function wallLineOffset(doc: Document, wall: Wall, line: PickWallLine): number {
  const type = wall.typeId ? doc.get<LayeredTypeParams>(wall.typeId) : undefined;
  if (!type) throw new Error("Wall has no type");
  const layers = type.params.layers;
  const h = totalThickness(type) / 2;
  const bounds = [h];
  for (const l of layers) bounds.push(bounds.at(-1)! - l.thickness);
  const first = layers.findIndex((l) => l.function === "structure");
  const last = layers.map((l) => l.function).lastIndexOf("structure");
  switch (line) {
    case "exterior":
      return h;
    case "interior":
      return -h;
    case "centre":
      return 0;
    case "coreExterior":
      return first < 0 ? h : bounds[first]!;
    case "coreInterior":
      return last < 0 ? -h : bounds[last + 1]!;
  }
}

/**
 * Closed boundary (counter-clockwise) from picked walls. `offset` moves it outwards (negative =
 * inwards), as Revit's Offset. Throws if the walls don't close a loop.
 */
export function boundaryFromWalls(doc: Document, wallIds: ElementId[], line: PickWallLine = "interior", offset = 0): Vec2[] {
  const walls = wallIds.map((id) => doc.get(id)).filter((w): w is Wall => w?.category === Cat.Wall) as Wall[];
  if (walls.length < 3) throw new Error("Pick at least three walls that enclose an area");
  const chain = orderWalls(walls);

  // Outwards is to the right of the chain when it runs anticlockwise.
  const ccw = polygonArea(chain.map((c) => c.a)) > 0;
  const lines = chain.map((c) => {
    const d = unit(sub(c.b, c.a));
    const left = { x: -d.y, y: d.x };
    const ext = wallLineOffset(doc, c.wall, line) * (c.reversed ? -1 : 1);
    const s = ext + offset * (ccw ? -1 : 1);
    return { p: { x: c.a.x + left.x * s, y: c.a.y + left.y * s }, d };
  });
  // Merge runs of collinear lines (a wall split in two).
  const merged: typeof lines = [];
  for (const l of lines) {
    const prev = merged.at(-1);
    if (prev && collinear(prev, l)) continue;
    merged.push(l);
  }
  while (merged.length > 1 && collinear(merged.at(-1)!, merged[0]!)) merged.pop();
  if (merged.length < 3) throw new Error("The picked walls don't enclose an area");

  const pts: Vec2[] = [];
  for (let i = 0; i < merged.length; i++) {
    const x = intersect(merged[(i + merged.length - 1) % merged.length]!, merged[i]!);
    if (!x) throw new Error("Two picked walls are parallel but don't meet: pick the wall between them too");
    pts.push({ x: Math.round(x.x * 1000) / 1000, y: Math.round(x.y * 1000) / 1000 });
  }
  const loop = polygonArea(pts) < 0 ? pts.reverse() : pts;
  if (!isSimplePolygon(loop)) throw new Error("The picked walls don't make a simple loop (check the offset and which walls are picked)");
  return loop;
}

interface Oriented {
  wall: Wall;
  /** Location line, oriented along the chain. */
  a: Vec2;
  b: Vec2;
  reversed: boolean;
}

/** Order walls round the loop: each next wall is the one nearest the current far end. */
function orderWalls(walls: Wall[]): Oriented[] {
  const orient = (w: Wall, reversed: boolean): Oriented => ({
    wall: w,
    a: reversed ? w.params.end : w.params.start,
    b: reversed ? w.params.start : w.params.end,
    reversed,
  });
  const out: Oriented[] = [orient(walls[0]!, false)];
  const left = walls.slice(1);
  const reach = (w: Wall) => Math.max(500, Math.hypot(w.params.end.x - w.params.start.x, w.params.end.y - w.params.start.y) / 2);
  while (left.length) {
    const cur = out.at(-1)!;
    let best = -1;
    let bestD = Infinity;
    left.forEach((w, i) => {
      const d = segDist(cur.b, w.params.start, w.params.end);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    const w = left[best]!;
    if (bestD > reach(cur.wall) + reach(w)) throw new Error("The picked walls don't make a closed loop");
    left.splice(best, 1);
    // Head away from where the two lines meet.
    const x = intersect({ p: cur.a, d: unit(sub(cur.b, cur.a)) }, { p: w.params.start, d: unit(sub(w.params.end, w.params.start)) }) ?? cur.b;
    const reversed = dist(w.params.end, x) < dist(w.params.start, x);
    out.push(orient(w, reversed));
  }
  return out;
}

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (v: Vec2): Vec2 => {
  const l = Math.hypot(v.x, v.y);
  return { x: v.x / l, y: v.y / l };
};

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / (ab.x * ab.x + ab.y * ab.y)));
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
}

type Line = { p: Vec2; d: Vec2 };

function intersect(l1: Line, l2: Line): Vec2 | null {
  const den = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((l2.p.x - l1.p.x) * l2.d.y - (l2.p.y - l1.p.y) * l2.d.x) / den;
  return { x: l1.p.x + l1.d.x * t, y: l1.p.y + l1.d.y * t };
}

function collinear(l1: Line, l2: Line): boolean {
  if (Math.abs(l1.d.x * l2.d.y - l1.d.y * l2.d.x) > 1e-6) return false;
  const r = sub(l2.p, l1.p);
  return Math.abs(r.x * l1.d.y - r.y * l1.d.x) < 0.5;
}
