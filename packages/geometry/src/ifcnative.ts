import polygonClipping, { type Polygon } from "polygon-clipping";
import {
  Cat,
  createFloor,
  createWall,
  createWallOpening,
  createDoor,
  createWindow,
  createColumn,
  createBeam,
  createRoof,
  createCeiling,
  createDuct,
  createPipe,
  ensureDuctTypes,
  ensurePipeTypes,
  PIPE_SIZES,
  pipeTypeFor,
  type SystemClassification,
  createRamp,
  type RampParams,
  type RampTypeParams,
  createPadFooting,
  createStripFooting,
  setWallCurve,
  setWallProfile,
  createStair,
  createStairType,
  stairLayout,
  type Stair,
  createRailing,
  type RailingParams,
  type RailingTypeParams,
  type StairParams,
  type StairTypeParams,
  type BeamParams,
  type ColumnParams,
  type StructuralSectionParams,
  type DoorTypeParams,
  type FamilyCategory,
  type MeshFormParams,
  Document as BimDocument,
  applyFamilyTemplate,
  familyDefs,
  familyTypeNames,
  loadFamily,
  placeFamilyInstance,
  type WallParams,
  type Wall,
  wallThickness,
  wallFunction,
  type Material,
  type MaterialParams,
  createMaterial,
  materialByName,
  type WindowTypeParams,
  type DirectShape,
  type DirectShapeParams,
  type Document,
  type ElementId,
  type LayeredTypeParams,
  type LevelParams,
  type Transaction,
  type Vec2,
} from "@open-bim/core";

// IFC import → native elements (Revit: imported IFC walls and slabs become real ones when their
// shapes allow). An imported IfcWall that's a straight box becomes a Wall (type matched by
// thickness, else a new single-layer type), an IfcSlab a Floor (outline from its top faces,
// type by thickness), and imported doors/windows sitting in a converted wall cut openings in it
// (the imported shapes stay, now visible through the opening).

const WALL_CLASSES = new Set(["IfcWall", "IfcWallStandardCase"]);
const SLAB_CLASSES = new Set(["IfcSlab"]);
const COLUMN_CLASSES = new Set(["IfcColumn"]);
const FOOTING_CLASSES = new Set(["IfcFooting"]);
/** Coverings: ceilings (flat, like slabs). */
const CEILING_CLASSES = new Set(["IfcCovering"]);
const BEAM_CLASSES = new Set(["IfcBeam", "IfcMember"]);
const ROOF_CLASSES = new Set(["IfcRoof"]);
const STAIR_CLASSES = new Set(["IfcStair", "IfcStairFlight"]);
const RAMP_CLASSES = new Set(["IfcRamp", "IfcRampFlight"]);
/** MEP runs (fittings are remade by the fitting hook where the converted runs meet). */
const RUN_CLASSES = new Set(["IfcDuctSegment", "IfcPipeSegment"]);
const FITTING_CLASSES = new Set(["IfcDuctFitting", "IfcPipeFitting"]);
const RAILING_CLASSES = new Set(["IfcRailing"]);
/** Loadable-family categories an imported class stands for (furniture, fixtures, equipment, generic). */
const FAMILY_OF: Record<string, FamilyCategory> = {
  IfcFurniture: "Furniture",
  IfcFurnishingElement: "Furniture",
  IfcBuildingElementProxy: "GenericModel",
  IfcAirTerminal: "AirTerminal",
  IfcUnitaryEquipment: "MechanicalEquipment",
  IfcSanitaryTerminal: "PlumbingFixture",
  IfcFireSuppressionTerminal: "Sprinkler",
  IfcLightFixture: "LightingFixture",
  IfcOutlet: "ElectricalFixture",
  IfcElectricDistributionBoard: "ElectricalEquipment",
};
/** Curtain wall parts (Revit exports a curtain wall as its panels and mullions). */
const PLATE_CLASSES = new Set(["IfcPlate"]);
const INSERT_CLASSES = new Set(["IfcDoor", "IfcWindow"]);

/** Can this imported shape become a native element? */
export function convertible(el: { category: string; params: unknown }): boolean {
  if (el.category !== Cat.DirectShape) return false;
  const c = (el.params as DirectShapeParams).ifcClass;
  return WALL_CLASSES.has(c) || SLAB_CLASSES.has(c) || CEILING_CLASSES.has(c) || FOOTING_CLASSES.has(c) || COLUMN_CLASSES.has(c) || BEAM_CLASSES.has(c) || ROOF_CLASSES.has(c) || STAIR_CLASSES.has(c) || RAMP_CLASSES.has(c) || RUN_CLASSES.has(c) || FITTING_CLASSES.has(c) || RAILING_CLASSES.has(c) || PLATE_CLASSES.has(c) || c in FAMILY_OF;
}

function hull(pts: Vec2[]): Vec2[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Vec2[] = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

const polyArea = (l: Vec2[]) => Math.abs(l.reduce((s, q, i) => s + q.x * l[(i + 1) % l.length]!.y - l[(i + 1) % l.length]!.x * q.y, 0)) / 2;

function snapWallEnds(tx: Transaction, doc: Document, ids: ElementId[]): void {
  const ws = () => ids.map((id) => doc.get<WallParams>(id) as Wall | undefined).filter((w): w is Wall => !!w && !w.params.curve);
  for (const w0 of ws()) {
    const w = doc.require<WallParams>(w0.id) as Wall;
    const tw = wallThickness(doc, w);
    const patch: Partial<WallParams> = {};
    for (const end of ["start", "end"] as const) {
      const e = w.params[end];
      let best: Vec2 | null = null;
      let bestD = Infinity;
      for (const o of ws()) {
        if (o.id === w.id) continue;
        const to = wallThickness(doc, o);
        const reach = Math.max(tw, to);
        const a = w.params.start;
        const b = w.params.end;
        const c = o.params.start;
        const d = o.params.end;
        const r = { x: b.x - a.x, y: b.y - a.y };
        const s2 = { x: d.x - c.x, y: d.y - c.y };
        const den = r.x * s2.y - r.y * s2.x;
        if (Math.abs(den) < 1e-6 * Math.hypot(r.x, r.y) * Math.hypot(s2.x, s2.y)) continue;
        const t = ((c.x - a.x) * s2.y - (c.y - a.y) * s2.x) / den;
        const x = { x: a.x + r.x * t, y: a.y + r.y * t };
        const dist = Math.hypot(x.x - e.x, x.y - e.y);
        // On (or just past the ends of) the other wall.
        const lo = Math.hypot(s2.x, s2.y);
        const v = ((x.x - c.x) * s2.x + (x.y - c.y) * s2.y) / lo;
        if (dist <= reach && v >= -reach && v <= lo + reach && dist < bestD) [best, bestD] = [x, dist];
      }
      if (best && bestD > 0.5) patch[end] = best;
    }
    if (patch.start || patch.end) {
      tx.update<WallParams>(w.id, patch);
    }
  }
}

/** Exterior or interior, from the wall's IsExternal property (Pset_WallCommon), when it says. */
function wallRole(p: DirectShapeParams): "exterior" | "interior" | undefined {
  const v = Object.entries(p.properties).find(([k]) => /(^|\.)IsExternal$/.test(k))?.[1];
  if (v === undefined) return undefined;
  return /^(\.?t\.?|true|yes|1)$/i.test(v.trim()) ? "exterior" : "interior";
}

/** Mesh points as (distance along a line from `start` in direction `u`, height). */
function xyzAlong(p: DirectShapeParams, start: Vec2, u: Vec2): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < p.positions.length; i += 3) out.push({ x: (p.positions[i]! - start.x) * u.x + (p.positions[i + 1]! - start.y) * u.y, y: p.positions[i + 2]! });
  return out;
}

/** Smallest rectangle round the points (on a hull edge): centre, long axis, length and width. */
function minRect(pts: Vec2[]): { c: Vec2; u: Vec2; len: number; wid: number; hullArea: number } | null {
  const h = hull(pts);
  if (h.length < 3) return null;
  let best: { c: Vec2; u: Vec2; len: number; wid: number } | null = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i]!;
    const b = h[(i + 1) % h.length]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l < 1e-6) continue;
    const u = { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const q of h) {
      const su = q.x * u.x + q.y * u.y;
      const sv = -q.x * u.y + q.y * u.x;
      u0 = Math.min(u0, su); u1 = Math.max(u1, su); v0 = Math.min(v0, sv); v1 = Math.max(v1, sv);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.len * best.wid) {
      const cu = (u0 + u1) / 2;
      const cv = (v0 + v1) / 2;
      const c = { x: u.x * cu - u.y * cv, y: u.y * cu + u.x * cv };
      // Long axis first.
      best = u1 - u0 >= v1 - v0 ? { c, u, len: u1 - u0, wid: v1 - v0 } : { c, u: { x: -u.y, y: u.x }, len: v1 - v0, wid: u1 - u0 };
    }
  }
  return best ? { ...best, hullArea: polyArea(h) } : null;
}

function bounds(p: DirectShapeParams) {
  const xy: Vec2[] = [];
  let z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < p.positions.length; i += 3) {
    xy.push({ x: p.positions[i]!, y: p.positions[i + 1]! });
    z0 = Math.min(z0, p.positions[i + 2]!);
    z1 = Math.max(z1, p.positions[i + 2]!);
  }
  return { xy, z0, z1 };
}

const typeThickness = (t: LayeredTypeParams) => t.layers.reduce((s, l) => s + l.thickness, 0);

/** A layered type of this category and total thickness, or a new single-layer one. */
function typeFor(tx: Transaction, doc: Document, category: string, label: string, t: number, color?: number, role?: "exterior" | "interior"): ElementId {
  // Walls: an exterior and an interior wall of one thickness are different types (H1 needs to know).
  const fits = (x: { params: LayeredTypeParams }) => !role || (x.params as { function?: string }).function === role || (!(x.params as { function?: string }).function && wallFunction(x as never) === role);
  const have = doc.byCategory<LayeredTypeParams>(category).find((x) => !x.params.curtain && !x.params.stack?.length && Math.abs(typeThickness(x.params) - t) < 0.5 && fits(x));
  if (have) return have.id;
  const r = Math.round(t);
  if (role) {
    const mat = color !== undefined ? materialFor(tx, doc, color) : undefined;
    const layer = { function: "structure" as const, material: mat?.name ?? "Imported", thickness: r, ...(mat ? { materialId: mat.id } : {}) };
    const name = `${label} ${r} ${role === "exterior" ? "Exterior" : "Interior"}`;
    return tx.create<LayeredTypeParams & { function: string }>(category, { layers: [layer], function: role }, { name }).id;
  }
  const mat = color !== undefined ? materialFor(tx, doc, color) : undefined;
  const layer = { function: "structure" as const, material: mat?.name ?? "Imported", thickness: r, ...(mat ? { materialId: mat.id } : {}) };
  return tx.create<LayeredTypeParams>(category, { layers: [layer] }, { name: `${label} ${r}` }).id;
}

type Plane = { tri: [Vec2, Vec2, Vec2]; a: number; b: number; c: number };

/** Faces of a mesh as planes z = a·x + b·y + c (up: facing up, else down), skipping steep ones. */
function facePlanes(p: DirectShapeParams, up: boolean): Plane[] {
  const out: Plane[] = [];
  const P = p.positions;
  for (let i = 0; i < p.indices.length; i += 3) {
    const v = [p.indices[i]! * 3, p.indices[i + 1]! * 3, p.indices[i + 2]! * 3].map((k) => [P[k]!, P[k + 1]!, P[k + 2]!] as const);
    const [A, B, C] = v as [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    const l = Math.hypot(n[0]!, n[1]!, n[2]!);
    if (l < 1e-9 || (up ? n[2]! / l < 0.2 : n[2]! / l > -0.2)) continue;
    const a = -n[0]! / n[2]!;
    const b = -n[1]! / n[2]!;
    out.push({ tri: [{ x: A[0], y: A[1] }, { x: B[0], y: B[1] }, { x: C[0], y: C[1] }], a, b, c: A[2] - a * A[0] - b * A[1] });
  }
  return out;
}

/** The highest (top) or lowest (bottom) face over a plan point. */
function planeAt(planes: Plane[], q: Vec2, highest: boolean): Plane | null {
  let best: Plane | null = null;
  let bz = highest ? -Infinity : Infinity;
  for (const pl of planes) {
    const [a, b, c] = pl.tri;
    const d = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(d) < 1e-9) continue;
    const s = ((q.x - a.x) * (c.y - a.y) - (q.y - a.y) * (c.x - a.x)) / d;
    const t = ((b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x)) / d;
    if (s < -1e-6 || t < -1e-6 || s + t > 1 + 1e-6) continue;
    const z = pl.a * q.x + pl.b * q.y + pl.c;
    if (highest ? z > bz : z < bz) [best, bz] = [pl, z];
  }
  return best;
}

/**
 * Roof: a footprint roof from an imported roof's shape — the outline of its top faces, each eave's
 * slope from the face just inside it (none rising from it: a gable), thickness from top to bottom.
 */
function roofFromMesh(tx: Transaction, doc: Document, p: DirectShapeParams, lvl: number, z0: number, mat?: number): ElementId | null {
  const tops = facePlanes(p, true);
  if (!tops.length) return null;
  let outline: Polygon[] = [];
  try {
    const polys = tops.map((t): Polygon => [[...t.tri.map((q): [number, number] => [q.x, q.y]), [t.tri[0].x, t.tri[0].y]]]);
    outline = polygonClipping.union(polys[0]!, ...polys.slice(1));
  } catch {
    return null;
  }
  const big = outline.map((poly) => poly[0]!.slice(0, -1).map(([x, y]) => ({ x, y }))).sort((a, b) => polyArea(b) - polyArea(a))[0];
  if (!big || big.length < 3) return null;
  // Counter-clockwise, without points in the middle of straight runs.
  let ring = big;
  let s2 = 0;
  ring.forEach((q, i) => (s2 += q.x * ring[(i + 1) % ring.length]!.y - ring[(i + 1) % ring.length]!.x * q.y));
  if (s2 < 0) ring = [...ring].reverse();
  ring = ring.filter((q, i) => {
    const a = ring[(i - 1 + ring.length) % ring.length]!;
    const b = ring[(i + 1) % ring.length]!;
    return Math.abs((q.x - a.x) * (b.y - q.y) - (q.y - a.y) * (b.x - q.x)) > 1 * Math.hypot(b.x - a.x, b.y - a.y);
  });
  if (ring.length < 3) return null;
  const bottoms = facePlanes(p, false);
  const slopes: (number | null)[] = [];
  const thick: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const n = { x: -(b.y - a.y) / L, y: (b.x - a.x) / L };
    const q = { x: (a.x + b.x) / 2 + n.x * Math.min(150, L / 4), y: (a.y + b.y) / 2 + n.y * Math.min(150, L / 4) };
    const top = planeAt(tops, q, true);
    if (!top) {
      slopes.push(null);
      continue;
    }
    const rise = top.a * n.x + top.b * n.y;
    // Rising inwards from this edge: its slope; flat or rising along it: a gable (or flat roof edge).
    slopes.push(rise > 0.02 ? Math.atan(rise) : null);
    const bottom = planeAt(bottoms, q, false);
    if (bottom) thick.push(top.a * q.x + top.b * q.y + top.c - (bottom.a * q.x + bottom.b * q.y + bottom.c));
  }
  const t = thick.length ? thick.sort((x, y) => x - y)[Math.floor(thick.length / 2)]! : 200;
  if (!(t > 1)) return null;
  const typeId = typeFor(tx, doc, Cat.RoofType, "Imported Roof", t, mat);
  return createRoof(tx, typeId, p.levelId, ring, { slopes, baseOffset: z0 - lvl }).id;
}

/**
 * A curved wall from its mesh: the centre where the curved faces' normals meet (least squares, end
 * faces dropped as outliers), inner and outer radii from the vertices (all must lie on one or the
 * other), and the angular span. Null if it isn't such a band (or spans a semicircle or more).
 */
function arcWall(p: DirectShapeParams): { start: Vec2; end: Vec2; curve: number; thick: number } | null {
  const P = p.positions;
  // Vertical faces: a point on each and its plan normal.
  const lines: { q: Vec2; n: Vec2 }[] = [];
  for (let i = 0; i < p.indices.length; i += 3) {
    const [a, b, c] = [p.indices[i]! * 3, p.indices[i + 1]! * 3, p.indices[i + 2]! * 3];
    const u = [P[b]! - P[a]!, P[b + 1]! - P[a + 1]!, P[b + 2]! - P[a + 2]!];
    const w = [P[c]! - P[a]!, P[c + 1]! - P[a + 1]!, P[c + 2]! - P[a + 2]!];
    const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    const l = Math.hypot(n[0]!, n[1]!, n[2]!);
    if (l < 1e-9 || Math.abs(n[2]! / l) > 0.05) continue;
    const h = Math.hypot(n[0]!, n[1]!);
    const nn = { x: n[0]! / h, y: n[1]! / h };
    // The middle of the face's span across its normal (a facet's chord midpoint: on a line to the centre).
    const t = { x: -nn.y, y: nn.x };
    const ss = [a, b, c].map((k) => P[k]! * t.x + P[k + 1]! * t.y);
    const mid = (Math.min(...ss) + Math.max(...ss)) / 2;
    const off = P[a]! * nn.x + P[a + 1]! * nn.y;
    lines.push({ q: { x: t.x * mid + nn.x * off, y: t.y * mid + nn.y * off }, n: nn });
  }
  if (lines.length < 6) return null;
  // Least-squares point nearest every normal line (minimise Σ distance² across each line).
  const solve = (ls: typeof lines): Vec2 | null => {
    let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
    for (const { q, n } of ls) {
      // Distance across the line = t·(x − q), t = the line's direction's normal = (−n.y, n.x).
      const t = { x: -n.y, y: n.x };
      a11 += t.x * t.x; a12 += t.x * t.y; a22 += t.y * t.y;
      const d = t.x * q.x + t.y * q.y;
      b1 += t.x * d; b2 += t.y * d;
    }
    const det = a11 * a22 - a12 * a12;
    if (Math.abs(det) < 1e-9) return null;
    return { x: (b1 * a22 - b2 * a12) / det, y: (a11 * b2 - a12 * b1) / det };
  };
  // Robustly: drop the worst-fitting tenth and solve again, until what's left fits within 1 mm.
  const resid = (c: Vec2, { q, n }: (typeof lines)[0]) => Math.abs(-n.y * (c.x - q.x) + n.x * (c.y - q.y));
  let use = lines;
  let c = solve(use);
  for (let k = 0; c && k < 40; k++) {
    const sorted = [...use].sort((x, y) => resid(c!, x) - resid(c!, y));
    if (resid(c, sorted[sorted.length - 1]!) < 1) break;
    use = sorted.slice(0, Math.max(4, Math.floor(sorted.length * 0.9)));
    c = solve(use);
  }
  if (!c || use.length < lines.length / 2) return null;
  const pts: Vec2[] = [];
  for (let i = 0; i < P.length; i += 3) pts.push({ x: P[i]!, y: P[i + 1]! });
  const rs = pts.map((q) => Math.hypot(q.x - c!.x, q.y - c!.y));
  const r0 = Math.min(...rs);
  const r1 = Math.max(...rs);
  if (r1 - r0 < 1 || rs.some((r) => Math.abs(r - r0) > 2 && Math.abs(r - r1) > 2)) return null;
  // Angular span about the mean direction.
  const mean = pts.reduce((s, q) => ({ x: s.x + (q.x - c!.x), y: s.y + (q.y - c!.y) }), { x: 0, y: 0 });
  const m = Math.atan2(mean.y, mean.x);
  const angs = pts.map((q) => {
    let d = Math.atan2(q.y - c!.y, q.x - c!.x) - m;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  });
  const a0 = m + Math.min(...angs);
  const a1 = m + Math.max(...angs);
  if (a1 - a0 >= Math.PI - 1e-3 || a1 - a0 < 1e-3) return null;
  const R = (r0 + r1) / 2;
  const at = (t: number) => ({ x: c!.x + R * Math.cos(t), y: c!.y + R * Math.sin(t) });
  const start = at(a0);
  const end = at(a1);
  // Sagitta: how far the arc's middle stands to the left of start → end (anticlockwise: to the right).
  const mid = at((a0 + a1) / 2);
  const chord = { x: end.x - start.x, y: end.y - start.y };
  const L = Math.hypot(chord.x, chord.y);
  const curve = ((mid.x - start.x) * -chord.y + (mid.y - start.y) * chord.x) / L;
  return { start, end, curve, thick: r1 - r0 };
}

/**
 * A level railing from its mesh: its top rail's upward faces form a band; the band's two short ends
 * split its outline into the two sides, whose midpoints pair up into the path. Sloped (stair)
 * railings and anything else stay as shapes.
 */
function railingFromMesh(tx: Transaction, doc: Document, p: DirectShapeParams, lvl: number, z0: number, z1: number): ElementId | null {
  // Horizontal triangles at the very top (whatever their winding), grouped into pieces that share corners.
  const P = p.positions;
  const tris: [Vec2, Vec2, Vec2][] = [];
  const keys: string[][] = [];
  for (let i = 0; i < p.indices.length; i += 3) {
    const ks = [p.indices[i]!, p.indices[i + 1]!, p.indices[i + 2]!].map((v) => v * 3);
    if (ks.some((k) => Math.abs(P[k + 2]! - z1) > 1)) continue;
    tris.push(ks.map((k) => ({ x: P[k]!, y: P[k + 1]! })) as [Vec2, Vec2, Vec2]);
    keys.push(ks.map((k) => `${Math.round(P[k]!)},${Math.round(P[k + 1]!)}`));
  }
  if (!tris.length) return null;
  const parent = tris.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const owner = new Map<string, number>();
  keys.forEach((ks, i) => {
    for (const k of ks) {
      const o = owner.get(k);
      if (o === undefined) owner.set(k, i);
      else parent[find(i)] = find(o);
    }
  });
  const groups = new Map<number, [Vec2, Vec2, Vec2][]>();
  tris.forEach((t, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), t]));
  const outline = (ts: [Vec2, Vec2, Vec2][]): Vec2[] | null => {
    try {
      const polys = ts.map((t): Polygon => [[...t.map((q): [number, number] => [q.x, q.y]), [t[0].x, t[0].y]]]);
      const u = polygonClipping.union(polys[0]!, ...polys.slice(1));
      if (u.length !== 1 || u[0]!.length !== 1) return null;
      const ring = u[0]![0]!.slice(0, -1).map(([x, y]) => ({ x, y }));
      return ring.filter((q, i) => {
        const a = ring[(i - 1 + ring.length) % ring.length]!;
        const b = ring[(i + 1) % ring.length]!;
        return Math.abs((q.x - a.x) * (b.y - q.y) - (q.y - a.y) * (b.x - q.x)) > 0.5 * Math.hypot(b.x - a.x, b.y - a.y);
      });
    } catch {
      return null;
    }
  };
  let path: Vec2[] | null = null;
  let w = 0;
  const pieces = [...groups.values()].map(outline);
  if (pieces.length > 1 && pieces.every((o) => o && o.length === 4)) {
    // Separate straight rail pieces: each one's centreline, chained end to end.
    const segs = pieces.map((o) => {
      const r = minRect(o!)!;
      w = r.wid;
      return [
        { x: r.c.x - (r.u.x * r.len) / 2, y: r.c.y - (r.u.y * r.len) / 2 },
        { x: r.c.x + (r.u.x * r.len) / 2, y: r.c.y + (r.u.y * r.len) / 2 },
      ] as [Vec2, Vec2];
    });
    const near = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y) <= w + 1;
    // Start from a piece with a free end.
    const freeEnd = (s: [Vec2, Vec2], k: 0 | 1) => !segs.some((o) => o !== s && (near(o[0], s[k]) || near(o[1], s[k])));
    const first = segs.find((s) => freeEnd(s, 0) || freeEnd(s, 1)) ?? segs[0]!;
    const left = segs.filter((s) => s !== first);
    path = !freeEnd(first, 0) && freeEnd(first, 1) ? [first[1], first[0]] : [first[0], first[1]];
    while (left.length) {
      const end = path[path.length - 1]!;
      const k = left.findIndex((s) => near(s[0], end) || near(s[1], end));
      if (k < 0) return null;
      const s = left.splice(k, 1)[0]!;
      const next = near(s[0], end) ? s[1] : s[0];
      path.push(next);
    }
  } else if (pieces.length === 1 && pieces[0]) {
    // One swept rail: its band's two short ends split the outline into sides; their midpoints pair up.
    const band = pieces[0];
    const n = band.length;
    if (n < 4 || n % 2) return null;
    const lens = band.map((q, i) => Math.hypot(band[(i + 1) % n]!.x - q.x, band[(i + 1) % n]!.y - q.y));
    const order = lens.map((l, i) => [l, i] as const).sort((a, b) => a[0] - b[0]);
    const e0 = order[0]![1];
    if ((order[1]![1] - e0 + n) % n !== n / 2) return null;
    w = (order[0]![0] + order[1]![0]) / 2;
    const k = n / 2;
    const sideA = Array.from({ length: k }, (_, i) => band[(e0 + 1 + i) % n]!);
    const sideB = Array.from({ length: k }, (_, i) => band[(e0 - i + n) % n]!);
    path = sideA.map((a, i) => ({ x: (a.x + sideB[i]!.x) / 2, y: (a.y + sideB[i]!.y) / 2 }));
  }
  if (!path || path.length < 2) return null;
  const height = z1 - z0;
  const type =
    doc.byCategory<RailingTypeParams>(Cat.RailingType).find((t) => Math.abs(t.params.height - height) < 2 && Math.abs(t.params.railSize - w) < 2)?.id ??
    tx.create<RailingTypeParams>(Cat.RailingType, { height: Math.round(height), railSize: Math.round(w), balusterSize: Math.min(25, Math.round(w)), balusterGap: 100 }, { name: `Imported Railing ${Math.round(height)}` }).id;
  const r = createRailing(tx, doc, type, p.levelId, path);
  tx.update<RailingParams>(r.id, { baseOffset: z0 - lvl });
  return r.id;
}

/**
 * Imported furniture/fixtures/equipment as loadable families. Each shape is taken into its own
 * frame (origin at its plan centre and base, X along its longer side; the other way round tried
 * too) and fingerprinted, so copies — even turned — share one family; the family holds the shape as
 * a mesh form and gets the Revit "Family:Type" name. Returns the instances made.
 */
function familiesFromShapes(tx: Transaction, doc: Document, ids: ElementId[]): ElementId[] {
  type Shape = { ds: DirectShape; c: Vec2; z0: number; angle: number; local: number[]; key: string };
  const shapes: Shape[] = [];
  for (const id of ids) {
    const ds = doc.get<DirectShapeParams>(id) as DirectShape | undefined;
    if (!ds) continue;
    const { xy, z0 } = bounds(ds.params);
    const r = minRect(xy);
    const base = r ? Math.atan2(r.u.y, r.u.x) : 0;
    const c = r?.c ?? { x: xy.reduce((s, q) => s + q.x, 0) / xy.length, y: xy.reduce((s, q) => s + q.y, 0) / xy.length };
    const square = !!r && Math.abs(r.len - r.wid) < 2;
    const angles = square ? [0, 1, 2, 3].map((k) => base + (k * Math.PI) / 2) : [base, base + Math.PI];
    let best: Omit<Shape, "ds" | "c" | "z0"> | null = null;
    for (const a of angles) {
      const ca = Math.cos(-a);
      const sa = Math.sin(-a);
      const P = ds.params.positions;
      const local: number[] = [];
      for (let i = 0; i < P.length; i += 3) {
        const x = P[i]! - c.x;
        const y = P[i + 1]! - c.y;
        local.push(x * ca - y * sa, x * sa + y * ca, P[i + 2]! - z0);
      }
      const key = local.map((v) => Math.round(v / 2)).join(",") + "|" + ds.params.indices.length;
      if (!best || key < best.key) best = { angle: a, local, key };
    }
    shapes.push({ ds, c, z0, ...best! });
  }
  // One family per Revit name and fingerprint.
  const nameOf = (ds: DirectShape) => (ds.name ?? ds.params.ifcClass).replace(/:\d+$/, "");
  const families = new Map<string, Shape[]>();
  for (const s of shapes) {
    const k = `${nameOf(s.ds)}|${s.key}`;
    families.set(k, [...(families.get(k) ?? []), s]);
  }
  const out: ElementId[] = [];
  const taken = new Set(familyDefs(doc).map((d) => d.name));
  for (const group of families.values()) {
    const first = group[0]!;
    const category = FAMILY_OF[first.ds.params.ifcClass]!;
    let name = nameOf(first.ds);
    for (let k = 2; taken.has(name); k++) name = `${nameOf(first.ds)} (${k})`;
    taken.add(name);
    const fam = new BimDocument();
    applyFamilyTemplate(fam, category, name);
    fam.transact("Imported shape", (ftx) => {
      ftx.create<MeshFormParams>(Cat.MeshForm, { isVoid: false, plane: { kind: "XY", offset: 0 }, positions: first.local.map((v) => Math.round(v * 100) / 100), indices: [...first.ds.params.indices] });
    });
    const def = loadFamily(tx, doc, fam, name);
    const typeName = familyTypeNames(def)[0] ?? "Default";
    for (const s of group) {
      const lvl = doc.get<LevelParams>(s.ds.params.levelId)?.params.elevation ?? 0;
      const inst = placeFamilyInstance(tx, doc, def.id, typeName, { levelId: s.ds.params.levelId, position: s.c, rotation: s.angle, offset: s.z0 - lvl });
      carryOver(tx, doc, inst.id, s.ds);
      out.push(inst.id);
      tx.delete(s.ds.id);
    }
  }
  return out;
}

type Panel = { id: ElementId; levelId: ElementId; c: Vec2; u: Vec2; u0: number; u1: number; z0: number; z1: number; thick: number };

/** Imported panels as thin vertical rectangles, grouped by the plane they lie in. */
function curtainGroups(doc: Document, ids: ElementId[]): Panel[][] {
  const panels: Panel[] = [];
  for (const id of ids) {
    const ds = doc.get<DirectShapeParams>(id);
    if (!ds) continue;
    const { xy, z0, z1 } = bounds(ds.params);
    const r = minRect(xy);
    if (!r || r.wid > 150 || r.len < r.wid * 2 || z1 - z0 < 50) continue;
    panels.push({ id, levelId: ds.params.levelId, c: r.c, u: r.u, u0: -r.len / 2, u1: r.len / 2, z0, z1, thick: r.wid });
  }
  const groups: Panel[][] = [];
  for (const p of panels) {
    const g = groups.find((gr) => {
      const q = gr[0]!;
      const par = Math.abs(q.u.x * p.u.y - q.u.y * p.u.x) < 0.02;
      const off = Math.abs(-q.u.y * (p.c.x - q.c.x) + q.u.x * (p.c.y - q.c.y));
      return par && off < 100 && q.levelId === p.levelId;
    });
    if (g) g.push(p);
    else groups.push([p]);
  }
  return groups;
}

/** Positions that sit together (within `gap`) become one, at their middle. */
function cluster(vals: number[], gap: number): number[] {
  const s = [...vals].sort((a, b) => a - b);
  const out: number[][] = [];
  for (const v of s) {
    const last = out[out.length - 1];
    if (last && v - last[last.length - 1]! <= gap) last.push(v);
    else out.push([v]);
  }
  return out.map((c) => (c[0]! + c[c.length - 1]!) / 2);
}

/**
 * A curtain wall from its panels: the plane's line from the panels' extent along it, base to top
 * from their heights, and grid lines where neighbouring panels meet (the gap between them is the
 * mullion). The imported mullions in that plane go too. Type: the project's first curtain wall type.
 */
function curtainFromPanels(tx: Transaction, doc: Document, g: Panel[]): ElementId | null {
  const ref = g[0]!;
  const type = doc.byCategory<LayeredTypeParams>(Cat.WallType).find((t) => t.params.curtain);
  if (!type) return null;
  // Panel ends along the reference line.
  const along = (p: Panel, s: number) => (p.c.x + p.u.x * s - ref.c.x) * ref.u.x + (p.c.y + p.u.y * s - ref.c.y) * ref.u.y;
  const ends = g.map((p) => [along(p, p.u0), along(p, p.u1)].sort((a, b) => a - b) as [number, number]);
  const gap = 200;
  const us = cluster(ends.flat(), gap);
  const zs = cluster(g.flatMap((p) => [p.z0, p.z1]), gap);
  if (us.length < 2 || zs.length < 2) return null;
  const uMin = Math.min(...ends.map((e) => e[0]));
  const uMax = Math.max(...ends.map((e) => e[1]));
  const zMin = Math.min(...g.map((p) => p.z0));
  const zMax = Math.max(...g.map((p) => p.z1));
  const off = g.reduce((s, p) => s + (-ref.u.y * (p.c.x - ref.c.x) + ref.u.x * (p.c.y - ref.c.y)), 0) / g.length;
  const n = { x: -ref.u.y, y: ref.u.x };
  const at = (u: number) => ({ x: ref.c.x + ref.u.x * u + n.x * off, y: ref.c.y + ref.u.y * u + n.y * off });
  const lvl = doc.get<LevelParams>(ref.levelId)?.params.elevation ?? 0;
  const w = createWall(tx, type.id, at(uMin), at(uMax), ref.levelId, { baseOffset: zMin - lvl, height: zMax - zMin });
  // Interior grid lines (the outermost clusters are the wall's edges).
  const uLines = us.slice(1, -1).map((u) => Math.round(u - uMin));
  const zLines = zs.slice(1, -1).map((z) => Math.round(z - zMin));
  tx.update<WallParams>(w.id, { curtainEdits: { uLines, zLines } });
  // The panels, and mullions lying in the same plane within the wall's extent, are now the wall's.
  for (const p of g) tx.delete(p.id);
  for (const m of doc.byCategory<DirectShapeParams>(Cat.DirectShape)) {
    if (m.params.ifcClass !== "IfcMember") continue;
    const { xy, z0, z1 } = bounds(m.params);
    const inPlane = xy.every((q) => Math.abs(-ref.u.y * (q.x - ref.c.x) + ref.u.x * (q.y - ref.c.y) - off) < 200);
    const us2 = xy.map((q) => (q.x - ref.c.x) * ref.u.x + (q.y - ref.c.y) * ref.u.y);
    if (inPlane && Math.min(...us2) >= uMin - 200 && Math.max(...us2) <= uMax + 200 && z0 >= zMin - 200 && z1 <= zMax + 200) tx.delete(m.id);
  }
  return w.id;
}

type P3 = { x: number; y: number; z: number };

/**
 * Run ends near another run meet it: where the axes cross (elbows, tees: within reach of the end
 * and on or near the other run), or, for runs in line (transitions), at the middle of the gap.
 * Positions are absolute here; run params are level-relative.
 */
function snapRunEnds(tx: Transaction, doc: Document, ids: ElementId[]): void {
  type R = { id: ElementId; a: P3; b: P3; size: number; lz: number };
  const runs: R[] = ids.map((id) => {
    const e = doc.require(id);
    const q = e.params as { levelId: string; start: P3; end: P3; diameter?: number; width?: number; height?: number };
    const lz = doc.get<LevelParams>(q.levelId)?.params.elevation ?? 0;
    return { id, a: { ...q.start, z: q.start.z + lz }, b: { ...q.end, z: q.end.z + lz }, size: Math.max(q.diameter ?? 0, q.width ?? 0, q.height ?? 0), lz };
  });
  const sub3 = (u: P3, w: P3) => ({ x: u.x - w.x, y: u.y - w.y, z: u.z - w.z });
  const dot3 = (u: P3, w: P3) => u.x * w.x + u.y * w.y + u.z * w.z;
  const len3 = (u: P3) => Math.hypot(u.x, u.y, u.z);
  const moved = new Map<ElementId, { start?: P3; end?: P3 }>();
  for (const r of runs) {
    for (const end of ["a", "b"] as const) {
      const e = r[end];
      const dirR = sub3(r.b, r.a);
      let best: P3 | null = null;
      let bestD = Infinity;
      for (const o of runs) {
        if (o === r) continue;
        const reach = 1.5 * Math.max(r.size, o.size) + 50;
        const dirO = sub3(o.b, o.a);
        const lo = len3(dirO);
        // Closest points of the two axes.
        const w0 = sub3(r.a, o.a);
        const A = dot3(dirR, dirR), B = dot3(dirR, dirO), Cc = dot3(dirO, dirO), D = dot3(dirR, w0), E = dot3(dirO, w0);
        const den = A * Cc - B * B;
        let x: P3;
        if (den < 1e-9 * A * Cc) {
          // In line: meet the other run's nearer end halfway across the gap.
          const near = len3(sub3(o.a, e)) < len3(sub3(o.b, e)) ? o.a : o.b;
          if (len3(sub3(near, e)) > reach) continue;
          const off = len3(sub3(sub3(near, e), { x: (dirR.x / Math.sqrt(A)) * dot3(sub3(near, e), dirR) / Math.sqrt(A), y: (dirR.y / Math.sqrt(A)) * dot3(sub3(near, e), dirR) / Math.sqrt(A), z: (dirR.z / Math.sqrt(A)) * dot3(sub3(near, e), dirR) / Math.sqrt(A) }));
          if (off > 5) continue;
          x = { x: (near.x + e.x) / 2, y: (near.y + e.y) / 2, z: (near.z + e.z) / 2 };
        } else {
          const s = (B * E - Cc * D) / den;
          const t = (A * E - B * D) / den;
          const pr = { x: r.a.x + dirR.x * s, y: r.a.y + dirR.y * s, z: r.a.z + dirR.z * s };
          const po = { x: o.a.x + dirO.x * t, y: o.a.y + dirO.y * t, z: o.a.z + dirO.z * t };
          if (len3(sub3(pr, po)) > 5) continue;
          if (t * lo < -reach || t * lo > lo + reach) continue;
          x = pr;
        }
        const d = len3(sub3(x, e));
        if (d <= reach && d < bestD) [best, bestD] = [x, d];
      }
      if (best && bestD > 0.5) {
        const m = moved.get(r.id) ?? {};
        m[end === "a" ? "start" : "end"] = { x: best.x, y: best.y, z: best.z - r.lz };
        moved.set(r.id, m);
      }
    }
  }
  for (const [id, m] of moved) tx.update(id, m);
}

/** Our system classification from an imported system's name/type (Revit: "Supply Air 1 (SUPPLYAIR)"). */
function classificationOf(p: DirectShapeParams, pipe: boolean): SystemClassification | undefined {
  const t = (p.properties.System ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!t) return undefined;
  const rules: [RegExp, SystemClassification][] = pipe
    ? [[/SPRINK|FIRE/, "fireProtection"], [/SANIT|WASTE|SEWAGE|SOIL/, "sanitary"], [/VENT/, "vent"], [/STORM|RAIN/, "stormwater"], [/GAS/, "gas"], [/HOT/, "hotWater"], [/COLD|WATER|DOMESTIC/, "coldWater"]]
    : [[/RETURN/, "returnAir"], [/EXHAUST|EXTRACT/, "exhaustAir"], [/OUTSIDE|FRESH|OUTDOOR/, "outsideAir"], [/SUPPLY/, "supplyAir"]];
  return rules.find(([re]) => re.test(t))?.[1];
}

/**
 * A duct or pipe from its mesh: its axis is the points' main direction (the run's length dwarfs its
 * section); round when every point sits at one distance from the axis, else rectangular (width
 * across, height up). Ends extend to the axis' extremes so neighbours meet for fittings.
 */
function runFromMesh(tx: Transaction, doc: Document, p: DirectShapeParams, lvl: number): ElementId | null {
  const P = p.positions;
  const n = P.length / 3;
  if (n < 6) return null;
  const c = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) c[k]! += P[i * 3 + k]! / n;
  // Main axis by power iteration on the covariance.
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const d = [P[i * 3]! - c[0]!, P[i * 3 + 1]! - c[1]!, P[i * 3 + 2]! - c[2]!];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) C[r * 3 + k]! += d[r]! * d[k]!;
  }
  let v = [1, 0.3, 0.1];
  for (let it = 0; it < 60; it++) {
    const w = [0, 1, 2].map((r) => C[r * 3]! * v[0]! + C[r * 3 + 1]! * v[1]! + C[r * 3 + 2]! * v[2]!);
    const l = Math.hypot(w[0]!, w[1]!, w[2]!) || 1;
    v = w.map((x) => x / l);
  }
  // Snap near-axis directions (runs are usually level or vertical).
  v = v.map((x) => (Math.abs(x) < 1e-3 ? 0 : x));
  const ts = Array.from({ length: n }, (_, i) => (P[i * 3]! - c[0]!) * v[0]! + (P[i * 3 + 1]! - c[1]!) * v[1]! + (P[i * 3 + 2]! - c[2]!) * v[2]!);
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts);
  // Section axes: horizontal across, and up (a vertical run: x and y).
  const vertical = Math.abs(v[2]!) > 0.99;
  let side = vertical ? [1, 0, 0] : [-v[1]!, v[0]!, 0];
  const sl = Math.hypot(side[0]!, side[1]!, side[2]!) || 1;
  side = side.map((x) => x / sl);
  const up = [v[1]! * side[2]! - v[2]! * side[1]!, v[2]! * side[0]! - v[0]! * side[2]!, v[0]! * side[1]! - v[1]! * side[0]!];
  let s0 = Infinity, s1 = -Infinity, u0 = Infinity, u1 = -Infinity, rMax = 0;
  for (let i = 0; i < n; i++) {
    const d = [P[i * 3]! - c[0]!, P[i * 3 + 1]! - c[1]!, P[i * 3 + 2]! - c[2]!];
    const s = d[0]! * side[0]! + d[1]! * side[1]! + d[2]! * side[2]!;
    const u = d[0]! * up[0]! + d[1]! * up[1]! + d[2]! * up[2]!;
    s0 = Math.min(s0, s); s1 = Math.max(s1, s); u0 = Math.min(u0, u); u1 = Math.max(u1, u);
    const r = Math.hypot(s, u);
    rMax = Math.max(rMax, r);
  }
  const width = s1 - s0;
  const height = u1 - u0;
  if (t1 - t0 < 2 * Math.max(width, height)) return null;
  // Round: no corners standing out (a rectangle's reach √2 × its half-size).
  const round = Math.abs(width - height) < 0.05 * width && rMax < 1.1 * (Math.max(width, height) / 2);
  const mid = [c[0]! + side[0]! * (s0 + s1) / 2 + up[0]! * (u0 + u1) / 2, c[1]! + side[1]! * (s0 + s1) / 2 + up[1]! * (u0 + u1) / 2, c[2]! + side[2]! * (s0 + s1) / 2 + up[2]! * (u0 + u1) / 2];
  const at = (t: number) => ({ x: mid[0]! + v[0]! * t, y: mid[1]! + v[1]! * t, z: mid[2]! + v[2]! * t - lvl });
  const start = at(t0);
  const end = at(t1);
  if (p.ifcClass === "IfcPipeSegment") {
    const dia = 2 * rMax;
    const dn = PIPE_SIZES.reduce((b, s) => (Math.abs(s - dia) < Math.abs(b - dia) ? s : b), PIPE_SIZES[0]!);
    const types = ensurePipeTypes(tx, doc);
    const cls = classificationOf(p, true);
    return createPipe(tx, doc, (cls && pipeTypeFor(doc, cls)) || types[0]!, p.levelId, start, end, { diameter: dn, ...(cls ? { classification: cls } : {}) }).id;
  }
  const types = ensureDuctTypes(tx, doc);
  const typeOf = (shape: string) => types.find((id) => (doc.get(id)?.params as { shape?: string } | undefined)?.shape === shape) ?? types[0]!;
  const cls = classificationOf(p, false);
  const sys = cls ? { classification: cls } : {};
  return round
    ? createDuct(tx, doc, typeOf("round"), p.levelId, start, end, { diameter: Math.round(2 * rMax), ...sys }).id
    : createDuct(tx, doc, typeOf("rectangular"), p.levelId, start, end, { width: Math.round(width), height: Math.round(height), ...sys }).id;
}

/**
 * A straight ramp from its mesh: one sloping top plane over a plan rectangle; it runs uphill along
 * the rectangle, from its low end's top to its high end's, with the slab's thickness and width.
 */
function rampFromMesh(tx: Transaction, doc: Document, p: DirectShapeParams, lvl: number): ElementId | null {
  const { xy } = bounds(p);
  const r = minRect(xy);
  if (!r || r.hullArea < 0.9 * r.len * r.wid) return null;
  const tops = facePlanes(p, true);
  if (!tops.length) return null;
  const g = tops[0]!;
  if (tops.some((t) => Math.abs(t.a - g.a) > 1e-4 || Math.abs(t.b - g.b) > 1e-4) || Math.hypot(g.a, g.b) < 1e-3) return null;
  // Uphill along the rectangle's long side.
  let dir = r.u;
  if (g.a * dir.x + g.b * dir.y < 0) dir = { x: -dir.x, y: -dir.y };
  const start = { x: r.c.x - (dir.x * r.len) / 2, y: r.c.y - (dir.y * r.len) / 2 };
  const end = { x: r.c.x + (dir.x * r.len) / 2, y: r.c.y + (dir.y * r.len) / 2 };
  const zAt = (q: Vec2) => g.a * q.x + g.b * q.y + g.c;
  const bottoms = facePlanes(p, false);
  const under = planeAt(bottoms, r.c, false);
  const thickness = under ? zAt(r.c) - (under.a * r.c.x + under.b * r.c.y + under.c) : 150;
  const width = r.wid;
  const z0 = zAt(start);
  const z1 = zAt(end);
  const n = Math.max(1, Math.round(r.len / (z1 - z0)));
  const type =
    doc.byCategory<RampTypeParams>(Cat.RampType).find((t) => Math.abs(t.params.width - width) < 2 && Math.abs(t.params.thickness - thickness) < 2)?.id ??
    tx.create<RampTypeParams>(Cat.RampType, { width: Math.round(width), thickness: Math.round(thickness), maxSlope: Math.min(12, n) }, { name: `Imported Ramp ${Math.round(width)}` }).id;
  const above = doc.byCategory<LevelParams>(Cat.Level).filter((l) => l.params.elevation > lvl + 1).sort((a, b) => Math.abs(a.params.elevation - z1) - Math.abs(b.params.elevation - z1));
  const top = above[0] ?? doc.require<LevelParams>(p.levelId);
  const ramp = createRamp(tx, doc, type, p.levelId, top.id, [{ start, end }]);
  tx.update<RampParams>(ramp.id, { baseOffset: z0 - lvl, topOffset: z1 - top.params.elevation });
  return ramp.id;
}

/**
 * A straight stair from its mesh: the treads are its upward faces at evenly spaced heights; their
 * centres give the direction of travel and the going, their spread across it the width. Null for
 * anything else (turns, winders, uneven risers).
 */
function stairFromMesh(tx: Transaction, doc: Document, p: DirectShapeParams, lvl: number, z0: number, z1: number): ElementId | null {
  const P = p.positions;
  // Upward horizontal faces, grouped by height: area-weighted centre and the points of each tread.
  const levels = new Map<number, { a: number; cx: number; cy: number; pts: Vec2[] }>();
  for (let i = 0; i < p.indices.length; i += 3) {
    const [a, b, c] = [p.indices[i]! * 3, p.indices[i + 1]! * 3, p.indices[i + 2]! * 3];
    const u = [P[b]! - P[a]!, P[b + 1]! - P[a + 1]!];
    const w = [P[c]! - P[a]!, P[c + 1]! - P[a + 1]!];
    const area = (u[0]! * w[1]! - u[1]! * w[0]!) / 2;
    if (area <= 1 || Math.abs(P[a + 2]! - P[b + 2]!) > 0.5 || Math.abs(P[a + 2]! - P[c + 2]!) > 0.5) continue;
    const z = Math.round(P[a + 2]!);
    if (z <= z0 + 1) continue;
    const g = levels.get(z) ?? { a: 0, cx: 0, cy: 0, pts: [] };
    g.a += area;
    g.cx += (area * (P[a]! + P[b]! + P[c]!)) / 3;
    g.cy += (area * (P[a + 1]! + P[b + 1]! + P[c + 1]!)) / 3;
    for (const k of [a, b, c]) g.pts.push({ x: P[k]!, y: P[k + 1]! });
    levels.set(z, g);
  }
  const steps = [...levels.entries()].sort((x, y) => x[0] - y[0]).map(([z, g]) => ({ z, a: g.a, c: { x: g.cx / g.a, y: g.cy / g.a }, pts: g.pts }));
  // The topmost face at the stair's top is the floor it arrives at, not a step.
  if (steps.length && Math.abs(steps[steps.length - 1]!.z - z1) < 1) steps.pop();
  if (steps.length < 2) return null;
  const risers = steps.length + 1;
  const riser = (z1 - z0) / risers;
  if (steps.some((t, i) => Math.abs(t.z - (z0 + riser * (i + 1))) > 3)) return null;
  type Step = (typeof steps)[0];
  /** Straight, evenly spaced runs: their line and spacing, or null. */
  const fit = (runs: Step[][]) => {
    if (runs.some((r) => r.length < 2)) return null;
    let g0 = 0;
    const ls = runs.map((r) => {
      const first = r[0]!.c;
      const last = r[r.length - 1]!.c;
      const span = Math.hypot(last.x - first.x, last.y - first.y);
      g0 = Math.max(g0, span / (r.length - 1));
      return { first, dir: { x: (last.x - first.x) / span, y: (last.y - first.y) / span }, r };
    });
    for (const { first, dir, r } of ls) {
      const g = Math.hypot(r[r.length - 1]!.c.x - first.x, r[r.length - 1]!.c.y - first.y) / (r.length - 1);
      if (Math.abs(g - g0) > 3 || r.some((t, i) => Math.hypot(t.c.x - (first.x + dir.x * g * i), t.c.y - (first.y + dir.y * g * i)) > 5)) return null;
    }
    return { lines: ls, going: g0 };
  };
  // Treads and landings (much bigger than a tread): runs of treads between landings.
  const median = [...steps].sort((x, y) => x.a - y.a)[Math.floor(steps.length / 2)]!.a;
  let runs: Step[][] = [[]];
  for (const st of steps) {
    if (st.a > 1.6 * median) runs.push([]);
    else runs[runs.length - 1]!.push(st);
  }
  let winders = 0;
  let fitted = fit(runs);
  if (!fitted) {
    // Winders instead: straight runs, and between them the same number of turning treads at each turn.
    runs = [];
    let i = 0;
    const counts: number[] = [];
    while (i < steps.length) {
      const run: Step[] = [steps[i]!, ...(steps[i + 1] ? [steps[i + 1]!] : [])];
      i += run.length;
      const g = run.length > 1 ? Math.hypot(run[1]!.c.x - run[0]!.c.x, run[1]!.c.y - run[0]!.c.y) : 0;
      const dir = run.length > 1 ? { x: (run[1]!.c.x - run[0]!.c.x) / g, y: (run[1]!.c.y - run[0]!.c.y) / g } : { x: 0, y: 0 };
      while (i < steps.length) {
        const last = run[run.length - 1]!.c;
        const nx = steps[i]!.c;
        if (Math.hypot(nx.x - (last.x + dir.x * g), nx.y - (last.y + dir.y * g)) > 5) break;
        run.push(steps[i]!);
        i++;
      }
      runs.push(run);
      if (i >= steps.length) break;
      // The next run starts where two treads at the going head off square to this one.
      let j = i;
      for (; j + 1 < steps.length; j++) {
        const a = steps[j]!.c;
        const b2 = steps[j + 1]!.c;
        const d = Math.hypot(b2.x - a.x, b2.y - a.y);
        if (Math.abs(d - g) < 3 && Math.abs(((b2.x - a.x) * dir.x + (b2.y - a.y) * dir.y) / d) < 0.05) break;
      }
      if (j + 1 >= steps.length) return null;
      counts.push(j - i);
      i = j;
    }
    if (!counts.length || counts.some((k) => k !== counts[0] || k < 2 || k > 4)) return null;
    winders = counts[0]!;
    fitted = fit(runs);
    if (!fitted) return null;
  }
  const { lines, going } = fitted;
  const across0 = { x: -lines[0]!.dir.y, y: lines[0]!.dir.x };
  const ws = lines[0]!.r[0]!.pts.map((q) => (q.x - lines[0]!.first.x) * across0.x + (q.y - lines[0]!.first.y) * across0.y);
  const width = Math.max(...ws) - Math.min(...ws);
  // Each run starts half a going before its first tread, on its centreline; it's its treads long.
  const stairRuns = lines.map(({ first, dir, r }) => {
    const across = { x: -dir.y, y: dir.x };
    const off = r[0]!.pts.map((q) => (q.x - first.x) * across.x + (q.y - first.y) * across.y);
    const mid = (Math.max(...off) + Math.min(...off)) / 2;
    const start = { x: first.x - (dir.x * going) / 2 + across.x * mid, y: first.y - (dir.y * going) / 2 + across.y * mid };
    return { start, end: { x: start.x + dir.x * going * r.length, y: start.y + dir.y * going * r.length } };
  });
  const typeName = `Imported Stair ${Math.round(width)} wide ${Math.round(going)} going`;
  const type =
    doc.byCategory<StairTypeParams>(Cat.StairType).find((t) => Math.abs(t.params.going - going) < 2 && Math.abs(t.params.width - width) < 2 && Math.ceil((z1 - z0) / t.params.maxRiser - 1e-9) === risers)?.id ??
    createStairType(tx, typeName, { going: Math.round(going * 10) / 10, width: Math.round(width), maxRiser: riser + 0.01 }).id;
  // Top: the level at the stair's top, else the nearest above its base (with an offset).
  const above = doc.byCategory<LevelParams>(Cat.Level).filter((l) => l.params.elevation > lvl + 1).sort((a, b) => Math.abs(a.params.elevation - z1) - Math.abs(b.params.elevation - z1));
  const top = above[0];
  if (!top) return null;
  const s = createStair(tx, doc, type, p.levelId, top.id, stairRuns);
  tx.update<StairParams>(s.id, { baseOffset: z0 - lvl, topOffset: z1 - top.params.elevation, ...(winders ? { winders } : {}) });
  // The rebuilt stair must climb the same way: same risers, same treads per run.
  const lay = stairLayout(doc, doc.require(s.id) as Stair);
  if (lay.risers !== risers || lay.runs.some((r, i) => r.treads !== runs[i]!.length)) {
    tx.delete(s.id);
    return null;
  }
  return s.id;
}

/** A structural section of this shape and size (b across, d deep), else a new "Imported <what> b x d". */
function sectionFor(tx: Transaction, doc: Document, shape: "rect" | "circle", b: number, d: number, what: string, color?: number): ElementId {
  const B = Math.round(shape === "circle" ? Math.max(b, d) : b);
  const D = Math.round(shape === "circle" ? Math.max(b, d) : d);
  const have = doc.byCategory<StructuralSectionParams>(Cat.StructuralType).find((t) => t.params.shape === shape && Math.abs(t.params.b - B) < 2 && Math.abs(t.params.d - D) < 2);
  if (have) return have.id;
  const name = shape === "circle" ? `Imported ${what} Ø${D}` : `Imported ${what} ${B} x ${D}`;
  const mat = color !== undefined ? materialFor(tx, doc, color) : undefined;
  return tx.create<StructuralSectionParams>(Cat.StructuralType, { shape, b: B, d: D, tf: 0, tw: 0, materialId: mat?.id ?? null }, { name }).id;
}

/** A door type whose opening (leaf + frame) is this size, else a new "Imported Door W x H". */
function doorTypeFor(tx: Transaction, doc: Document, width: number, height: number): ElementId {
  const types = doc.byCategory<DoorTypeParams>(Cat.DoorType);
  const have = types.find((t) => Math.abs(t.params.leafWidth + 2 * t.params.frameWidth - width) < 5 && Math.abs(t.params.leafHeight + t.params.frameWidth - height) < 5);
  if (have) return have.id;
  const f = types[0]?.params.frameWidth ?? 40;
  const w = Math.round(width);
  const h = Math.round(height);
  return tx.create<DoorTypeParams>(Cat.DoorType, { leafWidth: Math.max(100, w - 2 * f), leafHeight: Math.max(100, h - f), frameWidth: f }, { name: `Imported Door ${w} x ${h}` }).id;
}

/** A window type of this size, else a new "Imported Window W x H". */
function windowTypeFor(tx: Transaction, doc: Document, width: number, height: number): ElementId {
  const types = doc.byCategory<WindowTypeParams>(Cat.WindowType);
  const have = types.find((t) => Math.abs(t.params.width - width) < 5 && Math.abs(t.params.height - height) < 5);
  if (have) return have.id;
  const f = types[0]?.params.frameWidth ?? 50;
  const w = Math.round(width);
  const h = Math.round(height);
  return tx.create<WindowTypeParams>(Cat.WindowType, { width: w, height: h, frameWidth: f, defaultSill: 900 }, { name: `Imported Window ${w} x ${h}` }).id;
}

/** A material for an imported colour: one of that colour already, else "Imported #RRGGBB". */
function materialFor(tx: Transaction, doc: Document, color: number): Material {
  const have = doc.byCategory<MaterialParams>(Cat.Material).find((m) => m.params.color === color) as Material | undefined;
  if (have) return have;
  const name = `Imported #${color.toString(16).padStart(6, "0").toUpperCase()}`;
  return (materialByName(doc, name) ?? createMaterial(tx, doc, name, { color })) as Material;
}

/** The imported element's name, and its Mark (a "….Mark" property, as Revit exports it). */
function carryOver(tx: Transaction, doc: Document, id: ElementId, ds: { name?: string; params: DirectShapeParams }): void {
  if (ds.name) tx.setName(id, ds.name);
  const mark = Object.entries(ds.params.properties).find(([k]) => /(^|\.)Mark$/.test(k))?.[1];
  if (mark) tx.update(id, { mark });
  void doc;
}

/** Convert imported IFC shapes to native walls and floors. Returns the new elements' ids and what was left as it was. */
export function convertDirectShapes(tx: Transaction, doc: Document, ids: ElementId[]): { created: ElementId[]; skipped: ElementId[] } {
  const created: ElementId[] = [];
  const skipped: ElementId[] = [];
  const walls: { id: ElementId; c: Vec2; u: Vec2; len: number; wid: number; base: number }[] = [];
  // Curtain walls first: panels in one vertical plane become one curtain wall (their mullions go with them).
  const plates = ids.filter((id) => PLATE_CLASSES.has((doc.get(id)?.params as DirectShapeParams | undefined)?.ifcClass ?? ""));
  for (const g of curtainGroups(doc, plates)) {
    const made = curtainFromPanels(tx, doc, g);
    if (!made) {
      skipped.push(...g.map((x) => x.id));
      continue;
    }
    created.push(made);
  }
  // Furniture, fixtures and equipment: families (one per distinct shape and name), placed as instances.
  const familyShapes = ids.filter((id) => ((doc.get(id)?.params as DirectShapeParams | undefined)?.ifcClass ?? "") in FAMILY_OF);
  created.push(...familiesFromShapes(tx, doc, familyShapes));
  const pendingRails: ElementId[] = [];
  const fittingShapes: ElementId[] = [];
  const footings: ElementId[] = [];
  for (const id of ids) {
    if (plates.includes(id) || familyShapes.includes(id)) continue;
    const ds = doc.get<DirectShapeParams>(id) as DirectShape | undefined;
    if (!ds) continue; // already taken into something else (a curtain wall's mullions)
    if (!convertible(ds)) {
      skipped.push(id);
      continue;
    }
    const p = ds.params;
    const lvl = doc.get<LevelParams>(p.levelId)?.params.elevation ?? 0;
    const { xy, z0, z1 } = bounds(p);
    const mat = p.color;
    const made = created.length;
    if (z1 - z0 < 1) {
      skipped.push(id);
      continue;
    }
    if (WALL_CLASSES.has(p.ifcClass)) {
      const r = minRect(xy);
      // A straight box: long and thin, and its plan fills the rectangle.
      if (!r || r.wid < 1 || r.len < r.wid || r.hullArea < 0.9 * r.len * r.wid) {
        // Or an arc: a band between two concentric arcs.
        const arc = arcWall(p);
        if (!arc) {
          skipped.push(id);
          continue;
        }
        const typeId = typeFor(tx, doc, Cat.WallType, "Imported Wall", arc.thick, mat, wallRole(p));
        const w = createWall(tx, typeId, arc.start, arc.end, p.levelId, { baseOffset: z0 - lvl, height: z1 - z0 });
        setWallCurve(tx, doc, w.id, arc.curve);
        created.push(w.id);
        for (const nid of created.slice(made)) carryOver(tx, doc, nid, ds);
        tx.delete(id);
        continue;
      }
      const typeId = typeFor(tx, doc, Cat.WallType, "Imported Wall", r.wid, mat, wallRole(p));
      const start = { x: r.c.x - (r.u.x * r.len) / 2, y: r.c.y - (r.u.y * r.len) / 2 };
      const end = { x: r.c.x + (r.u.x * r.len) / 2, y: r.c.y + (r.u.y * r.len) / 2 };
      const w = createWall(tx, typeId, start, end, p.levelId, { baseOffset: z0 - lvl, height: z1 - z0 });
      // Not a rectangle in elevation (a gable end, a skillion wall): its outline as the wall's profile.
      const elev = hull(xyzAlong(p, start, r.u).map((q) => ({ x: Math.max(0, Math.min(r.len, q.x)), y: q.y - z0 })));
      if (elev.length >= 3 && polyArea(elev) < 0.98 * r.len * (z1 - z0)) setWallProfile(tx, doc, w.id, elev);
      walls.push({ id: w.id, c: r.c, u: r.u, len: r.len, wid: r.wid, base: z0 });
      created.push(w.id);
    } else if (FOOTING_CLASSES.has(p.ifcClass)) {
      footings.push(id);
      continue;
    } else if (COLUMN_CLASSES.has(p.ifcClass)) {
      // Column: a rectangular or round section (by how much of its box the plan fills), base to top.
      const r = minRect(xy);
      if (!r || r.wid < 1) {
        skipped.push(id);
        continue;
      }
      const fill = r.hullArea / (r.len * r.wid);
      const round = Math.abs(r.len - r.wid) < 0.05 * r.len && fill > 0.7 && fill < 0.85;
      if (!round && fill < 0.9) {
        skipped.push(id);
        continue;
      }
      // Round: the diameter to its farthest points (a faceted circle's box is across the flats).
      const dia = round ? 2 * Math.max(...xy.map((q) => Math.hypot(q.x - r.c.x, q.y - r.c.y))) : 0;
      const typeId = round ? sectionFor(tx, doc, "circle", dia, dia, "Column", mat) : sectionFor(tx, doc, "rect", r.wid, r.len, "Column", mat);
      // Top: the level at or just above the column's top, else its base level.
      const levels = doc.byCategory<LevelParams>(Cat.Level).sort((a, b) => a.params.elevation - b.params.elevation);
      const top = levels.find((l) => l.params.elevation >= z1 - 1) ?? doc.require<LevelParams>(p.levelId);
      // Section depth runs along the column's local y: turn it to the long side.
      const col = createColumn(tx, doc, typeId, p.levelId, top.id === p.levelId ? p.levelId : top.id, r.c, round ? 0 : Math.atan2(r.u.y, r.u.x) - Math.PI / 2);
      tx.update<ColumnParams>(col.id, { baseOffset: z0 - lvl, topOffset: z1 - top.params.elevation });
      created.push(col.id);
    } else if (RAILING_CLASSES.has(p.ifcClass)) {
      const rail = railingFromMesh(tx, doc, p, lvl, z0, z1);
      if (!rail) {
        // Maybe a stair's railing: tried once the stairs are converted.
        pendingRails.push(id);
        continue;
      }
      created.push(rail);
    } else if (FITTING_CLASSES.has(p.ifcClass)) {
      // Dropped once runs are converted: the fitting hook makes native ones where they meet.
      fittingShapes.push(id);
      continue;
    } else if (RUN_CLASSES.has(p.ifcClass)) {
      const run = runFromMesh(tx, doc, p, lvl);
      if (!run) {
        skipped.push(id);
        continue;
      }
      created.push(run);
    } else if (RAMP_CLASSES.has(p.ifcClass)) {
      const ramp = rampFromMesh(tx, doc, p, lvl);
      if (!ramp) {
        skipped.push(id);
        continue;
      }
      created.push(ramp);
    } else if (STAIR_CLASSES.has(p.ifcClass)) {
      const stair = stairFromMesh(tx, doc, p, lvl, z0, z1);
      if (!stair) {
        skipped.push(id);
        continue;
      }
      created.push(stair);
    } else if (ROOF_CLASSES.has(p.ifcClass)) {
      const roof = roofFromMesh(tx, doc, p, lvl, z0, mat);
      if (!roof) {
        skipped.push(id);
        continue;
      }
      created.push(roof);
    } else if (BEAM_CLASSES.has(p.ifcClass)) {
      // Beam: along its plan box's long side, top at its highest point, section width × depth.
      const r = minRect(xy);
      if (!r || r.wid < 1 || r.len < 2 * r.wid || r.hullArea < 0.9 * r.len * r.wid) {
        skipped.push(id);
        continue;
      }
      let start = { x: r.c.x - (r.u.x * r.len) / 2, y: r.c.y - (r.u.y * r.len) / 2 };
      let end = { x: r.c.x + (r.u.x * r.len) / 2, y: r.c.y + (r.u.y * r.len) / 2 };
      // Each end's top (points within a twentieth of the length of it): level, or sloped (a brace/rafter).
      const along = xy.map((q) => (q.x - start.x) * r.u.x + (q.y - start.y) * r.u.y);
      const zs = (near: (u: number) => boolean) => {
        const z: number[] = [];
        for (let i = 0; i < xy.length; i++) if (near(along[i]!)) z.push(p.positions[i * 3 + 2]!);
        return z.length ? { lo: Math.min(...z), hi: Math.max(...z) } : { lo: z0, hi: z1 };
      };
      let a = zs((u) => u < r.len / 20);
      let b2 = zs((u) => u > r.len * 0.95);
      const rise = b2.hi - a.hi;
      const sloped = Math.abs(rise) > 50;
      if (sloped && rise < 0) [start, end, a, b2] = [end, start, b2, a];
      // Depth square to the member (the end cuts are plumb: their height is depth / cos(slope)).
      const slope = Math.atan2(Math.abs(rise), r.len);
      const depth = sloped ? (a.hi - a.lo) * Math.cos(slope) : z1 - z0;
      const typeId = sectionFor(tx, doc, "rect", r.wid, depth, "Beam", mat);
      const beam = createBeam(tx, doc, typeId, p.levelId, start, end);
      tx.update<BeamParams>(beam.id, sloped ? { offset: a.hi - lvl, endOffset: b2.hi - lvl, brace: true } : { offset: z1 - lvl });
      created.push(beam.id);
    } else if (CEILING_CLASSES.has(p.ifcClass) && p.properties.PredefinedType && p.properties.PredefinedType !== "CEILING") {
      // Other coverings (cladding, flooring, roofing finishes) stay as shapes.
      skipped.push(id);
      continue;
    } else if (!CEILING_CLASSES.has(p.ifcClass) && (p.properties.PredefinedType === "ROOF" || facePlanes(p, true).some((pl) => Math.hypot(pl.a, pl.b) > 0.05))) {
      // A roof slab (Revit exports roofs as slabs, or roof parts) or any sloped slab: a footprint roof.
      const roof = roofFromMesh(tx, doc, p, lvl, z0, mat);
      if (!roof) {
        skipped.push(id);
        continue;
      }
      created.push(roof);
    } else {
      // Slab: its outline is the union of its upward faces seen in plan.
      const tris: Polygon[] = [];
      const P = p.positions;
      for (let i = 0; i < p.indices.length; i += 3) {
        const [a, b, c] = [p.indices[i]! * 3, p.indices[i + 1]! * 3, p.indices[i + 2]! * 3];
        const nz = (P[b]! - P[a]!) * (P[c + 1]! - P[a + 1]!) - (P[b + 1]! - P[a + 1]!) * (P[c]! - P[a]!);
        if (nz <= 1e-6) continue;
        tris.push([[[P[a]!, P[a + 1]!], [P[b]!, P[b + 1]!], [P[c]!, P[c + 1]!], [P[a]!, P[a + 1]!]]]);
      }
      let outline: Polygon[] = [];
      try {
        outline = tris.length ? polygonClipping.union(tris[0]!, ...tris.slice(1)) : [];
      } catch {
        outline = [];
      }
      const biggest = outline
        .map((poly) => poly.map((ring) => ring.slice(0, -1).map(([x, y]) => ({ x, y }))))
        .sort((a, b) => polyArea(b[0]!) - polyArea(a[0]!))[0];
      if (!biggest || biggest[0]!.length < 3) {
        skipped.push(id);
        continue;
      }
      if (CEILING_CLASSES.has(p.ifcClass)) {
        // Ceiling: its underside above the level.
        const typeId = typeFor(tx, doc, Cat.CeilingType, "Imported Ceiling", z1 - z0, mat);
        created.push(createCeiling(tx, typeId, p.levelId, biggest[0]!, { offset: z0 - lvl, holes: biggest.slice(1) }).id);
      } else {
        const typeId = typeFor(tx, doc, Cat.FloorType, "Imported Floor", z1 - z0, mat);
        const f = createFloor(tx, typeId, p.levelId, biggest[0]!, { offset: z1 - lvl, holes: biggest.slice(1) });
        created.push(f.id);
      }
    }
    for (const nid of created.slice(made)) carryOver(tx, doc, nid, ds);
    tx.delete(id);
  }
  // Converted straight walls meet at corners and tees: each end that stops near another wall's
  // centreline moves onto it (the imported shapes run to the outer corner of their mitres).
  snapWallEnds(tx, doc, walls.map((w) => w.id));
  // Converted runs stop short of their (imported) fittings: close the gaps so native fittings form.
  snapRunEnds(tx, doc, created.filter((cid) => doc.get(cid)?.category === Cat.Duct || doc.get(cid)?.category === Cat.Pipe));
  // Imported fittings go if a converted run ends in them (else they stay, joining nothing native).
  for (const id of fittingShapes) {
    const ds = doc.get<DirectShapeParams>(id);
    if (!ds) continue;
    const { xy, z0, z1 } = bounds(ds.params);
    const x0 = Math.min(...xy.map((q) => q.x)) - 50, x1 = Math.max(...xy.map((q) => q.x)) + 50;
    const y0 = Math.min(...xy.map((q) => q.y)) - 50, y1 = Math.max(...xy.map((q) => q.y)) + 50;
    const touched = created.some((cid) => {
      const el = doc.get(cid);
      if (el?.category !== Cat.Duct && el?.category !== Cat.Pipe) return false;
      const rp = el.params as { levelId: string; start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } };
      const lz = doc.get<LevelParams>(rp.levelId)?.params.elevation ?? 0;
      return [rp.start, rp.end].some((q) => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1 && q.z + lz >= z0 - 50 && q.z + lz <= z1 + 50);
    });
    if (touched) tx.delete(id);
    else skipped.push(id);
  }
  // Footings: under a converted wall and along it, its strip footing; else a pad.
  for (const id of footings) {
    const ds = doc.get<DirectShapeParams>(id) as DirectShape | undefined;
    if (!ds) continue;
    const { xy, z0, z1 } = bounds(ds.params);
    const r = minRect(xy);
    if (!r || r.hullArea < 0.9 * r.len * r.wid) {
      skipped.push(id);
      continue;
    }
    const lvl = doc.get<LevelParams>(ds.params.levelId)?.params.elevation ?? 0;
    const under = r.len > 3 * r.wid
      ? walls.find((w) => Math.abs(w.u.x * r.u.y - w.u.y * r.u.x) < 0.02 && Math.abs(-w.u.y * (r.c.x - w.c.x) + w.u.x * (r.c.y - w.c.y)) < r.wid / 2 && Math.abs((r.c.x - w.c.x) * w.u.x + (r.c.y - w.c.y) * w.u.y) < w.len / 2)
      : undefined;
    const fid = under
      ? createStripFooting(tx, doc, under.id, { width: Math.round(r.wid), depth: Math.round(z1 - z0) }).id
      : createPadFooting(tx, doc, ds.params.levelId, r.c, { width: Math.round(r.wid), length: Math.round(r.len), depth: Math.round(z1 - z0), offset: z1 - lvl, rotation: Math.atan2(r.u.y, r.u.x) - Math.PI / 2 }).id;
    carryOver(tx, doc, fid, ds);
    created.push(fid);
    tx.delete(id);
  }
  // Sloped railings over a stair become that stair's railing on the side they're on.
  for (const id of pendingRails) {
    const ds = doc.get<DirectShapeParams>(id) as DirectShape | undefined;
    if (!ds) continue;
    const { xy, z0 } = bounds(ds.params);
    const mid = { x: xy.reduce((s, q) => s + q.x, 0) / xy.length, y: xy.reduce((s, q) => s + q.y, 0) / xy.length };
    let done = false;
    for (const st of doc.byCategory<StairParams>(Cat.Stair) as Stair[]) {
      const lay = stairLayout(doc, st);
      if (z0 < lay.bottom - 200 || z0 > lay.top) continue;
      // Over the stair: within half its width (plus a margin) of a run's line, along its length.
      for (const run of lay.runs) {
        const d = { x: mid.x - run.start.x, y: mid.y - run.start.y };
        const along = d.x * run.dir.x + d.y * run.dir.y;
        const across = run.dir.x * d.y - run.dir.y * d.x;
        if (along < -lay.going || along > run.length + lay.going || Math.abs(across) > lay.width / 2 + 300) continue;
        const side: "left" | "right" = across > 0 ? "left" : "right";
        if (doc.byCategory<RailingParams>(Cat.Railing).some((r) => r.params.hostId === st.id && r.params.side === side)) continue;
        const type = doc.byCategory(Cat.RailingType)[0]?.id ?? tx.create<RailingTypeParams>(Cat.RailingType, { height: 1000, railSize: 50, balusterSize: 25, balusterGap: 100 }, { name: "Imported Railing 1000" }).id;
        const rail = tx.create<RailingParams>(Cat.Railing, { levelId: st.params.baseLevelId, baseOffset: 0, path: [], hostId: st.id, side }, { typeId: type });
        carryOver(tx, doc, rail.id, ds);
        created.push(rail.id);
        tx.delete(id);
        done = true;
        break;
      }
      if (done) break;
    }
    if (!done) skipped.push(id);
  }
  // Imported doors and windows in a converted wall become native ones (types matched by size, else
  // new "Imported" types); if one won't fit, the wall is just opened up for the imported shape.
  for (const ds of doc.byCategory<DirectShapeParams>(Cat.DirectShape)) {
    if (!INSERT_CLASSES.has(ds.params.ifcClass)) continue;
    const { xy, z0, z1 } = bounds(ds.params);
    for (const w of walls) {
      const us = xy.map((q) => (q.x - w.c.x) * w.u.x + (q.y - w.c.y) * w.u.y);
      const vs = xy.map((q) => -(q.x - w.c.x) * w.u.y + (q.y - w.c.y) * w.u.x);
      const mid = (Math.min(...vs) + Math.max(...vs)) / 2;
      if (Math.abs(mid) > w.wid / 2 + 100) continue;
      const u0 = Math.max(-w.len / 2, Math.min(...us));
      const u1 = Math.min(w.len / 2, Math.max(...us));
      if (u1 - u0 < 50) continue;
      const along = (u0 + u1) / 2 + w.len / 2;
      const stated = (k: string) => Number(ds.params.properties[k]);
      const width = stated("OverallWidth") > 0 ? stated("OverallWidth") : u1 - u0;
      const height = stated("OverallHeight") > 0 ? stated("OverallHeight") : z1 - z0;
      const door = ds.params.ifcClass === "IfcDoor";
      try {
        const id = door
          ? createDoor(tx, doc, doorTypeFor(tx, doc, width, height), w.id, along).id
          : createWindow(tx, doc, windowTypeFor(tx, doc, width, height), w.id, along, { sillHeight: Math.max(0, z0 - w.base) }).id;
        carryOver(tx, doc, id, ds);
        created.push(id);
        tx.delete(ds.id);
      } catch {
        try {
          created.push(createWallOpening(tx, doc, w.id, along, { width: u1 - u0, sillHeight: z0 - w.base, height: z1 - z0 }).id);
        } catch {
          // Doesn't fit the wall (runs past an end or over the top): leave it solid.
        }
      }
      break;
    }
  }
  return { created, skipped };
}
