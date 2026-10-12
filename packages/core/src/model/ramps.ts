import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat, type LevelParams } from "./architecture.ts";
import { landingsBetween, type StairRun } from "./stairs.ts";

// Ramps (Revit: Ramp). Runs drawn as centrelines between a base and top level; the rise is shared
// over the runs in proportion to their length, with landings between. Accessible ramps in NZ
// (NZBC D1/AS1, NZS 4121) are no steeper than 1:12.

export type RampTypeParams = { width: number; thickness: number; /** Steepest allowed, as 1:n. */ maxSlope: number };
export type RampParams = { baseLevelId: ElementId; topLevelId: ElementId; baseOffset: number; topOffset: number; runs: StairRun[] };
export type Ramp = Element<RampParams>;

export const DEFAULT_RAMP_TYPE: RampTypeParams = { width: 1200, thickness: 150, maxSlope: 12 };

registerCategory({ name: Cat.RampType, dependencies: () => [], cascadeDelete: false, isType: true });
registerCategory({
  name: Cat.Ramp,
  dependencies: (el) => {
    const p = el.params as RampParams;
    return [p.baseLevelId, p.topLevelId, ...(el.typeId ? [el.typeId] : [])];
  },
  cascadeDelete: true,
  isType: false,
});

export function ensureRampType(tx: Transaction, doc: Document): ElementId {
  return doc.byCategory(Cat.RampType)[0]?.id ?? tx.create<RampTypeParams>(Cat.RampType, { ...DEFAULT_RAMP_TYPE }, { name: "Ramp - 1200 wide, 1:12 max" }).id;
}

export function createRamp(tx: Transaction, doc: Document, typeId: ElementId, baseLevelId: ElementId, topLevelId: ElementId, runs: StairRun[]): Ramp {
  if (doc.get(typeId)?.category !== Cat.RampType) throw new Error("Ramps need a ramp type");
  if (!runs.length) throw new Error("A ramp needs at least one run");
  for (const r of runs) if (Math.hypot(r.end.x - r.start.x, r.end.y - r.start.y) < 1) throw new Error("Ramp runs need a length");
  return tx.create<RampParams>(Cat.Ramp, { baseLevelId, topLevelId, baseOffset: 0, topOffset: 0, runs: runs.map((r) => ({ start: { ...r.start }, end: { ...r.end } })) }, { typeId }) as Ramp;
}

export interface RampLayout {
  bottom: number;
  top: number;
  height: number;
  width: number;
  thickness: number;
  /** Gradient as 1:n (Infinity when flat). */
  slope: number;
  runs: { start: Vec2; dir: Vec2; length: number; z0: number; z1: number }[];
  landings: { boundary: Vec2[]; z: number }[];
  checks: { label: string; ok: boolean }[];
}

export function rampLayout(doc: Document, ramp: Ramp): RampLayout {
  const t = (ramp.typeId ? doc.get<RampTypeParams>(ramp.typeId)?.params : undefined) ?? DEFAULT_RAMP_TYPE;
  const p = ramp.params;
  const bottom = (doc.get<LevelParams>(p.baseLevelId)?.params.elevation ?? 0) + p.baseOffset;
  const top = (doc.get<LevelParams>(p.topLevelId)?.params.elevation ?? 0) + p.topOffset;
  const height = top - bottom;
  const lens = p.runs.map((r) => Math.hypot(r.end.x - r.start.x, r.end.y - r.start.y));
  const total = lens.reduce((s, l) => s + l, 0);
  let z = bottom;
  const runs = p.runs.map((r, i) => {
    const len = lens[i]!;
    const dir = { x: (r.end.x - r.start.x) / len, y: (r.end.y - r.start.y) / len };
    const rise = total ? (height * len) / total : 0;
    const run = { start: { ...r.start }, dir, length: len, z0: z, z1: z + rise };
    z += rise;
    return run;
  });
  const landings = landingsBetween(
    runs.map((r) => ({ start: r.start, dir: r.dir, length: r.length, zEnd: r.z1 })),
    t.width,
  );
  const slope = height > 0 ? total / height : Infinity;
  return {
    bottom,
    top,
    height,
    width: t.width,
    thickness: t.thickness,
    slope,
    runs,
    landings,
    checks: [{ label: `Gradient 1:${Number.isFinite(slope) ? slope.toFixed(1) : "∞"} no steeper than 1:${t.maxSlope}`, ok: slope >= t.maxSlope - 1e-6 }],
  };
}

/** Run length needed for the ramp's height at the type's steepest gradient. */
export function rampLengthNeeded(doc: Document, ramp: Ramp): number {
  const L = rampLayout(doc, ramp);
  const t = (ramp.typeId ? doc.get<RampTypeParams>(ramp.typeId)?.params : undefined) ?? DEFAULT_RAMP_TYPE;
  return L.height * t.maxSlope;
}
