import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat, floorExtent, type Floor, type LevelParams } from "./architecture.ts";
import { barDiameter, rebarBars, type BarSize, type Rebar, type RebarParams } from "./rebar.ts";
import { columnExtent, type BeamParams, type Column, type StructuralSectionParams } from "./structure.ts";
import { analyticalModel } from "./analytical.ts";

// Structural loads and simple member checks (Revit: Analyze → Loads; checks are ours).
// PROVISIONAL figures, to be confirmed by an engineer (Jeremy: build with our own for now):
// - cases G (permanent), Q (imposed), W (wind, ultimate); self-weight added to G;
// - NZS 1170.0 combinations: ULS 1.35G, 1.2G + 1.5Q, 1.2G + ψc·Q + Wu (ψc 0.4); SLS G + ψs·Q (ψs 0.7);
// - beams simply supported over their length; deflection limit span/250 under SLS;
// - floor area loads reach a beam over its tributary width (set on the beam, else half the gap to
//   the next parallel beam each side, or to the floor's edge when there's none);
// - columns carry the end reactions of beams framing into their top, plus columns above; capacity
//   phi.A.f with Rankine buckling about the weak axis (pinned ends): steel 300, timber SG8 fc 18,
//   concrete 0.85f'c (phi 0.65, bars ignored);
// - steel Grade 300 (φ 0.9, bending on the elastic modulus, shear on the web at 0.6fy);
//   timber SG8 (fb 14, fs 3.8 MPa, φ 0.8, k1 0.8, E 8 GPa); concrete f'c 30 with the beam's bottom
//   bars (φ 0.85 bending), shear on 0.17√f'c·b·d (φ 0.75), E 25 GPa × 0.5 cracked.

export type LoadCase = "G" | "Q" | "W";
export const LOAD_CASES: { value: LoadCase; label: string }[] = [
  { value: "G", label: "G — permanent" },
  { value: "Q", label: "Q — imposed" },
  { value: "W", label: "W — wind (ultimate)" },
];

export type StructuralLoadParams = {
  /** A beam (line and point loads) or a floor (area loads). */
  hostId: ElementId;
  case: LoadCase;
  kind: "line" | "point" | "area";
  /** Line: kN/m, downwards, full length. Point: kN, downwards. Area: kPa over the floor. */
  value: number;
  /** Point loads: distance from the beam's start, mm. */
  at?: number | null;
};
export type StructuralLoad = Element<StructuralLoadParams>;

registerCategory({ name: Cat.StructuralLoad, dependencies: (el) => [(el.params as StructuralLoadParams).hostId], cascadeDelete: true, isType: false });

export function createLoad(tx: Transaction, doc: Document, hostId: ElementId, load: Omit<StructuralLoadParams, "hostId">): StructuralLoad {
  const cat = doc.get(hostId)?.category;
  if (load.kind === "area" ? cat !== Cat.Floor : cat !== Cat.Beam) throw new Error(load.kind === "area" ? "Area loads go on floors" : "Line and point loads go on beams");
  if (!(load.value >= 0)) throw new Error("Loads act downwards: enter a positive value");
  return tx.create<StructuralLoadParams>(Cat.StructuralLoad, { ...load, hostId });
}

export type StructuralMaterial = "steel" | "timber" | "concrete";

/** What a section is made of: by its name, else its shape (I/SHS steel, slender rectangles timber). */
export function sectionMaterial(name: string, s: StructuralSectionParams): StructuralMaterial {
  if (/concrete/i.test(name)) return "concrete";
  if (/timber|\bSG\d|LVL|glulam/i.test(name)) return "timber";
  if (/steel|UB|UC|PFC|SHS|RHS|CHS/i.test(name) || s.shape === "I" || s.shape === "SHS") return "steel";
  return s.b < 100 ? "timber" : "concrete";
}

/** Section area (mm²), second moment about the bending axis (mm⁴) and shear area (mm²). */
/** Second moment about the weak axis, mm⁴ (buckling). */
export function weakAxisI(s: StructuralSectionParams): number {
  const { d, b, tf, tw } = s;
  switch (s.shape) {
    case "I":
      return (2 * tf * b ** 3 + (d - 2 * tf) * tw ** 3) / 12;
    case "SHS":
      return Math.min(sectionProperties(s).I, (d * b ** 3 - (d - 2 * tf) * (b - 2 * tw) ** 3) / 12);
    case "circle":
      return (Math.PI * d ** 4) / 64;
    default:
      return Math.min(b * d ** 3, d * b ** 3) / 12;
  }
}

export function sectionProperties(s: StructuralSectionParams): { A: number; I: number; Av: number } {
  const { d, b, tf, tw } = s;
  switch (s.shape) {
    case "I":
      return { A: 2 * b * tf + (d - 2 * tf) * tw, I: (b * d ** 3 - (b - tw) * (d - 2 * tf) ** 3) / 12, Av: d * tw };
    case "SHS":
      return { A: b * d - (b - 2 * tw) * (d - 2 * tf), I: (b * d ** 3 - (b - 2 * tw) * (d - 2 * tf) ** 3) / 12, Av: 2 * d * tw };
    case "circle":
      return { A: (Math.PI * d * d) / 4, I: (Math.PI * d ** 4) / 64, Av: (0.9 * Math.PI * d * d) / 4 };
    default:
      return { A: b * d, I: (b * d ** 3) / 12, Av: b * d };
  }
}

const DENSITY: Record<StructuralMaterial, number> = { steel: 77, timber: 5, concrete: 24 }; // kN/m³
const E: Record<StructuralMaterial, number> = { steel: 200_000, timber: 8_000, concrete: 12_500 }; // MPa

export interface BeamCheck {
  material: StructuralMaterial;
  /** Span, mm. */
  span: number;
  /** Self-weight, kN/m. */
  selfWeight: number;
  /** Governing ULS combination and design actions: M* kNm, V* kN. */
  combination: string;
  M: number;
  V: number;
  /** Design capacities φM, φV (kNm, kN); null when it can't be worked out (e.g. unreinforced concrete). */
  phiM: number | null;
  phiV: number | null;
  /** SLS mid-span deflection and its limit, mm. */
  deflection: number;
  limit: number;
  ok: boolean;
  notes: string[];
  /** Tributary width for floor area loads, mm (0 when none reach it). */
  tributary: number;
}

interface Loading {
  beam: Element<BeamParams>;
  section: StructuralSectionParams;
  material: StructuralMaterial;
  L: number;
  selfWeight: number;
  lines: { case: LoadCase; w: number }[];
  points: { case: LoadCase; P: number; a: number }[];
  /** Tributary width used for area loads, mm (0 when none reach the beam). */
  tributary: number;
}

/** Everything bearing on a beam: its own line/point loads, and floor area loads over its tributary width. */
function beamLoading(doc: Document, beamId: ElementId): Loading | null {
  const beam = doc.get<BeamParams>(beamId);
  if (!beam || beam.category !== Cat.Beam || !beam.typeId) return null;
  const type = doc.get<StructuralSectionParams>(beam.typeId);
  if (!type) return null;
  const p = beam.params;
  const rise = (p.endOffset ?? p.offset) - p.offset;
  const L = Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y, rise);
  if (L < 1) return null;
  const material = sectionMaterial(type.name ?? "", type.params);
  const selfWeight = (sectionProperties(type.params).A / 1e6) * DENSITY[material];
  const lines: Loading["lines"] = [];
  const points: Loading["points"] = [];
  const all = doc.byCategory<StructuralLoadParams>(Cat.StructuralLoad);
  for (const l of all) {
    if (l.params.hostId !== beamId) continue;
    if (l.params.kind === "line") lines.push({ case: l.params.case, w: l.params.value });
    else if (l.params.kind === "point") points.push({ case: l.params.case, P: l.params.value, a: Math.min(Math.max(l.params.at ?? L / 2, 0), L) });
  }
  // Area loads on floors the beam holds up (its top within 600 below the floor's top).
  let tributary = 0;
  const areaLoads = all.filter((l) => l.params.kind === "area");
  if (areaLoads.length && !p.brace) {
    const lv = doc.get<LevelParams>(p.levelId)?.params.elevation ?? 0;
    const top = lv + p.offset;
    const mid = { x: (p.start.x + p.end.x) / 2, y: (p.start.y + p.end.y) / 2 };
    for (const f of doc.byCategory(Cat.Floor) as Floor[]) {
      const loads = areaLoads.filter((l) => l.params.hostId === f.id);
      if (!loads.length) continue;
      const ext = floorExtent(doc, f);
      if (top < ext.top - 600 || top > ext.top + 50) continue;
      if (!inside(mid, f.params.boundary)) continue;
      const t = p.tributary ?? autoTributary(doc, beam, f);
      tributary = Math.max(tributary, t);
      for (const l of loads) lines.push({ case: l.params.case, w: (l.params.value * t) / 1000 });
    }
  }
  return { beam, section: type.params, material, L, selfWeight, lines, points, tributary };
}

/** Half the gap to the nearest parallel beam each side (same level), or the full way to the floor's edge. */
function autoTributary(doc: Document, beam: Element<BeamParams>, floor: Floor): number {
  const p = beam.params;
  const len = Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y);
  const d = { x: (p.end.x - p.start.x) / len, y: (p.end.y - p.start.y) / len };
  const n = { x: -d.y, y: d.x };
  const mid = { x: (p.start.x + p.end.x) / 2, y: (p.start.y + p.end.y) / 2 };
  let total = 0;
  for (const side of [1, -1]) {
    const dir = { x: n.x * side, y: n.y * side };
    let best = Infinity;
    for (const o of doc.byCategory<BeamParams>(Cat.Beam)) {
      if (o.id === beam.id || o.params.levelId !== p.levelId || o.params.brace) continue;
      const ol = Math.hypot(o.params.end.x - o.params.start.x, o.params.end.y - o.params.start.y);
      if (ol < 1) continue;
      const od = { x: (o.params.end.x - o.params.start.x) / ol, y: (o.params.end.y - o.params.start.y) / ol };
      if (Math.abs(od.x * d.y - od.y * d.x) > 0.05) continue;
      const dist = (o.params.start.x - mid.x) * dir.x + (o.params.start.y - mid.y) * dir.y;
      // The other beam's span must cover our midpoint.
      const along = (mid.x - o.params.start.x) * od.x + (mid.y - o.params.start.y) * od.y;
      if (dist > 1 && along >= 0 && along <= ol) best = Math.min(best, dist / 2);
    }
    if (best === Infinity) best = rayToEdge(mid, dir, floor.params.boundary);
    total += best === Infinity ? 0 : best;
  }
  return total;
}

function rayToEdge(o: Vec2, d: Vec2, ring: Vec2[]): number {
  let t = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const e = { x: b.x - a.x, y: b.y - a.y };
    const den = d.x * e.y - d.y * e.x;
    if (Math.abs(den) < 1e-9) continue;
    const s = ((a.x - o.x) * e.y - (a.y - o.y) * e.x) / den;
    const u = ((a.x - o.x) * d.y - (a.y - o.y) * d.x) / den;
    if (s > 1e-6 && u >= 0 && u <= 1) t = Math.min(t, s);
  }
  return t;
}

function inside(q: Vec2, ring: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

const COMBOS: [string, Record<LoadCase, number>][] = [
  ["1.35G", { G: 1.35, Q: 0, W: 0 }],
  ["1.2G + 1.5Q", { G: 1.2, Q: 1.5, W: 0 }],
  ["1.2G + 0.4Q + Wu", { G: 1.2, Q: 0.4, W: 1 }],
];

/** Uniform load w (kN/m) and point loads (kN at m from the start) under factors per case. */
function factored(ld: Loading, f: Record<LoadCase, number>): { w: number; pts: { P: number; a: number }[] } {
  let w = ld.selfWeight * f.G;
  for (const l of ld.lines) w += l.w * f[l.case];
  const pts = ld.points.filter((q) => f[q.case]).map((q) => ({ P: q.P * f[q.case], a: q.a / 1000 }));
  return { w, pts };
}

/** End reactions (kN) of a simply supported beam under factors per case. */
export function beamReactions(doc: Document, beamId: ElementId, f: Record<LoadCase, number>): { start: number; end: number } | null {
  const ld = beamLoading(doc, beamId);
  if (!ld) return null;
  const Lm = ld.L / 1000;
  const { w, pts } = factored(ld, f);
  let start = (w * Lm) / 2;
  let end = (w * Lm) / 2;
  for (const q of pts) {
    start += (q.P * (Lm - q.a)) / Lm;
    end += (q.P * q.a) / Lm;
  }
  return { start, end };
}

/** Simply supported check of a beam under its loads (all PROVISIONAL, see the file header). */
export function beamCheck(doc: Document, beamId: ElementId): BeamCheck | null {
  const ld = beamLoading(doc, beamId);
  if (!ld) return null;
  const { beam, section: s, material: mat, L, selfWeight } = ld;
  const p = beam.params;
  const lv = doc.get<LevelParams>(p.levelId)?.params.elevation ?? 0;
  const { I, Av } = sectionProperties(s);
  const Lm = L / 1000;
  const EI = E[mat] * I;
  // End fixity: both fixed (encastré), one fixed (propped cantilever), or simply supported.
  const fixedEnds = (p.startFixity === "fixed" ? 1 : 0) + (p.endFixity === "fixed" ? 1 : 0);
  const actions = (f: Record<LoadCase, number>) => {
    const { w, pts } = factored(ld, f);
    let M: number;
    let V: number;
    let defl: number;
    if (fixedEnds === 2) {
      M = (w * Lm * Lm) / 12;
      V = (w * Lm) / 2;
      defl = (w * L ** 4) / (384 * EI);
    } else if (fixedEnds === 1) {
      M = (w * Lm * Lm) / 8;
      V = (5 * w * Lm) / 8;
      defl = (w * L ** 4) / (185 * EI);
    } else {
      M = (w * Lm * Lm) / 8;
      V = (w * Lm) / 2;
      defl = (5 * w * L ** 4) / (384 * EI); // w kN/m = N/mm
    }
    for (const q of pts) {
      const b = Lm - q.a;
      if (fixedEnds === 2) {
        // Fixed-end moments; the larger governs. Deflection under the load.
        M += Math.max(q.P * q.a * b * b, q.P * q.a * q.a * b) / (Lm * Lm);
        V += (q.P * Math.max(b * b * (3 * q.a + b), q.a * q.a * (q.a + 3 * b))) / Lm ** 3;
        defl += (q.P * 1000 * (q.a * 1000) ** 3 * (b * 1000) ** 3) / (3 * EI * L ** 3);
      } else {
        // Simply supported figures (conservative for a propped end, shear taken as the whole load there).
        M += (q.P * q.a * b) / Lm;
        V += fixedEnds === 1 ? q.P : (q.P * Math.max(q.a, b)) / Lm;
        const bb = Math.min(q.a, b) * 1000;
        defl += (q.P * 1000 * bb * (3 * L * L - 4 * bb * bb)) / (48 * EI);
      }
    }
    return { M, V, defl };
  };
  let gov = { name: COMBOS[0]![0], M: 0, V: 0 };
  for (const [name, f] of COMBOS) {
    const a = actions(f);
    if (a.M > gov.M || (a.M === gov.M && a.V > gov.V)) gov = { name, M: a.M, V: a.V };
  }
  const deflection = actions({ G: 1, Q: 0.7, W: 0 }).defl;
  const limit = L / 250;
  const notes: string[] = [];
  let phiM: number | null = null;
  let phiV: number | null = null;
  const Z = I / (s.d / 2);
  if (mat === "steel") {
    phiM = (0.9 * 300 * Z) / 1e6;
    phiV = (0.9 * 0.6 * 300 * Av) / 1e3;
  } else if (mat === "timber") {
    phiM = (0.8 * 0.8 * 14 * Z) / 1e6;
    phiV = (0.8 * 0.8 * 3.8 * ((2 / 3) * s.b * s.d)) / 1e3;
  } else {
    // Concrete: bottom bars of its rebar cages (the lowest longitudinal bars).
    const cages = doc.byCategory<RebarParams>(Cat.Rebar).filter((r) => r.params.hostId === beamId) as Rebar[];
    let As = 0;
    let fy = 500;
    let dEff = 0;
    for (const r of cages) {
      const bars = rebarBars(doc, r).filter((b) => !b.closed);
      if (!bars.length) continue;
      const zs = bars.map((b) => Math.min(b.points[0]![2], b.points[1]![2]));
      const zMin = Math.min(...zs);
      const bottom = bars.filter((_, i) => zs[i]! - zMin < 1);
      const d = barDiameter(r.params.bar as BarSize);
      As += (bottom.length * (Math.PI * d * d)) / 4;
      fy = r.params.bar.startsWith("HD") ? 500 : 300;
      dEff = Math.max(dEff, lv + p.offset - zMin);
    }
    if (As > 0) {
      const a = (As * fy) / (0.85 * 30 * s.b);
      phiM = (0.85 * As * fy * (dEff - a / 2)) / 1e6;
      phiV = (0.75 * 0.17 * Math.sqrt(30) * s.b * dEff) / 1e3;
    } else notes.push("No rebar cage: add one (Properties → Reinforcement) to check bending.");
  }
  const ok = phiM !== null && phiV !== null && gov.M <= phiM && gov.V <= phiV && deflection <= limit;
  if (ld.tributary > 0) notes.push(`Floor area loads over a ${Math.round(ld.tributary)} mm tributary width (floor self-weight not included: add it as a G area load).`);
  const support = fixedEnds === 2 ? "fixed both ends" : fixedEnds === 1 ? "fixed one end, pinned the other" : "simply supported";
  notes.push(`Provisional figures: ${support}, NZS 1170.0 combinations; confirm with an engineer.`);
  return { material: mat, span: L, selfWeight, combination: gov.name, M: gov.M, V: gov.V, phiM, phiV, deflection, limit, ok, notes, tributary: ld.tributary };
}

export interface ColumnCheck {
  material: StructuralMaterial;
  /** Effective length (pinned ends: its height), mm. */
  length: number;
  combination: string;
  /** Design axial load N*, kN. */
  N: number;
  /** Design capacity φNc (with buckling), kN. */
  phiN: number;
  ok: boolean;
  notes: string[];
}

/** Axial check of a column: beams framing into its top (via the analytical model), columns above, self-weight. */
export function columnCheck(doc: Document, columnId: ElementId): ColumnCheck | null {
  const col = doc.get(columnId) as Column | undefined;
  if (!col || col.category !== Cat.Column || !col.typeId) return null;
  const type = doc.get<StructuralSectionParams>(col.typeId);
  if (!type) return null;
  const model = analyticalModel(doc);
  const mat = sectionMaterial(type.name ?? "", type.params);
  const { A } = sectionProperties(type.params);
  const I = weakAxisI(type.params);
  const { bottom, top } = columnExtent(doc, col);
  const length = top - bottom;
  if (length <= 0) return null;
  const load = (id: ElementId, f: Record<LoadCase, number>, depth: number): number => {
    const m = model.members.find((x) => x.id === id && x.kind === "column");
    const c = doc.get(id) as Column | undefined;
    if (!m || !c?.typeId || depth > 20) return 0;
    const t = doc.get<StructuralSectionParams>(c.typeId);
    if (!t) return 0;
    const ext = columnExtent(doc, c);
    let N = (sectionProperties(t.params).A / 1e6) * DENSITY[sectionMaterial(t.name ?? "", t.params)] * ((ext.top - ext.bottom) / 1000) * f.G;
    for (const o of model.members) {
      if (o.kind === "column") {
        if (o.a === m.b && o.id !== id) N += load(o.id, f, depth + 1);
        continue;
      }
      if (o.a !== m.b && o.b !== m.b) continue;
      const r = beamReactions(doc, o.id, f);
      if (r) N += (o.a === m.b ? r.start : 0) + (o.b === m.b ? r.end : 0);
    }
    return N;
  };
  let gov = { name: COMBOS[0]![0], N: -Infinity };
  for (const [name, f] of COMBOS) {
    const N = load(columnId, f, 0);
    if (N > gov.N) gov = { name, N };
  }
  const strength = mat === "steel" ? 300 : mat === "timber" ? 18 : 0.85 * 30;
  const phi = mat === "steel" ? 0.9 : mat === "timber" ? 0.8 : 0.65;
  const Ns = A * strength;
  const Ncr = (Math.PI ** 2 * E[mat] * I) / (length * length);
  const phiN = phi / (1 / Ns + 1 / Ncr) / 1000;
  return {
    material: mat,
    length,
    combination: gov.name,
    N: gov.N,
    phiN,
    ok: gov.N <= phiN,
    notes: ["Provisional: pinned ends, Rankine buckling about the weak axis; confirm with an engineer."],
  };
}
