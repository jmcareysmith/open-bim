import earcut from "earcut";
import {
  planeHeight,
  ROOF_TRIM_PROFILES,
  roofEaves,
  roofBaseElevation,
  roofPlaneAt,
  roofPlanes,
  totalThickness,
  type Document,
  type Element,
  type LayeredTypeParams,
  type Roof,
  type RoofPlane,
  type Vec2,
} from "@open-bim/core";
import { signedArea, type MeshData } from "./mesh.ts";
import { mergeMeshes } from "./doors.ts";
import { profilePrism } from "./sweeps.ts";

/** A convex piece of the footprint lying on a single roof plane (null = flat). */
export interface RoofCell {
  poly: Vec2[];
  plane: RoofPlane | null;
}

/** Line n·p = c. */
interface CutLine {
  n: Vec2;
  c: number;
}

const EPS = 1e-7;

/**
 * Split the footprint into convex cells so the roof surface is a single plane on each.
 * The lowest plane can only change where two planes are equal or a plane's wedge ends,
 * so cutting along all those lines is enough.
 */
export function roofCells(boundary: Vec2[], planes: RoofPlane[]): RoofCell[] {
  const lines: CutLine[] = [];
  const add = (n: Vec2, c: number) => {
    const l = Math.hypot(n.x, n.y);
    if (l < EPS) return;
    lines.push({ n: { x: n.x / l, y: n.y / l }, c: c / l });
  };
  const through = (p: Vec2, d: Vec2) => add({ x: -d.y, y: d.x }, -d.y * p.x + d.x * p.y);
  for (const pl of planes) {
    add(pl.n, pl.n.x * pl.a.x + pl.n.y * pl.a.y); // eave line
    if (pl.va) through(pl.a, pl.va);
    if (pl.vb) through(pl.b, pl.vb);
  }
  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      const p = planes[i]!;
      const q = planes[j]!;
      // k_p n_p·(x − a_p) = k_q n_q·(x − a_q)
      const n = { x: p.k * p.n.x - q.k * q.n.x, y: p.k * p.n.y - q.k * q.n.y };
      add(n, p.k * (p.n.x * p.a.x + p.n.y * p.a.y) - q.k * (q.n.x * q.a.x + q.n.y * q.a.y));
    }
  }

  const flat: number[] = boundary.flatMap((p) => [p.x, p.y]);
  const tris = earcut(flat);
  let pieces: Vec2[][] = [];
  for (let t = 0; t < tris.length; t += 3) pieces.push([tris[t]!, tris[t + 1]!, tris[t + 2]!].map((i) => boundary[i]!));
  const scale = Math.max(...boundary.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))), 1);
  for (const line of dedupe(lines, scale)) pieces = pieces.flatMap((poly) => splitConvex(poly, line, scale));

  return pieces
    .filter((poly) => Math.abs(signedArea(poly)) > 1e-3)
    .map((poly) => {
      const ccw = signedArea(poly) >= 0 ? poly : [...poly].reverse();
      const c = ccw.reduce((s, p) => ({ x: s.x + p.x / ccw.length, y: s.y + p.y / ccw.length }), { x: 0, y: 0 });
      return { poly: ccw, plane: roofPlaneAt(planes, c) };
    });
}

function dedupe(lines: CutLine[], scale: number): CutLine[] {
  const out: CutLine[] = [];
  for (const l of lines) {
    // Canonical sign so n and −n compare equal.
    const s = l.n.x < -EPS || (Math.abs(l.n.x) <= EPS && l.n.y < 0) ? -1 : 1;
    const m = { n: { x: l.n.x * s, y: l.n.y * s }, c: l.c * s };
    if (!out.some((o) => Math.abs(o.n.x - m.n.x) < 1e-9 && Math.abs(o.n.y - m.n.y) < 1e-9 && Math.abs(o.c - m.c) < 1e-9 * scale)) {
      out.push(m);
    }
  }
  return out;
}

/** Split a convex polygon by a line into up to two convex polygons. */
function splitConvex(poly: Vec2[], line: CutLine, scale: number): Vec2[][] {
  const tol = 1e-9 * scale;
  const d = poly.map((p) => line.n.x * p.x + line.n.y * p.y - line.c);
  if (d.every((v) => v >= -tol) || d.every((v) => v <= tol)) return [poly];
  const pos: Vec2[] = [];
  const neg: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const dp = d[i]!;
    const dq = d[(i + 1) % poly.length]!;
    if (dp >= -tol) pos.push(p);
    if (dp <= tol) neg.push(p);
    if ((dp > tol && dq < -tol) || (dp < -tol && dq > tol)) {
      const t = dp / (dp - dq);
      const x = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
      pos.push(x);
      neg.push(x);
    }
  }
  return [pos, neg].filter((p) => p.length >= 3);
}

/**
 * Roof solid: the roof surface lifted by the type's thickness (measured vertically),
 * closed with vertical fascia/gable faces around the footprint.
 */
export function buildRoof(doc: Document, el: Element): MeshData | null {
  const roof = el as Roof;
  if (!roof.typeId) throw new Error("Roof has no type");
  const t = totalThickness(doc.require<LayeredTypeParams>(roof.typeId));
  if (t <= 0) return null;
  const base = roofBaseElevation(doc, roof);
  const e = roof.params.extrusion;
  // Roof by Extrusion: the profile (underside) and the same line `t` higher, swept square to it.
  const body = e ? profilePrism([...e.profile, ...[...e.profile].reverse().map((q) => ({ x: q.x, y: q.y + t }))], e.origin, { x: -e.dir.y, y: e.dir.x }, e.dir, base, e.start, e.end) : footprintRoofBody(roof, base, t);
  const trims = roofTrimMeshes(roof, base, t);
  return trims.length ? mergeMeshes([body, ...trims]) : body;
}

/** Fascia, gutter and soffit along each eave, merged with the roof. */
export function roofTrimMeshes(roof: Roof, base: number, t: number): MeshData[] {
  const tr = roof.params.trims;
  if (!tr || (!tr.fascia && !tr.gutter && !tr.soffit)) return [];
  const fascia = tr.fascia ? ROOF_TRIM_PROFILES[tr.fascia]?.points : undefined;
  const gutter = tr.gutter ? ROOF_TRIM_PROFILES[tr.gutter]?.points : undefined;
  const fT = fascia ? Math.max(...fascia.map((q) => q.x)) : 0;
  const fD = fascia ? -Math.min(...fascia.map((q) => q.y)) : t;
  const out: MeshData[] = [];
  for (const eave of roofEaves(roof)) {
    const len = Math.hypot(eave.b.x - eave.a.x, eave.b.y - eave.a.y);
    if (len < 1) continue;
    const d = { x: (eave.b.x - eave.a.x) / len, y: (eave.b.y - eave.a.y) / len };
    const top = base + eave.z + t;
    // Each runs a little past the corner so neighbouring eaves meet.
    if (fascia) out.push(profilePrism(fascia, eave.a, d, eave.out, top, -fT, len + fT));
    if (gutter) {
      const g = gutter.map((q) => ({ x: q.x + fT, y: q.y }));
      const gx = Math.max(...g.map((q) => q.x));
      out.push(profilePrism(g, eave.a, d, eave.out, top, -gx, len + gx));
    }
    if (tr.soffit && tr.soffit > 0) {
      const s = [
        { x: -tr.soffit, y: -fD },
        { x: 0, y: -fD },
        { x: 0, y: -fD + 10 },
        { x: -tr.soffit, y: -fD + 10 },
      ];
      out.push(profilePrism(s, eave.a, d, eave.out, top, 0, len));
    }
  }
  return out;
}

/** A footprint roof's solid: its sloped surface lifted by the thickness, closed round the edge. */
function footprintRoofBody(roof: Roof, base: number, t: number): MeshData {
  const { boundary, slopes } = roof.params;
  const cells = roofCells(boundary, roofPlanes(boundary, slopes));

  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => {
    const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const l = Math.hypot(n[0]!, n[1]!, n[2]!);
    if (l === 0) return;
    const i0 = pos.length / 3;
    for (const p of [a, b, c]) {
      pos.push(p[0]!, p[1]!, p[2]!);
      nor.push(n[0]! / l, n[1]! / l, n[2]! / l);
    }
    idx.push(i0, i0 + 1, i0 + 2);
  };

  for (const { poly, plane } of cells) {
    const h = (p: Vec2) => (plane ? Math.max(0, planeHeight(plane, p)) : 0);
    const bot = poly.map((p) => [p.x, p.y, base + h(p)]);
    const top = poly.map((p) => [p.x, p.y, base + h(p) + t]);
    for (let i = 1; i < poly.length - 1; i++) {
      tri(top[0]!, top[i]!, top[i + 1]!);
      tri(bot[0]!, bot[i + 1]!, bot[i]!);
    }
    // Cell edges on the footprint get a vertical face (fascia under sloped edges, gable ends).
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      if (!onBoundary(poly[i]!, poly[j]!, boundary)) continue;
      tri(bot[i]!, bot[j]!, top[j]!);
      tri(bot[i]!, top[j]!, top[i]!);
    }
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), indices: new Uint32Array(idx) };
}

/** True if segment pq lies along one footprint edge. */
function onBoundary(p: Vec2, q: Vec2, boundary: Vec2[]): boolean {
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i]!;
    const b = boundary[(i + 1) % boundary.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const off = (v: Vec2) => Math.abs((v.x - a.x) * dy - (v.y - a.y) * dx) / len;
    const along = (v: Vec2) => ((v.x - a.x) * dx + (v.y - a.y) * dy) / (len * len);
    const tol = 1e-6 * Math.max(len, 1);
    if (off(p) < tol && off(q) < tol) {
      const s = along(p);
      const e = along(q);
      if (Math.min(s, e) >= -1e-9 && Math.max(s, e) <= 1 + 1e-9) return true;
    }
  }
  return false;
}
