import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId } from "../element.ts";
import { Cat, type LevelParams } from "./architecture.ts";
import { barDiameter, rebarBars, type BarSize, type Rebar, type RebarParams } from "./rebar.ts";
import type { BeamParams, StructuralSectionParams } from "./structure.ts";

// Structural loads and simple member checks (Revit: Analyze → Loads; checks are ours).
// PROVISIONAL figures, to be confirmed by an engineer (Jeremy: build with our own for now):
// - cases G (permanent), Q (imposed), W (wind, ultimate); self-weight added to G;
// - NZS 1170.0 combinations: ULS 1.35G, 1.2G + 1.5Q, 1.2G + ψc·Q + Wu (ψc 0.4); SLS G + ψs·Q (ψs 0.7);
// - beams simply supported over their length; deflection limit span/250 under SLS;
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
  hostId: ElementId;
  case: LoadCase;
  kind: "line" | "point";
  /** Line: kN/m, downwards, full length. Point: kN, downwards. */
  value: number;
  /** Point loads: distance from the beam's start, mm. */
  at?: number | null;
};
export type StructuralLoad = Element<StructuralLoadParams>;

registerCategory({ name: Cat.StructuralLoad, dependencies: (el) => [(el.params as StructuralLoadParams).hostId], cascadeDelete: true, isType: false });

export function createLoad(tx: Transaction, doc: Document, hostId: ElementId, load: Omit<StructuralLoadParams, "hostId">): StructuralLoad {
  if (doc.get(hostId)?.category !== Cat.Beam) throw new Error("Loads go on beams");
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
}

/** Simply supported check of a beam under its loads (all PROVISIONAL, see the file header). */
export function beamCheck(doc: Document, beamId: ElementId): BeamCheck | null {
  const beam = doc.get<BeamParams>(beamId);
  if (!beam || beam.category !== Cat.Beam || !beam.typeId) return null;
  const type = doc.get<StructuralSectionParams>(beam.typeId);
  if (!type) return null;
  const s = type.params;
  const p = beam.params;
  const lv = doc.get<LevelParams>(p.levelId)?.params.elevation ?? 0;
  const rise = (p.endOffset ?? p.offset) - p.offset;
  const L = Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y, rise);
  if (L < 1) return null;
  const mat = sectionMaterial(type.name ?? "", s);
  const { A, I, Av } = sectionProperties(s);
  const selfWeight = (A / 1e6) * DENSITY[mat];
  const loads = doc.byCategory<StructuralLoadParams>(Cat.StructuralLoad).filter((l) => l.params.hostId === beamId);
  const Lm = L / 1000;

  /** Mid-span-ish moment, end shear and mid-span deflection (mm, for EI in N·mm²) under factors per case. */
  const actions = (f: Record<LoadCase, number>) => {
    let w = selfWeight * f.G; // kN/m
    let M = 0;
    let V = 0;
    let defl = 0; // N, mm: δ in mm
    const EI = E[mat] * I;
    for (const l of loads) {
      const k = f[l.params.case];
      if (!k) continue;
      if (l.params.kind === "line") w += l.params.value * k;
      else {
        const P = l.params.value * k;
        const a = Math.min(Math.max(l.params.at ?? L / 2, 0), L) / 1000;
        const b = Lm - a;
        M += (P * a * b) / Lm;
        V += (P * Math.max(a, b)) / Lm;
        const bb = Math.min(a, b) * 1000;
        defl += (P * 1000 * bb * (3 * L * L - 4 * bb * bb)) / (48 * EI);
      }
    }
    M += (w * Lm * Lm) / 8;
    V += (w * Lm) / 2;
    defl += (5 * w * L ** 4) / (384 * EI); // w kN/m = N/mm
    return { M, V, defl };
  };
  const combos: [string, Record<LoadCase, number>][] = [
    ["1.35G", { G: 1.35, Q: 0, W: 0 }],
    ["1.2G + 1.5Q", { G: 1.2, Q: 1.5, W: 0 }],
    ["1.2G + 0.4Q + Wu", { G: 1.2, Q: 0.4, W: 1 }],
  ];
  let gov = { name: combos[0]![0], M: 0, V: 0 };
  for (const [name, f] of combos) {
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
    // Concrete: bottom bars of its rebar cages (the lower half of the longitudinal bars).
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
      As += bottom.length * (Math.PI * d * d) / 4;
      fy = r.params.bar.startsWith("HD") ? 500 : 300;
      const zTop = lv + p.offset;
      dEff = Math.max(dEff, zTop - zMin);
    }
    if (As > 0) {
      const a = (As * fy) / (0.85 * 30 * s.b);
      phiM = (0.85 * As * fy * (dEff - a / 2)) / 1e6;
      phiV = (0.75 * 0.17 * Math.sqrt(30) * s.b * dEff) / 1e3;
    } else notes.push("No rebar cage: add one (Properties → Reinforcement) to check bending.");
  }
  const ok = phiM !== null && phiV !== null && gov.M <= phiM && gov.V <= phiV && deflection <= limit;
  notes.push("Provisional figures: simply supported, NZS 1170.0 combinations; confirm with an engineer.");
  return { material: mat, span: L, selfWeight, combination: gov.name, M: gov.M, V: gov.V, phiM, phiV, deflection, limit, ok, notes };
}
