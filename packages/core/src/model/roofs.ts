import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat, attachedWalls, layerMaterialDeps, type LevelParams } from "./architecture.ts";
import { polygonArea, validateRegion } from "./sketch.ts";

// Footprint roofs (Revit "Roof by Footprint"): a boundary loop where each edge either defines
// a slope (rising inwards from the eave) or doesn't (a gable). The roof surface is the lower
// envelope of the edge planes, each limited to the wedge between the hip/valley lines at its
// ends. Exact for convex footprints and typical L/T/U house plans; complex footprints with
// split events would need a full weighted straight skeleton.

export type RoofParams = {
  levelId: ElementId;
  /** Eave (underside at the footprint) above the level, mm. */
  baseOffset: number;
  /** Footprint, counter-clockwise, plan mm. Usually the wall line plus overhang. */
  boundary: Vec2[];
  /** Per edge (boundary[i] → boundary[i+1]): slope angle in radians, or null for no slope (gable). */
  slopes: (number | null)[];
  /** Roof by Extrusion: a profile swept across the plan, instead of sloping from the footprint. */
  extrusion?: RoofExtrusion | null;
  /** Fascia, gutter and soffit along the eaves. */
  trims?: RoofTrims | null;
};
export type Roof = Element<RoofParams>;

/**
 * Roof by Extrusion (Revit): an open profile, drawn across a line in plan, extruded square to it.
 * The profile is the roof's underside; the type's thickness sits on it (measured vertically).
 */
export type RoofExtrusion = {
  /** The profile line in plan: its start and unit direction. */
  origin: Vec2;
  dir: Vec2;
  /** x along `dir` from `origin`, y up from the roof base, mm; at least two points, x increasing. */
  profile: Vec2[];
  /** Extent square to the profile line (to its left), mm. */
  start: number;
  end: number;
};

/** Eave trims: profile names (ROOF_TRIM_PROFILES) or null, and the soffit's depth back from the edge. */
export type RoofTrims = { fascia?: string | null; gutter?: string | null; soffit?: number | null };

/**
 * Trim profiles, mm: x out from the roof edge, y from the roof's top at the edge (fascias hang from
 * it; gutters hang off the fascia's face).
 */
export const ROOF_TRIM_PROFILES: Record<string, { kind: "fascia" | "gutter"; points: Vec2[] }> = {
  "Fascia 185 x 25": { kind: "fascia", points: [v(0, 0), v(25, 0), v(25, -185), v(0, -185)] },
  "Fascia 240 x 25": { kind: "fascia", points: [v(0, 0), v(25, 0), v(25, -240), v(0, -240)] },
  "Gutter - Quad 125": { kind: "gutter", points: [v(0, -25), v(0, -140), v(15, -150), v(110, -150), v(125, -30), v(117, -30), v(103, -142), v(19, -142), v(8, -134), v(8, -25)] },
  "Gutter - Half Round 125": { kind: "gutter", points: halfRound(62.5, 6, -40) },
};

function v(x: number, y: number): Vec2 {
  return { x, y };
}

function halfRound(r: number, wall: number, cy: number): Vec2[] {
  const out: Vec2[] = [];
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const t = Math.PI + (Math.PI * i) / n;
    out.push(v(r + r * Math.cos(t), cy + r * Math.sin(t)));
  }
  for (let i = n; i >= 0; i--) {
    const t = Math.PI + (Math.PI * i) / n;
    out.push(v(r + (r - wall) * Math.cos(t), cy + (r - wall) * Math.sin(t)));
  }
  return out;
}

export function trimProfileNames(kind: "fascia" | "gutter"): string[] {
  return Object.entries(ROOF_TRIM_PROFILES)
    .filter(([, x]) => x.kind === kind)
    .map(([k]) => k);
}

/** Extrusion roof profiles: a gable or mono-pitch at `pitch` (radians), or a curve rising `rise`. */
export function extrusionProfile(shape: "gable" | "mono" | "curved", width: number, pitchOrRise: number): Vec2[] {
  if (shape === "gable") return [v(0, 0), v(width / 2, (width / 2) * Math.tan(pitchOrRise)), v(width, 0)];
  if (shape === "mono") return [v(0, 0), v(width, width * Math.tan(pitchOrRise))];
  // Circular arc through both ends and the middle at `rise`.
  const h = pitchOrRise;
  const R = (width * width) / (8 * h) + h / 2;
  const cy = h - R;
  const n = 16;
  const half = Math.asin(width / 2 / R);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = -half + (2 * half * i) / n;
    return v(width / 2 + R * Math.sin(t), cy + R * Math.cos(t));
  });
}

function validateExtrusion(e: RoofExtrusion): void {
  if (e.profile.length < 2) throw new Error("An extrusion roof profile needs at least two points");
  for (let i = 1; i < e.profile.length; i++) if (!(e.profile[i]!.x > e.profile[i - 1]!.x)) throw new Error("Extrusion roof profile points must run one way (x increasing)");
  if (!(e.end > e.start)) throw new Error("An extrusion roof needs a length");
  if (Math.abs(Math.hypot(e.dir.x, e.dir.y) - 1) > 1e-6) throw new Error("Extrusion direction must be a unit vector");
}

/** The plan rectangle an extrusion roof covers, counter-clockwise. */
export function extrusionFootprint(e: RoofExtrusion): Vec2[] {
  const n = { x: -e.dir.y, y: e.dir.x };
  const x0 = e.profile[0]!.x;
  const x1 = e.profile[e.profile.length - 1]!.x;
  const at = (s: number, t: number) => v(e.origin.x + e.dir.x * s + n.x * t, e.origin.y + e.dir.y * s + n.y * t);
  return [at(x0, e.start), at(x1, e.start), at(x1, e.end), at(x0, e.end)];
}

/**
 * Roof by Extrusion over the plan rectangle from corner `a` to corner `b`: the profile runs across
 * the shorter side (a gable across the width) and extrudes along the longer.
 */
export function createExtrusionRoof(
  tx: Transaction,
  typeId: ElementId,
  levelId: ElementId,
  a: Vec2,
  b: Vec2,
  opts: { shape?: "gable" | "mono" | "curved"; pitch?: number; rise?: number; baseOffset?: number } = {},
): Roof {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  if (x1 - x0 < 100 || y1 - y0 < 100) throw new Error("Draw the roof's rectangle: click two opposite corners");
  const across = x1 - x0 <= y1 - y0;
  const width = across ? x1 - x0 : y1 - y0;
  const length = across ? y1 - y0 : x1 - x0;
  const shape = opts.shape ?? "gable";
  const profile = extrusionProfile(shape, width, shape === "curved" ? (opts.rise ?? width / 6) : (opts.pitch ?? DEFAULT_ROOF_SLOPE));
  // Across x: profile along +x from (x0, y0), extruded to its left (+y). Across y: along +y from (x1, y0), extruded left (−x).
  const extrusion: RoofExtrusion = across ? { origin: v(x0, y0), dir: v(1, 0), profile, start: 0, end: length } : { origin: v(x1, y0), dir: v(0, 1), profile, start: 0, end: length };
  validateExtrusion(extrusion);
  const boundary = extrusionFootprint(extrusion);
  return tx.create<RoofParams>(Cat.Roof, { levelId, baseOffset: opts.baseOffset ?? 0, boundary, slopes: boundary.map(() => null), extrusion }, { typeId });
}

/** Set an extrusion roof's profile/extent (its footprint follows). */
export function setRoofExtrusion(tx: Transaction, doc: Document, id: ElementId, e: RoofExtrusion): void {
  const roof = doc.require<RoofParams>(id);
  if (roof.category !== Cat.Roof || !roof.params.extrusion) throw new Error("Not an extrusion roof");
  validateExtrusion(e);
  const boundary = extrusionFootprint(e);
  tx.update<RoofParams>(id, { extrusion: { ...e, profile: e.profile.map((q) => ({ ...q })) }, boundary, slopes: boundary.map(() => null) });
}

/** Underside height (above the roof base) of an extrusion roof at plan point `p`, or null outside it. */
export function extrusionHeightAt(e: RoofExtrusion, p: Vec2): number | null {
  const n = { x: -e.dir.y, y: e.dir.x };
  const s = (p.x - e.origin.x) * e.dir.x + (p.y - e.origin.y) * e.dir.y;
  const t = (p.x - e.origin.x) * n.x + (p.y - e.origin.y) * n.y;
  if (t < e.start - 1e-6 || t > e.end + 1e-6) return null;
  const P = e.profile;
  if (s < P[0]!.x - 1e-6 || s > P[P.length - 1]!.x + 1e-6) return null;
  for (let i = 0; i + 1 < P.length; i++) {
    const a = P[i]!;
    const b = P[i + 1]!;
    if (s <= b.x + 1e-9) return a.y + ((b.y - a.y) * (s - a.x)) / (b.x - a.x);
  }
  return P[P.length - 1]!.y;
}

/**
 * The roof's eaves, for fascias and gutters: plan line a → b, outward unit normal, and the underside
 * height above the roof base along it. Footprint roofs: their sloped edges; extrusion roofs: the
 * profile's two ends, where they fall away.
 */
export function roofEaves(roof: Roof): { a: Vec2; b: Vec2; out: Vec2; z: number }[] {
  const e = roof.params.extrusion;
  if (e) {
    const n = { x: -e.dir.y, y: e.dir.x };
    const P = e.profile;
    const at = (s: number, t: number) => v(e.origin.x + e.dir.x * s + n.x * t, e.origin.y + e.dir.y * s + n.y * t);
    const out: { a: Vec2; b: Vec2; out: Vec2; z: number }[] = [];
    const first = P[0]!;
    const last = P[P.length - 1]!;
    if (P[1]!.y >= first.y) out.push({ a: at(first.x, e.end), b: at(first.x, e.start), out: v(-e.dir.x, -e.dir.y), z: first.y });
    if (P[P.length - 2]!.y >= last.y) out.push({ a: at(last.x, e.start), b: at(last.x, e.end), out: v(e.dir.x, e.dir.y), z: last.y });
    return out;
  }
  const { boundary, slopes } = roof.params;
  return boundary.flatMap((a, i) => {
    if (slopes[i] == null) return [];
    const b = boundary[(i + 1) % boundary.length]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return [{ a, b, out: v((b.y - a.y) / l, -(b.x - a.x) / l), z: 0 }];
  });
}

/** 25°, a common NZ pitch for long-run steel roofs. */
export const DEFAULT_ROOF_SLOPE = (25 * Math.PI) / 180;

registerCategory({ name: Cat.RoofType, dependencies: layerMaterialDeps, cascadeDelete: false, isType: true });
registerCategory({
  name: Cat.Roof,
  dependencies: (el) => [(el.params as RoofParams).levelId, ...(el.typeId ? [el.typeId] : [])],
  related: (doc, el) => attachedWalls(doc, el.id),
  cascadeDelete: true,
  isType: false,
});

/**
 * Create a footprint roof. `slopes` defaults to every edge sloped at 25°.
 * A clockwise footprint is reversed, with its slopes kept on the same physical edges.
 */
export function createRoof(
  tx: Transaction,
  typeId: ElementId,
  levelId: ElementId,
  boundary: Vec2[],
  opts: { slopes?: (number | null)[]; baseOffset?: number } = {},
): Roof {
  const { boundary: b, slopes } = normaliseFootprint(boundary, opts.slopes ?? boundary.map(() => DEFAULT_ROOF_SLOPE));
  return tx.create<RoofParams>(Cat.Roof, { levelId, baseOffset: opts.baseOffset ?? 0, boundary: b, slopes }, { typeId });
}

/** Validate a footprint and make it counter-clockwise, remapping per-edge slopes to match. */
export function normaliseFootprint(boundary: Vec2[], slopes: (number | null)[]): { boundary: Vec2[]; slopes: (number | null)[] } {
  if (slopes.length !== boundary.length) throw new Error("Roof needs one slope entry per footprint edge");
  for (const s of slopes) {
    if (s !== null && !(s > 0 && s < Math.PI / 2)) throw new Error("Roof slopes must be between 0° and 90°");
  }
  let b = boundary;
  let sl = slopes;
  if (polygonArea(boundary) < 0) {
    // Reversed edge m runs p[n-1-m] → p[n-2-m], i.e. original edge (n-2-m) mod n.
    const n = boundary.length;
    b = [...boundary].reverse();
    sl = b.map((_, m) => slopes[(((n - 2 - m) % n) + n) % n]!);
  }
  const region = validateRegion({ boundary: b, holes: [] });
  if (region.boundary.length !== b.length) throw new Error("Roof footprint has a repeated point");
  return { boundary: region.boundary, slopes: sl };
}

/** Absolute Z of the roof base (eave underside), mm. */
export function roofBaseElevation(doc: Document, roof: Roof): number {
  return doc.require<LevelParams>(roof.params.levelId).params.elevation + roof.params.baseOffset;
}

// ---- roof surface -----------------------------------------------------------

/** One sloped edge's plane: height = k · n·(p − a), valid inside its wedge. */
export interface RoofPlane {
  edge: number;
  a: Vec2;
  b: Vec2;
  /** Inward unit normal. */
  n: Vec2;
  /** tan(slope): rise per mm inwards. */
  k: number;
  /** Hip/valley/gable directions bounding the wedge at a and b; null = unbounded on that side. */
  va: Vec2 | null;
  vb: Vec2 | null;
}

const EPS = 1e-6;
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
const unit = (v: Vec2): Vec2 => {
  const l = Math.hypot(v.x, v.y);
  return { x: v.x / l, y: v.y / l };
};

/** Direction from vertex `v` (between edge `prev` and edge `next`) along which their planes meet. */
function cornerDirection(
  v: Vec2,
  prevStart: Vec2,
  nextEnd: Vec2,
  n1: Vec2,
  k1: number | null,
  n2: Vec2,
  k2: number | null,
): Vec2 | null {
  if (k1 === null && k2 === null) return null;
  if (k1 === null) return unit(sub(prevStart, v)); // gable before: the sloped face runs up to it
  if (k2 === null) return unit(sub(nextEnd, v)); // gable after
  const w = { x: k1 * n1.x - k2 * n2.x, y: k1 * n1.y - k2 * n2.y };
  if (Math.hypot(w.x, w.y) < EPS) return null; // collinear, same slope
  let d = unit({ x: -w.y, y: w.x });
  if (dot(n1, d) < 0) d = { x: -d.x, y: -d.y };
  if (dot(n1, d) < EPS) return null; // collinear edges with different slopes
  return d;
}

/** Planes for the sloped edges of a counter-clockwise footprint. */
export function roofPlanes(boundary: Vec2[], slopes: (number | null)[]): RoofPlane[] {
  const n = boundary.length;
  const normals = boundary.map((p, i) => {
    const d = unit(sub(boundary[(i + 1) % n]!, p));
    return { x: -d.y, y: d.x }; // left of a CCW edge = inside
  });
  const k = slopes.map((s) => (s === null ? null : Math.tan(s)));
  const corner = (i: number) => {
    // Vertex i sits between edge i-1 and edge i.
    const prev = (i - 1 + n) % n;
    return cornerDirection(boundary[i]!, boundary[prev]!, boundary[(i + 1) % n]!, normals[prev]!, k[prev]!, normals[i]!, k[i]!);
  };
  const planes: RoofPlane[] = [];
  for (let i = 0; i < n; i++) {
    const ki = k[i];
    if (ki === null || ki === undefined) continue;
    planes.push({ edge: i, a: boundary[i]!, b: boundary[(i + 1) % n]!, n: normals[i]!, k: ki, va: corner(i), vb: corner((i + 1) % n) });
  }
  return planes;
}

export function planeHeight(pl: RoofPlane, p: Vec2): number {
  return pl.k * dot(pl.n, sub(p, pl.a));
}

/** Is `p` inside the plane's wedge (inner side of its eave, between its corner lines)? */
export function inWedge(pl: RoofPlane, p: Vec2, eps = 1e-6): boolean {
  if (dot(pl.n, sub(p, pl.a)) < -eps) return false;
  if (pl.va && cross(pl.va, sub(p, pl.a)) * Math.sign(cross(pl.va, sub(pl.b, pl.a))) < -eps) return false;
  if (pl.vb && cross(pl.vb, sub(p, pl.b)) * Math.sign(cross(pl.vb, sub(pl.a, pl.b))) < -eps) return false;
  return true;
}

/** The plane that forms the roof surface at `p`, or null for a flat roof. */
export function roofPlaneAt(planes: RoofPlane[], p: Vec2): RoofPlane | null {
  let best: RoofPlane | null = null;
  let bestH = Infinity;
  for (const pl of planes) {
    if (!inWedge(pl, p)) continue;
    const h = planeHeight(pl, p);
    if (h < bestH) [best, bestH] = [pl, h];
  }
  return best;
}

/** Height of the roof surface above its base at plan point `p`, mm (0 for a flat roof). */
export function roofHeightAt(planes: RoofPlane[], p: Vec2): number {
  const pl = roofPlaneAt(planes, p);
  return pl ? Math.max(0, planeHeight(pl, p)) : 0;
}
