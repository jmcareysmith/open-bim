import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat, layerMaterialDeps, type LevelParams } from "./architecture.ts";
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
};
export type Roof = Element<RoofParams>;

/** 25°, a common NZ pitch for long-run steel roofs. */
export const DEFAULT_ROOF_SLOPE = (25 * Math.PI) / 180;

registerCategory({ name: Cat.RoofType, dependencies: layerMaterialDeps, cascadeDelete: false, isType: true });
registerCategory({
  name: Cat.Roof,
  dependencies: (el) => [(el.params as RoofParams).levelId, ...(el.typeId ? [el.typeId] : [])],
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
