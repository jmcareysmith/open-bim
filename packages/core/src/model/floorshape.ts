import type { Document, Transaction } from "../document.ts";
import type { ElementId, Vec2 } from "../element.ts";
import { Cat, setFloorShapeHook, type Floor, type FloorParams } from "./architecture.ts";
import { delaunay, insidePolygon, surfaceHeightAt, type SitePoint } from "./site.ts";

// Floor shape editing (Revit: Modify Sub Elements — Add Point, edit point elevations): points on a
// floor that move its top up or down, e.g. falls to a shower drain. The top becomes a surface
// triangulated through the boundary corners (0, or a point placed on them) and the points; the
// slab's bottom stays where it was, so the thickness varies (Revit's variable layer).

/** A shape point: plan position and how far the top moves there, mm (negative: down). */
export type FloorShapePoint = { x: number; y: number; dz: number };

/** Slab edges (Revit: Slab Edge): a profile run along the floor's outer edges. */
export type SlabEdge = { profile: string };

/**
 * Slab edge profiles, mm: x out from the floor edge (negative: under the slab), y from the floor's
 * bottom (negative: below it).
 */
export const SLAB_EDGE_PROFILES: Record<string, Vec2[]> = {
  "Thickening 300 x 300": [
    { x: -300, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: -300 },
    { x: -150, y: -300 },
  ],
  "Thickening 450 x 450": [
    { x: -450, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: -450 },
    { x: -250, y: -450 },
  ],
  "Rebated Edge 200 x 150": [
    { x: 0, y: -150 },
    { x: 0, y: 0 },
    { x: 120, y: 0 },
    { x: 120, y: -150 },
  ],
  "Nosing 50 x 50": [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 50, y: 50 },
    { x: 0, y: 50 },
  ],
};

/** The shaped part of a floor's top: boundary corners and points, triangulated, z = dz. */
export function floorShapeSurface(floor: Floor): { vertices: SitePoint[]; triangles: [number, number, number][] } | null {
  const pts = floor.params.shape;
  if (!pts?.length) return null;
  const { boundary, holes } = floor.params;
  const near = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y) < 1;
  const corners = [...boundary, ...holes.flat()].map((c) => ({ x: c.x, y: c.y, z: pts.find((q) => near(q, c))?.dz ?? 0 }));
  const inner = pts.filter((q) => !corners.some((c) => near(c, q)) && insidePolygon(q, boundary)).map((q) => ({ x: q.x, y: q.y, z: q.dz }));
  const vertices = [...corners, ...inner];
  const triangles = delaunay(vertices).filter(([a, b, c]) => {
    const g = { x: (vertices[a]!.x + vertices[b]!.x + vertices[c]!.x) / 3, y: (vertices[a]!.y + vertices[b]!.y + vertices[c]!.y) / 3 };
    return insidePolygon(g, boundary) && !holes.some((h) => insidePolygon(g, h));
  });
  return { vertices, triangles };
}

const cache = new WeakMap<object, ReturnType<typeof floorShapeSurface>>();
function surfaceOf(floor: Floor) {
  if (!cache.has(floor.params)) cache.set(floor.params, floorShapeSurface(floor));
  return cache.get(floor.params) ?? null;
}

/** How far the shape moves the top at `p` (0 when flat or outside). */
export function floorShapeOffset(floor: Floor, p: Vec2): number {
  const s = surfaceOf(floor);
  return s ? (surfaceHeightAt(s, p) ?? 0) : 0;
}

setFloorShapeHook(floorShapeOffset);

function requireFloor(doc: Document, id: ElementId): Floor {
  const f = doc.require<FloorParams>(id) as Floor;
  if (f.category !== Cat.Floor) throw new Error("Shape editing works on floors");
  return f;
}

/** Add a shape point (inside the floor, or on a corner to move that corner). */
export function addFloorShapePoint(tx: Transaction, doc: Document, id: ElementId, p: Vec2, dz: number): void {
  const f = requireFloor(doc, id);
  const onCorner = f.params.boundary.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < 1);
  if (!onCorner && !insidePolygon(p, f.params.boundary)) throw new Error("Put shape points on the floor");
  if (!Number.isFinite(dz)) throw new Error("A shape point needs a height");
  const rest = (f.params.shape ?? []).filter((q) => Math.hypot(q.x - p.x, q.y - p.y) >= 1);
  tx.update<FloorParams>(id, { shape: [...rest, { x: p.x, y: p.y, dz }] });
}

/** Replace a floor's shape points (null: flat again, Revit's Reset Shape). */
export function setFloorShape(tx: Transaction, doc: Document, id: ElementId, points: FloorShapePoint[] | null): void {
  requireFloor(doc, id);
  for (const q of points ?? []) if (![q.x, q.y, q.dz].every(Number.isFinite)) throw new Error("Shape points need numbers");
  tx.update<FloorParams>(id, { shape: points?.length ? points.map((q) => ({ ...q })) : null });
}

export function setSlabEdge(tx: Transaction, doc: Document, id: ElementId, edge: SlabEdge | null): void {
  requireFloor(doc, id);
  if (edge && !SLAB_EDGE_PROFILES[edge.profile]) throw new Error(`Unknown slab edge ${edge.profile}`);
  tx.update<FloorParams>(id, { slabEdge: edge ? { ...edge } : null });
}
