import earcut from "earcut";
import type { ElementId, Vec2 } from "@open-bim/core";
import type { MeshData } from "./mesh.ts";

// Plan drawings from meshes: cut linework at the cut plane plus hidden-line-removed projection of
// everything between the view depth and the cut, seen from above. Exact for planar-faced meshes.

export interface PlanRange {
  /** Lowest Z drawn (view depth). */
  bottom: number;
  /** Cut plane Z. */
  cut: number;
}

export interface PlanLinework {
  id: ElementId;
  /** Closed loops where the element crosses the cut plane (drawn heavy and filled). */
  cutLoops: Vec2[][];
  /** Visible projected edges below the cut: [x0, y0, x1, y1, …]. */
  projection: number[];
}

/** Edges whose adjacent faces differ by more than this are drawn (matches the 3D view's edges). */
const CREASE_DEG = 20;
/** Depth tolerance: a surface must be this far above an edge to hide it, mm. */
const DEPTH_EPS = 0.5;
const KEY = (x: number, y: number, z: number) => `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;

type V3 = [number, number, number];
type Tri = [V3, V3, V3];

/** Occluding triangle with its projected bounding box. */
interface Occluder {
  t: Tri;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function planLinework(items: { id: ElementId; mesh: MeshData }[], range: PlanRange): PlanLinework[] {
  const out: PlanLinework[] = [];
  const occluders: Occluder[] = [];
  const edgesById = new Map<ElementId, [V3, V3][]>();

  for (const { id, mesh } of items) {
    const tris = triangles(mesh);
    const cutLoops = chainLoops(cutSegments(tris, range.cut));
    out.push({ id, cutLoops, projection: [] });

    for (const t of tris) {
      for (const piece of clipBelow(t, range.cut)) {
        if (Math.max(piece[0][2], piece[1][2], piece[2][2]) < range.bottom) continue;
        occluders.push(occluder(piece));
      }
    }
    // Caps: the cut faces themselves hide whatever is inside a cut element.
    for (const tri of fillLoops(cutLoops)) occluders.push(occluder(tri.map((p) => [p.x, p.y, range.cut]) as Tri));

    edgesById.set(id, featureEdges(tris).flatMap((e) => clipEdge(e, range)));
  }

  const grid = new OccluderGrid(occluders);
  for (const lw of out) {
    for (const [a, b] of edgesById.get(lw.id) ?? []) {
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) continue; // vertical edge: a point in plan
      for (const [t0, t1] of visibleIntervals(a, b, grid)) {
        lw.projection.push(
          a[0] + (b[0] - a[0]) * t0,
          a[1] + (b[1] - a[1]) * t0,
          a[0] + (b[0] - a[0]) * t1,
          a[1] + (b[1] - a[1]) * t1,
        );
      }
    }
  }
  return out;
}

// ---- mesh helpers --------------------------------------------------------------

function triangles(m: MeshData): Tri[] {
  const p = m.positions;
  const tris: Tri[] = [];
  for (let i = 0; i < m.indices.length; i += 3) {
    const v = (k: number): V3 => {
      const j = m.indices[i + k]! * 3;
      return [p[j]!, p[j + 1]!, p[j + 2]!];
    };
    tris.push([v(0), v(1), v(2)]);
  }
  return tris;
}

function normal(t: Tri): V3 {
  const u = [t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]];
  const v = [t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]];
  const n: V3 = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
  const l = Math.hypot(...n) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

/** Boundary edges and creases between faces meeting at more than CREASE_DEG. */
export function featureEdges(tris: Tri[]): [V3, V3][] {
  const edges = new Map<string, { a: V3; b: V3; normals: V3[] }>();
  for (const t of tris) {
    const n = normal(t);
    for (let i = 0; i < 3; i++) {
      const a = t[i]!;
      const b = t[(i + 1) % 3]!;
      const ka = KEY(...a);
      const kb = KEY(...b);
      if (ka === kb) continue;
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const e = edges.get(key);
      if (e) e.normals.push(n);
      else edges.set(key, { a, b, normals: [n] });
    }
  }
  const cos = Math.cos((CREASE_DEG * Math.PI) / 180);
  const out: [V3, V3][] = [];
  for (const e of edges.values()) {
    const [n0, n1] = e.normals;
    const crease = !n1 || e.normals.length > 2 || n0![0] * n1[0] + n0![1] * n1[1] + n0![2] * n1[2] < cos;
    if (crease) out.push([e.a, e.b]);
  }
  return out;
}

/** Part of an edge between the view depth and the cut plane. */
function clipEdge([a, b]: [V3, V3], r: PlanRange): [V3, V3][] {
  let t0 = 0;
  let t1 = 1;
  const dz = b[2] - a[2];
  for (const [limit, below] of [
    [r.cut, true],
    [r.bottom, false],
  ] as const) {
    if (Math.abs(dz) < 1e-12) {
      if (below ? a[2] > limit + 1e-9 : a[2] < limit - 1e-9) return [];
      continue;
    }
    const t = (limit - a[2]) / dz;
    // below: keep z ≤ cut; otherwise keep z ≥ bottom.
    if ((dz > 0) === below) t1 = Math.min(t1, t);
    else t0 = Math.max(t0, t);
  }
  if (t1 - t0 < 1e-9) return [];
  const at = (t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + dz * t];
  return [[at(t0), at(t1)]];
}

/** Clip a triangle to z ≤ cut; returns 0–2 triangles. */
function clipBelow(t: Tri, cut: number): Tri[] {
  const poly: V3[] = [];
  for (let i = 0; i < 3; i++) {
    const p = t[i]!;
    const q = t[(i + 1) % 3]!;
    const pin = p[2] <= cut;
    const qin = q[2] <= cut;
    if (pin) poly.push(p);
    if (pin !== qin) {
      const s = (cut - p[2]) / (q[2] - p[2]);
      poly.push([p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s, cut]);
    }
  }
  const out: Tri[] = [];
  for (let i = 1; i + 1 < poly.length; i++) out.push([poly[0]!, poly[i]!, poly[i + 1]!]);
  return out;
}

/** Segments where triangles cross the plane z = cut. */
function cutSegments(tris: Tri[], cut: number): [Vec2, Vec2][] {
  const segs: [Vec2, Vec2][] = [];
  for (const t of tris) {
    const pts: Vec2[] = [];
    for (let i = 0; i < 3; i++) {
      const p = t[i]!;
      const q = t[(i + 1) % 3]!;
      const dp = p[2] - cut;
      const dq = q[2] - cut;
      if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
        const s = dp / (dp - dq);
        pts.push({ x: p[0] + (q[0] - p[0]) * s, y: p[1] + (q[1] - p[1]) * s });
      } else if (dp === 0 && dq !== 0) {
        pts.push({ x: p[0], y: p[1] });
      }
    }
    if (pts.length === 2 && Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y) > 1e-6) segs.push([pts[0]!, pts[1]!]);
  }
  return segs;
}

/** Join segments end to end into closed loops (open chains are dropped). */
export function chainLoops(segs: [Vec2, Vec2][]): Vec2[][] {
  const k = (p: Vec2) => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;
  const byPoint = new Map<string, number[]>();
  segs.forEach(([a, b], i) => {
    for (const p of [a, b]) {
      const key = k(p);
      const l = byPoint.get(key);
      if (l) l.push(i);
      else byPoint.set(key, [i]);
    }
  });
  const used = new Set<number>();
  const loops: Vec2[][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const loop: Vec2[] = [segs[i]![0]];
    let cur = segs[i]![1];
    const start = k(loop[0]!);
    let closed = false;
    for (let guard = 0; guard < segs.length; guard++) {
      if (k(cur) === start) {
        closed = true;
        break;
      }
      loop.push(cur);
      const next = (byPoint.get(k(cur)) ?? []).find((j) => !used.has(j));
      if (next === undefined) break;
      used.add(next);
      const [a, b] = segs[next]!;
      cur = k(a) === k(cur) ? b : a;
    }
    if (closed && loop.length >= 3) loops.push(simplify(loop));
  }
  return loops;
}

/** Drop collinear points (a cut through a triangulated face gives one point per triangle). */
function simplify(loop: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < loop.length; i++) {
    const p = loop[(i - 1 + loop.length) % loop.length]!;
    const q = loop[i]!;
    const r = loop[(i + 1) % loop.length]!;
    const cross = (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
    if (Math.abs(cross) > 1e-6 * Math.max(1, Math.hypot(r.x - p.x, r.y - p.y))) out.push(q);
  }
  return out.length >= 3 ? out : loop;
}

const area = (l: Vec2[]) => l.reduce((s, p, i) => s + p.x * l[(i + 1) % l.length]!.y - l[(i + 1) % l.length]!.x * p.y, 0) / 2;

function inside(p: Vec2, poly: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** Triangulate loops with even-odd nesting (a loop inside one other loop is a hole). */
export function fillLoops(loops: Vec2[][]): Vec2[][] {
  const sorted = [...loops].sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
  const depth = sorted.map((l, i) => sorted.slice(0, i).filter((o) => inside(l[0]!, o)).length);
  const tris: Vec2[][] = [];
  sorted.forEach((outer, i) => {
    if (depth[i]! % 2) return;
    const holes = sorted.filter((h, j) => j > i && depth[j] === depth[i]! + 1 && inside(h[0]!, outer));
    const flat: number[] = [];
    const holeIdx: number[] = [];
    for (const p of outer) flat.push(p.x, p.y);
    for (const h of holes) {
      holeIdx.push(flat.length / 2);
      for (const p of h) flat.push(p.x, p.y);
    }
    const all = [outer, ...holes].flat();
    const idx = earcut(flat, holeIdx);
    for (let t = 0; t < idx.length; t += 3) tris.push([all[idx[t]!]!, all[idx[t + 1]!]!, all[idx[t + 2]!]!]);
  });
  return tris;
}

// ---- visibility ------------------------------------------------------------------

function occluder(t: Tri): Occluder {
  return {
    t,
    minX: Math.min(t[0][0], t[1][0], t[2][0]),
    maxX: Math.max(t[0][0], t[1][0], t[2][0]),
    minY: Math.min(t[0][1], t[1][1], t[2][1]),
    maxY: Math.max(t[0][1], t[1][1], t[2][1]),
  };
}

/** Uniform grid over occluder bounding boxes, for quick candidate lookup. */
class OccluderGrid {
  private cells = new Map<string, Occluder[]>();
  private size: number;

  constructor(private all: Occluder[]) {
    const span = all.reduce((s, o) => Math.max(s, o.maxX - o.minX, o.maxY - o.minY), 1);
    this.size = Math.max(250, Math.min(2000, span / 4));
    for (const o of all) {
      for (const key of this.keys(o.minX, o.minY, o.maxX, o.maxY)) {
        const c = this.cells.get(key);
        if (c) c.push(o);
        else this.cells.set(key, [o]);
      }
    }
  }

  private *keys(x0: number, y0: number, x1: number, y1: number): Generator<string> {
    const s = this.size;
    for (let i = Math.floor(x0 / s); i <= Math.floor(x1 / s); i++) {
      for (let j = Math.floor(y0 / s); j <= Math.floor(y1 / s); j++) yield `${i},${j}`;
    }
  }

  query(x0: number, y0: number, x1: number, y1: number): Set<Occluder> {
    const out = new Set<Occluder>();
    // Long edges would visit many cells; fall back to scanning everything.
    const s = this.size;
    if (((Math.abs(x1 - x0) / s + 1) * (Math.abs(y1 - y0) / s + 1)) > this.all.length) return new Set(this.all);
    for (const key of this.keys(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1))) {
      for (const o of this.cells.get(key) ?? []) out.add(o);
    }
    return out;
  }
}

/**
 * Parameter interval (0..1) of segment ab hidden by triangle t seen from above:
 * inside the triangle's plan projection and below its surface. Both conditions are linear in t.
 */
function hiddenInterval(a: V3, b: V3, o: Occluder): [number, number] | null {
  const [p0, p1, p2] = o.t;
  // Orientation-independent half-planes of the projected triangle.
  const area2 = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
  if (Math.abs(area2) < 1e-9) return null; // vertical face: no area in plan
  const s = Math.sign(area2);
  let t0 = 0;
  let t1 = 1;
  const clip = (f0: number, f1: number) => {
    // Keep where f(t) = f0 + (f1 - f0) t ≥ 0.
    if (f0 < 0 && f1 < 0) return false;
    if (f0 >= 0 && f1 >= 0) return true;
    const t = f0 / (f0 - f1);
    if (f0 < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    return true;
  };
  for (let i = 0; i < 3; i++) {
    const u = o.t[i]!;
    const v = o.t[(i + 1) % 3]!;
    const side = (q: V3) => s * ((v[0] - u[0]) * (q[1] - u[1]) - (v[1] - u[1]) * (q[0] - u[0]));
    if (!clip(side(a), side(b))) return null;
  }
  // Depth: triangle plane height minus edge height, linear along the edge.
  const zAt = (q: V3) => {
    const w1 = ((q[0] - p0[0]) * (p2[1] - p0[1]) - (q[1] - p0[1]) * (p2[0] - p0[0])) / area2;
    const w2 = ((p1[0] - p0[0]) * (q[1] - p0[1]) - (p1[1] - p0[1]) * (q[0] - p0[0])) / area2;
    return p0[2] + (p1[2] - p0[2]) * w1 + (p2[2] - p0[2]) * w2;
  };
  if (!clip(zAt(a) - a[2] - DEPTH_EPS, zAt(b) - b[2] - DEPTH_EPS)) return null;
  return t1 - t0 > 1e-9 ? [t0, t1] : null;
}

function visibleIntervals(a: V3, b: V3, grid: OccluderGrid): [number, number][] {
  const hidden: [number, number][] = [];
  for (const o of grid.query(a[0], a[1], b[0], b[1])) {
    if (o.maxX < Math.min(a[0], b[0]) || o.minX > Math.max(a[0], b[0])) continue;
    if (o.maxY < Math.min(a[1], b[1]) || o.minY > Math.max(a[1], b[1])) continue;
    const h = hiddenInterval(a, b, o);
    if (h) hidden.push(h);
  }
  hidden.sort((x, y) => x[0] - y[0]);
  const visible: [number, number][] = [];
  let at = 0;
  for (const [h0, h1] of hidden) {
    if (h0 > at + 1e-9) visible.push([at, h0]);
    at = Math.max(at, h1);
  }
  if (at < 1 - 1e-9) visible.push([at, 1]);
  return visible;
}
