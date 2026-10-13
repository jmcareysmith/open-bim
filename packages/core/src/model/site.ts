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
  /** Contour labels: every fifth (index) contour (default), every contour, or none. */
  contourLabels?: "index" | "all" | "none";
  materialId?: ElementId | null;
  /**
   * Graded region (Revit): the ground as it was before grading, kept so cut and fill can be
   * measured. Unset, the existing ground is the spot heights without building pads.
   */
  existingPoints?: SitePoint[] | null;
};
export type Toposolid = Element<ToposolidParams>;

registerCategory({
  name: Cat.Toposolid,
  dependencies: (el) => {
    const p = el.params as ToposolidParams;
    return [p.levelId, ...(p.materialId ? [p.materialId] : [])];
  },
  // Pads and subregions sit on the toposolid's surface.
  related: (doc, el) => [...buildingPads(doc, el.id), ...subregions(doc, el.id)].map((x) => x.id),
  cascadeDelete: true,
  isType: false,
});

/**
 * Building pad (Revit: Massing & Site → Building Pad): a slab whose underside the toposolid is
 * graded to within its boundary, the ground battering up or down to it at the edges.
 */
export type BuildingPadParams = {
  toposolidId: ElementId;
  levelId: ElementId;
  boundary: Vec2[];
  /** Top of the pad above the level, mm. */
  offset: number;
  thickness: number;
  materialId?: ElementId | null;
};
export type BuildingPad = Element<BuildingPadParams>;

/** Subregion (Revit: Toposolid → Subregion): an area of the toposolid in another material (paths, lawn, paving). */
export type SubregionParams = { toposolidId: ElementId; boundary: Vec2[]; materialId?: ElementId | null };
export type Subregion = Element<SubregionParams>;

registerCategory({
  name: Cat.BuildingPad,
  dependencies: (el) => {
    const p = el.params as BuildingPadParams;
    return [p.toposolidId, p.levelId, ...(p.materialId ? [p.materialId] : [])];
  },
  // The toposolid re-grades round its pads.
  related: (_doc, el) => [(el.params as BuildingPadParams).toposolidId],
  cascadeDelete: true,
  isType: false,
});
registerCategory({
  name: Cat.SiteSubregion,
  dependencies: (el) => {
    const p = el.params as SubregionParams;
    return [p.toposolidId, ...(p.materialId ? [p.materialId] : [])];
  },
  cascadeDelete: true,
  isType: false,
});

export function buildingPads(doc: Document, toposolidId?: ElementId): BuildingPad[] {
  const all = doc.byCategory<BuildingPadParams>(Cat.BuildingPad) as BuildingPad[];
  return toposolidId ? all.filter((p) => p.params.toposolidId === toposolidId) : all;
}

export function subregions(doc: Document, toposolidId?: ElementId): Subregion[] {
  const all = doc.byCategory<SubregionParams>(Cat.SiteSubregion) as Subregion[];
  return toposolidId ? all.filter((p) => p.params.toposolidId === toposolidId) : all;
}

/** The toposolid a sketched boundary sits on: the first whose boundary holds its centre. */
export function toposolidUnder(doc: Document, boundary: Vec2[]): Toposolid | undefined {
  const c = { x: boundary.reduce((s, p) => s + p.x, 0) / boundary.length, y: boundary.reduce((s, p) => s + p.y, 0) / boundary.length };
  return (doc.byCategory<ToposolidParams>(Cat.Toposolid) as Toposolid[]).find((t) => insidePolygon(c, t.params.boundary));
}

export function createBuildingPad(tx: Transaction, doc: Document, boundary: Vec2[], opts: { toposolidId?: ElementId; levelId?: ElementId; offset?: number; thickness?: number } = {}): BuildingPad {
  if (boundary.length < 3) throw new Error("A building pad needs at least three points");
  const topo = opts.toposolidId ? (doc.get(opts.toposolidId) as Toposolid | undefined) : toposolidUnder(doc, boundary);
  if (!topo || topo.category !== Cat.Toposolid) throw new Error("Sketch the pad inside a toposolid");
  return tx.create<BuildingPadParams>(
    Cat.BuildingPad,
    { toposolidId: topo.id, levelId: opts.levelId ?? topo.params.levelId, boundary: boundary.map((p) => ({ ...p })), offset: opts.offset ?? 0, thickness: opts.thickness ?? 300 },
    { name: "Building Pad" },
  ) as BuildingPad;
}

export function createSubregion(tx: Transaction, doc: Document, boundary: Vec2[], opts: { toposolidId?: ElementId; materialId?: ElementId | null } = {}): Subregion {
  if (boundary.length < 3) throw new Error("A subregion needs at least three points");
  const topo = opts.toposolidId ? (doc.get(opts.toposolidId) as Toposolid | undefined) : toposolidUnder(doc, boundary);
  if (!topo || topo.category !== Cat.Toposolid) throw new Error("Sketch the subregion inside a toposolid");
  return tx.create<SubregionParams>(Cat.SiteSubregion, { toposolidId: topo.id, boundary: boundary.map((p) => ({ ...p })), materialId: opts.materialId ?? null }, { name: "Subregion" }) as Subregion;
}

/** Absolute height of a pad's underside, mm (the ground is graded to it). */
export function padBottom(doc: Document, pad: BuildingPad): number {
  return (doc.get<LevelParams>(pad.params.levelId)?.params.elevation ?? 0) + pad.params.offset - pad.params.thickness;
}

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
/** How far outside a pad the ground returns to its existing level (and the edge step), mm. */
const PAD_EDGE = 300;

/**
 * The toposolid's top: proposed (graded to its building pads) by default, or `existing` (before
 * grading: the recorded existing ground, else the spot heights without pads).
 */
export function toposolidSurface(doc: Document, t: Toposolid, opts: { existing?: boolean } = {}): { vertices: SitePoint[]; triangles: [number, number, number][] } {
  const p0 = t.params;
  const base = doc.get<LevelParams>(p0.levelId)?.params.elevation ?? 0;
  let points = opts.existing ? (p0.existingPoints ?? p0.points) : p0.points;
  if (!opts.existing) {
    // Pads: drop spot heights under them and add their corners at the pad's underside.
    // A ring just outside each pad keeps the existing ground there, so only the ground under the
    // pad changes (Revit grades the pad's footprint, with a near-vertical cut at its edge).
    const pads = buildingPads(doc, t.id);
    const ground = toposolidSurface(doc, t, { existing: true });
    // Pad edges in short steps (so the triangulation keeps to them), each with a matching point
    // just outside at the existing ground.
    const edge = (pad: BuildingPad) => {
      const b = pad.params.boundary;
      const area = b.reduce((s2, q, i) => s2 + q.x * b[(i + 1) % b.length]!.y - b[(i + 1) % b.length]!.x * q.y, 0);
      const out = area > 0 ? 1 : -1; // outward normal side for this winding
      const pts: { on: Vec2; off: Vec2 }[] = [];
      b.forEach((q, i) => {
        const r = b[(i + 1) % b.length]!;
        const L = Math.hypot(r.x - q.x, r.y - q.y);
        const n = { x: (out * (r.y - q.y)) / L, y: (out * -(r.x - q.x)) / L };
        const steps = Math.max(1, Math.ceil(L / PAD_EDGE));
        for (let k = 0; k < steps; k++) {
          const on = { x: q.x + ((r.x - q.x) * k) / steps, y: q.y + ((r.y - q.y) * k) / steps };
          pts.push({ on, off: { x: on.x + n.x * PAD_EDGE, y: on.y + n.y * PAD_EDGE } });
        }
      });
      const zPad = padBottom(doc, pad) - base;
      return pts.flatMap(({ on, off }) => [
        { ...on, z: zPad },
        { ...off, z: (surfaceHeightAt(ground, off) ?? siteHeight(points, off) + base) - base },
      ]);
    };
    points = [
      ...points.filter((q) => !pads.some((pad) => insidePolygon(q, pad.params.boundary))),
      ...pads.flatMap((pad) => edge(pad)),
    ];
  }
  const p = { ...p0, points };
  const inside = p.points.filter((q) => insidePolygon(q, p.boundary));
  // Boundary heights come from the survey, not the pads (their many points would drag the edges).
  const verts: SitePoint[] = [...p.boundary.map((b) => ({ x: b.x, y: b.y, z: siteHeight(opts.existing ? points : p0.points, b) })), ...inside];
  const tris = delaunay(verts).filter(([a, b, c]) => {
    const g = { x: (verts[a]!.x + verts[b]!.x + verts[c]!.x) / 3, y: (verts[a]!.y + verts[b]!.y + verts[c]!.y) / 3 };
    return insidePolygon(g, p.boundary);
  });
  return { vertices: verts.map((v) => ({ x: v.x, y: v.y, z: v.z + base })), triangles: tris };
}

/** Height of a triangulated surface at a plan point (barycentric), or null outside it. */
export function surfaceHeightAt(surface: { vertices: SitePoint[]; triangles: [number, number, number][] }, p: Vec2): number | null {
  for (const [a, b, c] of surface.triangles) {
    const A = surface.vertices[a]!;
    const B = surface.vertices[b]!;
    const C = surface.vertices[c]!;
    const det = (B.y - C.y) * (A.x - C.x) + (C.x - B.x) * (A.y - C.y);
    if (Math.abs(det) < 1e-9) continue;
    const l1 = ((B.y - C.y) * (p.x - C.x) + (C.x - B.x) * (p.y - C.y)) / det;
    const l2 = ((C.y - A.y) * (p.x - C.x) + (A.x - C.x) * (p.y - C.y)) / det;
    const l3 = 1 - l1 - l2;
    if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return l1 * A.z + l2 * B.z + l3 * C.z;
  }
  return null;
}

/**
 * Cut and fill (Revit: Graded Region / Building Pad properties): the earthworks between the
 * existing ground and the graded surface, m³, sampled on a grid of `cell` mm squares.
 */
export function cutFill(doc: Document, t: Toposolid, cell = 250): { cut: number; fill: number } {
  const before = toposolidSurface(doc, t, { existing: true });
  const after = toposolidSurface(doc, t);
  const b = t.params.boundary;
  const xs = b.map((q) => q.x);
  const ys = b.map((q) => q.y);
  let cut = 0;
  let fill = 0;
  for (let x = Math.min(...xs) + cell / 2; x < Math.max(...xs); x += cell) {
    for (let y = Math.min(...ys) + cell / 2; y < Math.max(...ys); y += cell) {
      const q = { x, y };
      if (!insidePolygon(q, b)) continue;
      const e = surfaceHeightAt(before, q);
      const n = surfaceHeightAt(after, q);
      if (e === null || n === null) continue;
      if (e > n) cut += (e - n) * cell * cell;
      else fill += (n - e) * cell * cell;
    }
  }
  return { cut: cut / 1e9, fill: fill / 1e9 };
}

/** Graded Region: record the ground as it is now as the existing ground (for cut and fill). */
export function recordExistingGround(tx: Transaction, doc: Document, toposolidId: ElementId): void {
  const t = doc.require<ToposolidParams>(toposolidId);
  if (t.category !== Cat.Toposolid) throw new Error("Not a toposolid");
  tx.update<ToposolidParams>(toposolidId, { existingPoints: t.params.points.map((p) => ({ ...p })) });
}
