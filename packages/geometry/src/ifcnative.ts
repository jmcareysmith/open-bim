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
  setWallCurve,
  createStair,
  createStairType,
  type StairParams,
  type StairTypeParams,
  type BeamParams,
  type ColumnParams,
  type StructuralSectionParams,
  type DoorTypeParams,
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
const BEAM_CLASSES = new Set(["IfcBeam"]);
const ROOF_CLASSES = new Set(["IfcRoof"]);
const STAIR_CLASSES = new Set(["IfcStair", "IfcStairFlight"]);
const INSERT_CLASSES = new Set(["IfcDoor", "IfcWindow"]);

/** Can this imported shape become a native element? */
export function convertible(el: { category: string; params: unknown }): boolean {
  if (el.category !== Cat.DirectShape) return false;
  const c = (el.params as DirectShapeParams).ifcClass;
  return WALL_CLASSES.has(c) || SLAB_CLASSES.has(c) || COLUMN_CLASSES.has(c) || BEAM_CLASSES.has(c) || ROOF_CLASSES.has(c) || STAIR_CLASSES.has(c);
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
function typeFor(tx: Transaction, doc: Document, category: string, label: string, t: number, color?: number): ElementId {
  const have = doc.byCategory<LayeredTypeParams>(category).find((x) => !x.params.curtain && !x.params.stack?.length && Math.abs(typeThickness(x.params) - t) < 0.5);
  if (have) return have.id;
  const r = Math.round(t);
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
  const treads = [...levels.entries()].sort((x, y) => x[0] - y[0]).map(([z, g]) => ({ z, c: { x: g.cx / g.a, y: g.cy / g.a }, pts: g.pts }));
  // The topmost face at the stair's top is the landing/floor it arrives at, not a tread.
  if (treads.length && Math.abs(treads[treads.length - 1]!.z - z1) < 1) treads.pop();
  if (treads.length < 2) return null;
  const risers = treads.length + 1;
  const riser = (z1 - z0) / risers;
  // Even risers, treads in a straight line at an even going.
  if (treads.some((t, i) => Math.abs(t.z - (z0 + riser * (i + 1))) > 3)) return null;
  const first = treads[0]!.c;
  const last = treads[treads.length - 1]!.c;
  const span = Math.hypot(last.x - first.x, last.y - first.y);
  if (span < 1) return null;
  const dir = { x: (last.x - first.x) / span, y: (last.y - first.y) / span };
  const going = span / (treads.length - 1);
  if (treads.some((t, i) => Math.hypot(t.c.x - (first.x + dir.x * going * i), t.c.y - (first.y + dir.y * going * i)) > 5)) return null;
  const across = { x: -dir.y, y: dir.x };
  const ws = treads[0]!.pts.map((q) => (q.x - first.x) * across.x + (q.y - first.y) * across.y);
  const width = Math.max(...ws) - Math.min(...ws);
  const centreOff = (Math.max(...ws) + Math.min(...ws)) / 2;
  // The run starts half a going before the first tread's centre, on the stair's centreline.
  const start = { x: first.x - (dir.x * going) / 2 + across.x * centreOff, y: first.y - (dir.y * going) / 2 + across.y * centreOff };
  const end = { x: start.x + dir.x * going * treads.length, y: start.y + dir.y * going * treads.length };
  const typeName = `Imported Stair ${Math.round(width)} wide ${Math.round(going)} going`;
  const type =
    doc.byCategory<StairTypeParams>(Cat.StairType).find((t) => Math.abs(t.params.going - going) < 2 && Math.abs(t.params.width - width) < 2 && Math.ceil((z1 - z0) / t.params.maxRiser - 1e-9) === risers)?.id ??
    createStairType(tx, typeName, { going: Math.round(going * 10) / 10, width: Math.round(width), maxRiser: riser + 0.01 }).id;
  // Top: the level at the stair's top, else the base level with an offset.
  // Top: the level at the stair's top, else the nearest above its base (with an offset).
  const above = doc.byCategory<LevelParams>(Cat.Level).filter((l) => l.params.elevation > lvl + 1).sort((a, b) => Math.abs(a.params.elevation - z1) - Math.abs(b.params.elevation - z1));
  const top = above[0];
  if (!top) return null;
  const s = createStair(tx, doc, type, p.levelId, top.id, [{ start, end }]);
  tx.update<StairParams>(s.id, { baseOffset: z0 - lvl, topOffset: z1 - top.params.elevation });
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
  for (const id of ids) {
    const ds = doc.get<DirectShapeParams>(id) as DirectShape | undefined;
    if (!ds || !convertible(ds)) {
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
        const typeId = typeFor(tx, doc, Cat.WallType, "Imported Wall", arc.thick, mat);
        const w = createWall(tx, typeId, arc.start, arc.end, p.levelId, { baseOffset: z0 - lvl, height: z1 - z0 });
        setWallCurve(tx, doc, w.id, arc.curve);
        created.push(w.id);
        for (const nid of created.slice(made)) carryOver(tx, doc, nid, ds);
        tx.delete(id);
        continue;
      }
      const typeId = typeFor(tx, doc, Cat.WallType, "Imported Wall", r.wid, mat);
      const start = { x: r.c.x - (r.u.x * r.len) / 2, y: r.c.y - (r.u.y * r.len) / 2 };
      const end = { x: r.c.x + (r.u.x * r.len) / 2, y: r.c.y + (r.u.y * r.len) / 2 };
      const w = createWall(tx, typeId, start, end, p.levelId, { baseOffset: z0 - lvl, height: z1 - z0 });
      walls.push({ id: w.id, c: r.c, u: r.u, len: r.len, wid: r.wid, base: z0 });
      created.push(w.id);
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
      const typeId = sectionFor(tx, doc, "rect", r.wid, z1 - z0, "Beam", mat);
      const start = { x: r.c.x - (r.u.x * r.len) / 2, y: r.c.y - (r.u.y * r.len) / 2 };
      const end = { x: r.c.x + (r.u.x * r.len) / 2, y: r.c.y + (r.u.y * r.len) / 2 };
      const beam = createBeam(tx, doc, typeId, p.levelId, start, end);
      tx.update<BeamParams>(beam.id, { offset: z1 - lvl });
      created.push(beam.id);
    } else if (p.properties.PredefinedType === "ROOF" || facePlanes(p, true).some((pl) => Math.hypot(pl.a, pl.b) > 0.05)) {
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
      const typeId = typeFor(tx, doc, Cat.FloorType, "Imported Floor", z1 - z0, mat);
      const f = createFloor(tx, typeId, p.levelId, biggest[0]!, { offset: z1 - lvl, holes: biggest.slice(1) });
      created.push(f.id);
    }
    for (const nid of created.slice(made)) carryOver(tx, doc, nid, ds);
    tx.delete(id);
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
