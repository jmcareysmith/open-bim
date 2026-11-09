import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat, floorExtent, wallExtent, wallLength, wallThickness, type Floor, type LevelParams, type Wall } from "./architecture.ts";
import { columnExtent, type BeamParams, type Column, type PadFootingParams, type StripFootingParams, type StructuralSectionParams } from "./structure.ts";

// Reinforcement (Revit: Rebar, Area Reinforcement). A rebar set lives in a concrete host and is
// laid out from it, so it follows the host when that changes:
// - floors and pad footings: area reinforcement — bars both ways at a spacing, bottom/top/both
//   mats, inside the cover;
// - beams, columns and strip footings: a cage — longitudinal bars at the corners (more spread
//   along the top and bottom faces) and closed ties at a spacing.
// Bar sizes are NZ grades: D = 300E, HD = 500E (AS/NZS 4671).

export type BarSize = "D10" | "D12" | "D16" | "HD10" | "HD12" | "HD16" | "HD20" | "HD25" | "HD32";
export const BAR_SIZES: BarSize[] = ["D10", "D12", "D16", "HD10", "HD12", "HD16", "HD20", "HD25", "HD32"];

/** Nominal bar diameter, mm. */
export function barDiameter(bar: BarSize): number {
  return Number(bar.replace(/\D/g, ""));
}

/** Mass per metre, kg/m (steel 7850 kg/m³: d²/162). */
export function barMassPerMetre(bar: BarSize): number {
  const d = barDiameter(bar);
  return (d * d) / 162.1;
}

export type RebarParams = {
  hostId: ElementId;
  /** Main bars. */
  bar: BarSize;
  /** Clear cover to the outermost bar, mm. */
  cover: number;
  /** Area reinforcement: bar spacing both ways, mm. */
  spacing: number;
  /** Area reinforcement: which mats. */
  layers?: "bottom" | "top" | "both" | null;
  /** Area reinforcement: direction of the outer bars, radians from plan X. */
  angle?: number | null;
  /** Cages: number of longitudinal bars (even, at least 4). */
  count?: number | null;
  /** Cages: ties (null: none). */
  tieBar?: BarSize | null;
  tieSpacing?: number | null;
};
export type Rebar = Element<RebarParams>;

registerCategory({ name: Cat.Rebar, dependencies: (el) => [(el.params as RebarParams).hostId], cascadeDelete: true, isType: false });

/** Hosts taking area reinforcement, and hosts taking cages. */
export const AREA_REBAR_HOSTS = new Set<string>([Cat.Floor, Cat.PadFooting, Cat.Wall]);
export const CAGE_REBAR_HOSTS = new Set<string>([Cat.Beam, Cat.Column, Cat.StripFooting]);

export function createRebar(tx: Transaction, doc: Document, hostId: ElementId, opts: Partial<Omit<RebarParams, "hostId">> = {}): Rebar {
  const host = doc.get(hostId);
  if (!host) throw new Error("Pick an element to reinforce");
  const area = AREA_REBAR_HOSTS.has(host.category);
  if (!area && !CAGE_REBAR_HOSTS.has(host.category)) throw new Error("Rebar goes in floors, walls, footings, beams and columns");
  const base: RebarParams = area
    ? host.category === Cat.Wall
      ? { hostId, bar: "HD12", cover: 40, spacing: 400, layers: "both", angle: 0 }
      : { hostId, bar: "HD12", cover: 50, spacing: 300, layers: "bottom", angle: 0 }
    : { hostId, bar: "HD16", cover: 40, spacing: 0, count: 4, tieBar: "D10", tieSpacing: 200 };
  return tx.create<RebarParams>(Cat.Rebar, { ...base, ...opts });
}

type V3 = [number, number, number];
/** One bar: a polyline (closed for ties) and its diameter. */
export interface RebarBar {
  points: V3[];
  closed: boolean;
  diameter: number;
  bar: BarSize;
}

/** The bars of a rebar set, laid out in its host now. Empty when the host can't take them. */
export function rebarBars(doc: Document, rebar: Rebar): RebarBar[] {
  const host = doc.get(rebar.params.hostId);
  if (!host) return [];
  const p = rebar.params;
  switch (host.category) {
    case Cat.Wall: {
      // Walls: vertical and horizontal bars on a face (layers: "bottom" = interior face, "top" =
      // exterior, "both"), vertical bars outermost, inside the cover. Straight walls only.
      const w = host as Wall;
      if (w.params.curve) return [];
      const { bottom, top } = wallExtent(doc, w);
      return wallBars(p, w, wallThickness(doc, w), bottom, top);
    }
    case Cat.Floor: {
      const f = host as Floor;
      const { bottom, top } = floorExtent(doc, f);
      return areaBars(p, [f.params.boundary, ...f.params.holes], bottom, top);
    }
    case Cat.PadFooting: {
      const q = host.params as PadFootingParams;
      const lv = doc.get<LevelParams>(q.levelId)?.params.elevation ?? 0;
      const c = Math.cos(q.rotation);
      const s = Math.sin(q.rotation);
      const ring = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([a, b]) => {
        const x = (a! * q.width) / 2;
        const y = (b! * q.length) / 2;
        return { x: q.position.x + x * c - y * s, y: q.position.y + x * s + y * c };
      });
      return areaBars(p, [ring], lv + q.offset - q.depth, lv + q.offset);
    }
    case Cat.Beam: {
      const b = host.params as BeamParams;
      const s = sectionOf(doc, host);
      if (!s) return [];
      const lv = doc.get<LevelParams>(b.levelId)?.params.elevation ?? 0;
      const z0 = lv + b.offset;
      const z1 = lv + (b.endOffset ?? b.offset);
      // Local frame: along the beam, `across` to its left, up; bottom of the section at top - d.
      return cageBars(p, s.b, s.d, (u, v, w, len) => {
        const t = u / len;
        return frameAlong(b.start, b.end, u, v, z0 + (z1 - z0) * t - s.d + w);
      }, Math.hypot(b.end.x - b.start.x, b.end.y - b.start.y));
    }
    case Cat.Column: {
      const c = host as Column;
      const s = sectionOf(doc, host);
      if (!s) return [];
      const { bottom, top } = columnExtent(doc, c);
      const r = c.params.rotation;
      // Columns: "along" is up, "across" is the section's local x, "up" its local y.
      return cageBars(p, s.b, s.d, (u, v, w) => {
        const x = v;
        const y = w - s.d / 2;
        return [c.params.position.x + x * Math.cos(r) - y * Math.sin(r), c.params.position.y + x * Math.sin(r) + y * Math.cos(r), bottom + u];
      }, top - bottom);
    }
    case Cat.StripFooting: {
      const q = host.params as StripFootingParams;
      const w = doc.get(q.wallId) as Wall | undefined;
      if (!w) return [];
      const zb = wallExtent(doc, w).bottom - q.depth;
      const e = q.width / 2;
      const len = wallLength(w);
      const d = { x: (w.params.end.x - w.params.start.x) / len, y: (w.params.end.y - w.params.start.y) / len };
      const a = { x: w.params.start.x - d.x * e, y: w.params.start.y - d.y * e };
      const b = { x: w.params.end.x + d.x * e, y: w.params.end.y + d.y * e };
      return cageBars(p, q.width, q.depth, (u, v, h) => frameAlong(a, b, u, v, zb + h), len + 2 * e);
    }
    default:
      return [];
  }
}

/** Total length (mm) and mass (kg) of a rebar set. */
export function rebarQuantities(doc: Document, rebar: Rebar): { bars: number; length: number; mass: number } {
  let length = 0;
  let mass = 0;
  const bars = rebarBars(doc, rebar);
  for (const b of bars) {
    const l = polylineLength(b.points, b.closed);
    length += l;
    mass += (l / 1000) * barMassPerMetre(b.bar);
  }
  return { bars: bars.length, length, mass };
}

function polylineLength(pts: V3[], closed: boolean): number {
  let l = 0;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    l += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return l;
}

function sectionOf(doc: Document, el: Element): StructuralSectionParams | undefined {
  const s = el.typeId ? doc.get<StructuralSectionParams>(el.typeId)?.params : undefined;
  // Cages need a rectangle (concrete or timber shapes); circles take the bounding square.
  return s && (s.shape === "rect" || s.shape === "circle") ? s : undefined;
}

/** Point `u` along a → b, `v` to its left, at height z. */
function frameAlong(a: Vec2, b: Vec2, u: number, v: number, z: number): V3 {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const d = { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  return [a.x + d.x * u - d.y * v, a.y + d.y * u + d.x * v, z];
}

/**
 * Area reinforcement: in each mat, bars along the angle at the spacing, clipped to the outline
 * (holes cut them) and held `cover` inside it; the cross bars sit on (bottom) or under (top) them.
 */
function areaBars(p: RebarParams, rings: Vec2[][], bottom: number, top: number): RebarBar[] {
  const d = barDiameter(p.bar);
  const out: RebarBar[] = [];
  const ang = p.angle ?? 0;
  const spacing = Math.max(50, p.spacing);
  const layers = p.layers ?? "bottom";
  const mats: { z: number; dir: number }[] = [];
  if (layers !== "top") mats.push({ z: bottom + p.cover + d / 2, dir: 0 }, { z: bottom + p.cover + (3 * d) / 2, dir: 1 });
  if (layers !== "bottom") mats.push({ z: top - p.cover - d / 2, dir: 0 }, { z: top - p.cover - (3 * d) / 2, dir: 1 });
  if (top - bottom < 2 * p.cover + 2 * d) return [];
  for (const m of mats) {
    const a = ang + (m.dir ? Math.PI / 2 : 0);
    const c = Math.cos(a);
    const s = Math.sin(a);
    // Rotate so bars run along local x; scan local y.
    const toL = (q: Vec2): Vec2 => ({ x: q.x * c + q.y * s, y: -q.x * s + q.y * c });
    const toW = (q: Vec2): Vec2 => ({ x: q.x * c - q.y * s, y: q.x * s + q.y * c });
    const local = rings.map((r) => r.map(toL));
    const ys = local[0]!.map((q) => q.y);
    const y0 = Math.min(...ys) + p.cover + d / 2;
    const y1 = Math.max(...ys) - p.cover - d / 2;
    const n = Math.floor((y1 - y0) / spacing + 1e-6);
    // Centre the bars in the width left over.
    const start = y0 + (y1 - y0 - n * spacing) / 2;
    for (let i = 0; i <= n; i++) {
      const y = start + i * spacing;
      for (const [x0, x1] of scanline(local, y)) {
        const a0 = x0 + p.cover;
        const a1 = x1 - p.cover;
        if (a1 - a0 < 100) continue;
        const pa = toW({ x: a0, y });
        const pb = toW({ x: a1, y });
        out.push({ points: [[pa.x, pa.y, m.z], [pb.x, pb.y, m.z]], closed: false, diameter: d, bar: p.bar });
      }
    }
  }
  return out;
}

/** Wall mats: verticals at the spacing along the wall, horizontals up it, on each face asked for. */
function wallBars(p: RebarParams, w: Wall, thickness: number, bottom: number, top: number): RebarBar[] {
  const d = barDiameter(p.bar);
  const len = wallLength(w);
  const out: RebarBar[] = [];
  const spacing = Math.max(50, p.spacing);
  if (thickness < 2 * p.cover + 2 * d || len <= 2 * p.cover || top - bottom <= 2 * p.cover) return [];
  const faces: number[] = [];
  const layers = p.layers ?? "bottom";
  // Across the wall: + is the exterior (left of start → end).
  if (layers !== "top") faces.push(-1);
  if (layers !== "bottom") faces.push(1);
  const spread = (lo: number, hi: number) => {
    const n = Math.floor((hi - lo) / spacing + 1e-6);
    const first = lo + (hi - lo - n * spacing) / 2;
    return Array.from({ length: n + 1 }, (_, i) => first + i * spacing);
  };
  const at = (u: number, v: number, z: number): V3 => {
    const l = len || 1;
    const dx = (w.params.end.x - w.params.start.x) / l;
    const dy = (w.params.end.y - w.params.start.y) / l;
    return [w.params.start.x + dx * u - dy * v, w.params.start.y + dy * u + dx * v, z];
  };
  for (const f of faces) {
    const vOut = f * (thickness / 2 - p.cover - d / 2);
    const vIn = f * (thickness / 2 - p.cover - (3 * d) / 2);
    for (const u of spread(p.cover + d / 2, len - p.cover - d / 2)) out.push({ points: [at(u, vOut, bottom + p.cover), at(u, vOut, top - p.cover)], closed: false, diameter: d, bar: p.bar });
    for (const z of spread(bottom + p.cover + d / 2, top - p.cover - d / 2)) out.push({ points: [at(p.cover, vIn, z), at(len - p.cover, vIn, z)], closed: false, diameter: d, bar: p.bar });
  }
  return out;
}

/** Where the horizontal line at `y` is inside the rings (even-odd), as x intervals. */
function scanline(rings: Vec2[][], y: number): [number, number][] {
  const xs: number[] = [];
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i]!;
      const b = r[(i + 1) % r.length]!;
      if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
  }
  xs.sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i]!, xs[i + 1]!]);
  return out;
}

/**
 * A cage in a member `width` × `depth` and `len` long. `at(u, v, w, len)` maps local coordinates
 * (u along from 0 to len, v across from the centre, w up from the bottom) to the model.
 */
function cageBars(p: RebarParams, width: number, depth: number, at: (u: number, v: number, w: number, len: number) => V3, len: number): RebarBar[] {
  const d = barDiameter(p.bar);
  const tie = p.tieBar ? barDiameter(p.tieBar) : 0;
  const out: RebarBar[] = [];
  const vIn = width / 2 - p.cover - tie - d / 2;
  const wLo = p.cover + tie + d / 2;
  const wHi = depth - p.cover - tie - d / 2;
  if (vIn <= 0 || wHi <= wLo || len <= 2 * p.cover) return [];
  // Longitudinal bars: half along the bottom face, half along the top, corners included.
  const perFace = Math.max(2, Math.round((p.count ?? 4) / 2));
  for (const w of [wLo, wHi]) {
    for (let i = 0; i < perFace; i++) {
      const v = -vIn + (2 * vIn * i) / (perFace - 1);
      out.push({ points: [at(p.cover, v, w, len), at(len - p.cover, v, w, len)], closed: false, diameter: d, bar: p.bar });
    }
  }
  if (p.tieBar && p.tieSpacing && p.tieSpacing > 0) {
    const tv = width / 2 - p.cover - tie / 2;
    const tLo = p.cover + tie / 2;
    const tHi = depth - p.cover - tie / 2;
    const n = Math.floor((len - 2 * p.cover - 50) / p.tieSpacing + 1e-6);
    const first = (len - n * p.tieSpacing) / 2;
    for (let i = 0; i <= n; i++) {
      const u = first + i * p.tieSpacing;
      out.push({ points: [at(u, -tv, tLo, len), at(u, tv, tLo, len), at(u, tv, tHi, len), at(u, -tv, tHi, len)], closed: true, diameter: tie, bar: p.tieBar });
    }
  }
  return out;
}
