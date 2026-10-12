import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat, type LevelParams } from "./architecture.ts";
import { fromShared, projectLocation } from "./settings.ts";

// Site (Revit: Toposolid). A toposolid is a plan boundary with surveyed spot heights; the top is a
// Delaunay triangulation of the points (boundary vertices get heights interpolated from them), and
// the solid runs down to `thickness` below the lowest point. Plans show contours at an interval.

export type SitePoint = { x: number; y: number; z: number };

export type ToposolidParams = {
  levelId: ElementId;
  boundary: Vec2[];
  /** Spot heights; z is relative to the level, mm. */
  points: SitePoint[];
  /** Depth of the solid below its lowest point, mm. */
  thickness: number;
  /** Contour spacing in plans, mm (0 = none). */
  contourInterval: number;
  materialId?: ElementId | null;
};
export type Toposolid = Element<ToposolidParams>;

registerCategory({
  name: Cat.Toposolid,
  dependencies: (el) => {
    const p = el.params as ToposolidParams;
    return [p.levelId, ...(p.materialId ? [p.materialId] : [])];
  },
  cascadeDelete: true,
  isType: false,
});

export function createToposolid(tx: Transaction, doc: Document, levelId: ElementId, boundary: Vec2[], points: SitePoint[] = [], opts: { thickness?: number; contourInterval?: number } = {}): Toposolid {
  if (doc.get(levelId)?.category !== Cat.Level) throw new Error("Toposolids sit on a level");
  if (boundary.length < 3) throw new Error("A toposolid boundary needs at least three points");
  return tx.create<ToposolidParams>(
    Cat.Toposolid,
    {
      levelId,
      boundary: boundary.map((p) => ({ ...p })),
      points: points.map((p) => ({ ...p })),
      thickness: opts.thickness ?? 1000,
      contourInterval: opts.contourInterval ?? 500,
    },
    { name: "Toposolid" },
  ) as Toposolid;
}

/**
 * Survey points from CSV: lines of "E, N, RL" (or "id, E, N, RL") in metres, map coordinates; they
 * become project points through the project's shared coordinates, with z relative to `levelId`.
 * Lines that don't parse (headers, comments) are skipped.
 */
export function parseSurveyCsv(doc: Document, text: string, levelId: ElementId): SitePoint[] {
  const loc = projectLocation(doc);
  const levelZ = doc.get<LevelParams>(levelId)?.params.elevation ?? 0;
  const out: SitePoint[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cols = line.split(/[,\t;]/).map((c) => c.trim()).filter((c) => c !== "");
    const nums = cols.map(Number);
    const vals = nums.every(Number.isFinite) ? nums : nums.slice(1).every(Number.isFinite) ? nums.slice(1) : null;
    if (!vals || vals.length < 3) continue;
    const [e, n, h] = vals.slice(-3) as [number, number, number];
    const p = fromShared(loc, { e, n, h });
    out.push({ x: p.x, y: p.y, z: p.z - levelZ });
  }
  return out;
}

/** Height (relative to level) at a plan point: inverse-distance weighting of the spot heights. */
export function siteHeight(points: SitePoint[], p: Vec2): number {
  if (!points.length) return 0;
  let wsum = 0;
  let zsum = 0;
  for (const q of points) {
    const d2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d2 < 1) return q.z;
    const w = 1 / d2;
    wsum += w;
    zsum += w * q.z;
  }
  return zsum / wsum;
}

/** Delaunay triangulation (Bowyer–Watson); returns index triples into `pts`. */
export function delaunay(pts: Vec2[]): [number, number, number][] {
  if (pts.length < 3) return [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const d = Math.max(maxX - minX, maxY - minY) * 20 + 1;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const all = [...pts, { x: cx - d, y: cy - d }, { x: cx + d, y: cy - d }, { x: cx, y: cy + d }];
  const n = pts.length;
  type Tri = { a: number; b: number; c: number; x: number; y: number; r2: number };
  const circum = (a: number, b: number, c: number): Tri => {
    const A = all[a]!;
    const B = all[b]!;
    const C = all[c]!;
    const D = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y));
    const ux = ((A.x ** 2 + A.y ** 2) * (B.y - C.y) + (B.x ** 2 + B.y ** 2) * (C.y - A.y) + (C.x ** 2 + C.y ** 2) * (A.y - B.y)) / D;
    const uy = ((A.x ** 2 + A.y ** 2) * (C.x - B.x) + (B.x ** 2 + B.y ** 2) * (A.x - C.x) + (C.x ** 2 + C.y ** 2) * (B.x - A.x)) / D;
    return { a, b, c, x: ux, y: uy, r2: (A.x - ux) ** 2 + (A.y - uy) ** 2 };
  };
  let tris: Tri[] = [circum(n, n + 1, n + 2)];
  for (let i = 0; i < n; i++) {
    const p = all[i]!;
    const bad = tris.filter((t) => (p.x - t.x) ** 2 + (p.y - t.y) ** 2 < t.r2 * (1 + 1e-12));
    const edges = new Map<string, [number, number]>();
    for (const t of bad) {
      for (const [u, v] of [
        [t.a, t.b],
        [t.b, t.c],
        [t.c, t.a],
      ] as const) {
        const k = u < v ? `${u},${v}` : `${v},${u}`;
        if (edges.has(k)) edges.delete(k);
        else edges.set(k, [u, v]);
      }
    }
    tris = tris.filter((t) => !bad.includes(t));
    for (const [u, v] of edges.values()) tris.push(circum(u, v, i));
  }
  return tris.filter((t) => t.a < n && t.b < n && t.c < n).map((t) => [t.a, t.b, t.c]);
}

/** Point-in-polygon (even-odd). */
export function insidePolygon(p: Vec2, poly: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** The toposolid's top surface: vertices (absolute z) and triangles, clipped to the boundary. */
export function toposolidSurface(doc: Document, t: Toposolid): { vertices: SitePoint[]; triangles: [number, number, number][] } {
  const p = t.params;
  const base = doc.get<LevelParams>(p.levelId)?.params.elevation ?? 0;
  const inside = p.points.filter((q) => insidePolygon(q, p.boundary));
  const verts: SitePoint[] = [...p.boundary.map((b) => ({ x: b.x, y: b.y, z: siteHeight(p.points, b) })), ...inside];
  const tris = delaunay(verts).filter(([a, b, c]) => {
    const g = { x: (verts[a]!.x + verts[b]!.x + verts[c]!.x) / 3, y: (verts[a]!.y + verts[b]!.y + verts[c]!.y) / 3 };
    return insidePolygon(g, p.boundary);
  });
  return { vertices: verts.map((v) => ({ x: v.x, y: v.y, z: v.z + base })), triangles: tris };
}
