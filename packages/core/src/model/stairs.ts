import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat, type LevelParams } from "./architecture.ts";

// Stairs (Revit: Stair by component). A stair joins a base and a top level with runs drawn as
// centrelines; the riser count comes from the height and the type's maximum riser, each run takes
// the risers its length allows at the type's going (the last run takes the rest), and landings
// fill between runs. Checks follow NZBC D1/AS1 for private stairways.

export type StairTypeParams = {
  /** Maximum riser height, mm (D1/AS1 private stairway: 190). */
  maxRiser: number;
  /** Tread going, mm (D1/AS1 private stairway: at least 280). */
  going: number;
  width: number;
  /** Structural waist below the nosing line, mm. */
  waist: number;
  landingThickness: number;
};

export type StairRun = { start: Vec2; end: Vec2 };

export type StairParams = {
  baseLevelId: ElementId;
  topLevelId: ElementId;
  baseOffset: number;
  topOffset: number;
  runs: StairRun[];
};
export type Stair = Element<StairParams>;

registerCategory({ name: Cat.StairType, dependencies: () => [], cascadeDelete: false, isType: true });
registerCategory({
  name: Cat.Stair,
  dependencies: (el) => {
    const p = el.params as StairParams;
    return [p.baseLevelId, p.topLevelId, ...(el.typeId ? [el.typeId] : [])];
  },
  cascadeDelete: true,
  isType: false,
});

export const DEFAULT_STAIR_TYPE: StairTypeParams = { maxRiser: 190, going: 280, width: 900, waist: 150, landingThickness: 200 };

export function createStairType(tx: Transaction, name: string, p: Partial<StairTypeParams> = {}): Element<StairTypeParams> {
  return tx.create<StairTypeParams>(Cat.StairType, { ...DEFAULT_STAIR_TYPE, ...p }, { name });
}

/** The first stair type, creating the default one if the project has none. */
export function ensureStairType(tx: Transaction, doc: Document): ElementId {
  return doc.byCategory(Cat.StairType)[0]?.id ?? createStairType(tx, "Stair - Concrete 190 max riser 280 going").id;
}

export function createStair(tx: Transaction, doc: Document, typeId: ElementId, baseLevelId: ElementId, topLevelId: ElementId, runs: StairRun[]): Stair {
  if (doc.get(typeId)?.category !== Cat.StairType) throw new Error("Stairs need a stair type");
  if (!runs.length) throw new Error("A stair needs at least one run");
  for (const r of runs) if (Math.hypot(r.end.x - r.start.x, r.end.y - r.start.y) < 1) throw new Error("Stair runs need a length");
  const s = tx.create<StairParams>(Cat.Stair, { baseLevelId, topLevelId, baseOffset: 0, topOffset: 0, runs: runs.map((r) => ({ start: { ...r.start }, end: { ...r.end } })) }, { typeId }) as Stair;
  const layout = stairLayout(doc, s);
  if (layout.height <= 0) throw new Error("The top level must be above the base level");
  return s;
}

export interface RunLayout {
  start: Vec2;
  /** Unit direction of travel (up). */
  dir: Vec2;
  /** Treads in this run (risers - 1), and the run's length = treads × going. */
  treads: number;
  risers: number;
  /** Height at the run's start. */
  z0: number;
  length: number;
}

export interface StairLayout {
  bottom: number;
  top: number;
  height: number;
  risers: number;
  riser: number;
  going: number;
  width: number;
  runs: RunLayout[];
  landings: { boundary: Vec2[]; z: number }[];
  /** NZBC D1/AS1 private stairway checks. */
  checks: { label: string; ok: boolean }[];
}

export function stairLayout(doc: Document, stair: Stair): StairLayout {
  const t = (stair.typeId ? doc.get<StairTypeParams>(stair.typeId)?.params : undefined) ?? DEFAULT_STAIR_TYPE;
  const p = stair.params;
  const bottom = (doc.get<LevelParams>(p.baseLevelId)?.params.elevation ?? 0) + p.baseOffset;
  const top = (doc.get<LevelParams>(p.topLevelId)?.params.elevation ?? 0) + p.topOffset;
  const height = top - bottom;
  const risers = Math.max(1, Math.ceil(height / t.maxRiser - 1e-9));
  const riser = height / risers;
  const going = t.going;

  // Risers per run from its drawn length; the last run takes what's left (at least one).
  const counts: number[] = [];
  let left = risers;
  p.runs.forEach((r, i) => {
    const len = Math.hypot(r.end.x - r.start.x, r.end.y - r.start.y);
    const runsAfter = p.runs.length - 1 - i;
    const want = i === p.runs.length - 1 ? left : Math.max(1, Math.round(len / going) + 1);
    const n = Math.max(1, Math.min(want, left - runsAfter));
    counts.push(n);
    left -= n;
  });
  const runs: RunLayout[] = [];
  let z = bottom;
  p.runs.forEach((r, i) => {
    const len = Math.hypot(r.end.x - r.start.x, r.end.y - r.start.y) || 1;
    const dir = { x: (r.end.x - r.start.x) / len, y: (r.end.y - r.start.y) / len };
    const n = counts[i]!;
    runs.push({ start: { ...r.start }, dir, treads: n - 1, risers: n, z0: z, length: (n - 1) * going });
    z += n * riser;
  });

  // Landings between runs, in the frame of the run arriving at them.
  const landings: StairLayout["landings"] = [];
  const hw = t.width / 2;
  for (let i = 0; i + 1 < runs.length; i++) {
    const a = runs[i]!;
    const b = runs[i + 1]!;
    const nrm = { x: -a.dir.y, y: a.dir.x };
    const end = { x: a.start.x + a.dir.x * a.length, y: a.start.y + a.dir.y * a.length };
    const bn = { x: -b.dir.y, y: b.dir.x };
    const edge = [
      { x: end.x + nrm.x * hw, y: end.y + nrm.y * hw },
      { x: end.x - nrm.x * hw, y: end.y - nrm.y * hw },
      { x: b.start.x + bn.x * hw, y: b.start.y + bn.y * hw },
      { x: b.start.x - bn.x * hw, y: b.start.y - bn.y * hw },
    ];
    const local = edge.map((q) => ({ u: (q.x - end.x) * a.dir.x + (q.y - end.y) * a.dir.y, v: (q.x - end.x) * nrm.x + (q.y - end.y) * nrm.y }));
    const collinear = Math.abs(a.dir.x * b.dir.x + a.dir.y * b.dir.y) > 0.999 && a.dir.x * b.dir.x + a.dir.y * b.dir.y > 0;
    const u1 = Math.max(collinear ? 0 : t.width, ...local.map((q) => q.u));
    const v0 = Math.min(...local.map((q) => q.v));
    const v1 = Math.max(...local.map((q) => q.v));
    if (u1 <= 1) continue;
    const at = (u: number, v: number) => ({ x: end.x + a.dir.x * u + nrm.x * v, y: end.y + a.dir.y * u + nrm.y * v });
    landings.push({ boundary: [at(0, v0), at(u1, v0), at(u1, v1), at(0, v1)], z: a.z0 + a.risers * riser });
  }

  const twoRG = 2 * riser + going;
  const checks = [
    { label: `Riser ${riser.toFixed(0)} mm ≤ 190`, ok: riser <= 190 + 1e-6 },
    { label: `Going ${going.toFixed(0)} mm ≥ 280`, ok: going >= 280 - 1e-6 },
    { label: `2R + G ${twoRG.toFixed(0)} mm in 550–700`, ok: twoRG >= 550 && twoRG <= 700 },
  ];
  return { bottom, top, height, risers, riser, going, width: t.width, runs, landings, checks };
}
