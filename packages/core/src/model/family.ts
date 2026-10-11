import { registerCategory } from "../categories.ts";
import { Document, type DocumentJSON, type Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import type { DimensionParams } from "./annotations.ts";
import type { ReferencePlaneParams } from "./datums.ts";
import { evaluate, evaluateParameters, type Num, type Values } from "../expr.ts";
import { Cat, createLevel } from "./architecture.ts";
import { createReferencePlane } from "./datums.ts";
import { createProjectSettings } from "./settings.ts";
import { create3DView, createElevation, createFloorPlan } from "./viewdefs.ts";

// Family documents (Revit family editor): a separate Document holding the family's reference
// planes, parameters, types and forms. Forms are defined in family coordinates (origin at the
// insertion point, X right, Y back, Z up) with formulas over the family parameters.

export type FamilyCategory = "GenericModel" | "Furniture" | "Casework" | "Door" | "Window";
export type FamilyHosting = "none" | "wall";

export type FamilyTypeValues = { name: string; values: Values };

export type FamilyInfoParams = {
  category: FamilyCategory;
  hosting: FamilyHosting;
  types: FamilyTypeValues[];
  /** Type whose values drive the geometry shown in the editor. */
  currentType: string;
};
export type FamilyInfo = Element<FamilyInfoParams>;

export type ParameterKind = "length" | "angle" | "number" | "boolean";

export type FamilyParameterParams = {
  kind: ParameterKind;
  /** Instance parameters vary per placed instance; type parameters per family type. */
  instance: boolean;
  /** Formula over other parameters; null for a typed-in value. */
  formula: string | null;
};
export type FamilyParameter = Element<FamilyParameterParams>;

/** Point whose coordinates may be formulas. */
export type NumPt = { x: Num; y: Num };

/** Sketch plane: XY at height `offset` (plan), XZ at y = offset (front), YZ at x = offset (side). */
export type WorkPlane = { kind: "XY" | "XZ" | "YZ"; offset: Num };

type FormBase = { isVoid: boolean; plane: WorkPlane };

export type ExtrusionParams = FormBase & { profile: NumPt[]; holes: NumPt[][]; start: Num; end: Num };
/** Blend between a bottom and a top profile, `start` to `end` along the plane normal. */
export type BlendParams = FormBase & { bottom: NumPt[]; top: NumPt[]; start: Num; end: Num };
/** Profile in the plane revolved about a line parallel to the plane's v axis at u = `axis`. */
export type RevolutionParams = FormBase & { profile: NumPt[]; axis: Num; startAngle: Num; endAngle: Num };
/** Profile (u across, v up) swept along a path in the plane. */
export type SweepParams = FormBase & { path: NumPt[]; profile: NumPt[] };

export const FORM_CATEGORIES = [Cat.Extrusion, Cat.Blend, Cat.Revolution, Cat.Sweep] as const;

for (const name of FORM_CATEGORIES) {
  registerCategory({ name, dependencies: () => [], cascadeDelete: false, isType: false });
}
// Forms read parameters through formulas, so a parameter or type change regenerates every form.
const allForms = (doc: Document) => doc.all().filter((e) => isFormCategory(e.category)).map((e) => e.id);
for (const name of [Cat.FamilyInfo, Cat.FamilyParameter]) {
  registerCategory({ name, dependencies: () => [], related: (doc) => allForms(doc), cascadeDelete: false, isType: false });
}

export function isFormCategory(category: string): boolean {
  return (FORM_CATEGORIES as readonly string[]).includes(category);
}

export function familyInfo(doc: Document): FamilyInfo | undefined {
  return doc.byCategory<FamilyInfoParams>(Cat.FamilyInfo)[0];
}

/** The family's name (stored on its FamilyInfo element). */
export function familyName(doc: Document): string {
  return familyInfo(doc)?.name ?? "Family";
}

export function familyParameters(doc: Document): FamilyParameter[] {
  return doc.byCategory<FamilyParameterParams>(Cat.FamilyParameter);
}

/** Evaluated parameter values for a type (default: the current type), with optional overrides. */
export function familyParamValues(doc: Document, typeName?: string, overrides: Values = {}): Values {
  const info = familyInfo(doc);
  const type = info?.params.types.find((t) => t.name === (typeName ?? info.params.currentType)) ?? info?.params.types[0];
  const defs = familyParameters(doc).map((p) => ({ name: p.name ?? "", formula: p.params.formula }));
  return evaluateParameters(defs, { ...(type?.values ?? {}), ...overrides });
}

/**
 * Everything a form formula can use: parameter values, plus each named reference plane's position
 * (x for vertical planes, y for horizontal ones) after solving the family's constraints for these
 * values. Parameters win over planes of the same name.
 */
export function familyValues(doc: Document, typeName?: string, overrides: Values = {}): Values {
  const params = familyParamValues(doc, typeName, overrides);
  const planes: Values = {};
  for (const [id, line] of solvedPlanes(doc, params)) {
    const name = doc.get(id)?.name;
    if (name && !(name in params)) planes[name] = planeVariable(line.start, line.end);
  }
  return { ...planes, ...params };
}

// ---- constraints (reference planes driven by labelled dimensions) ---------------------------

export type PlaneLine = { start: Vec2; end: Vec2 };

/** Constraint problem for a family's reference planes. */
export interface PlaneSystem {
  planes: { id: ElementId; start: Vec2; end: Vec2; fixed: boolean }[];
  /** Distance between two parallel planes. */
  distances: { a: ElementId; b: ElementId; value: number }[];
  /** Equal spacing a|b|c (b in the middle). */
  equal: [ElementId, ElementId, ElementId][];
}

/** Solves a plane system; returns every plane's new line. Throws if it can't be satisfied. */
export type FamilySolver = (system: PlaneSystem) => Map<ElementId, PlaneLine>;

let solver: FamilySolver | null = null;

/** Install the constraint solver (the app and tests register PlaneGCS from the geometry package). */
export function setFamilySolver(s: FamilySolver | null): void {
  solver = s;
}

/** Position of a plane as a single number: x for vertical, y for horizontal, else its normal offset. */
export function planeVariable(start: Vec2, end: Vec2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < 1e-9) return start.x;
  if (Math.abs(dy) < 1e-9) return start.y;
  const l = Math.hypot(dx, dy);
  let n = { x: -dy / l, y: dx / l };
  if (n.x < 0 || (n.x === 0 && n.y < 0)) n = { x: -n.x, y: -n.y };
  return start.x * n.x + start.y * n.y;
}

/** The constraint system implied by labelled and EQ dimensions between reference planes. */
export function planeSystem(doc: Document, params: Values): PlaneSystem {
  const planes = doc.byCategory<ReferencePlaneParams>(Cat.ReferencePlane).map((r) => ({
    id: r.id,
    start: r.params.start,
    end: r.params.end,
    fixed: !!r.params.fixed,
  }));
  const isPlane = new Set(planes.map((p) => p.id));
  const sys: PlaneSystem = { planes, distances: [], equal: [] };
  for (const d of doc.byCategory<DimensionParams>(Cat.Dimension)) {
    const ids = d.params.refs.flatMap((r) => (r.kind === "datum" && isPlane.has(r.id) ? [r.id] : []));
    if (ids.length !== d.params.refs.length) continue; // only plane-to-plane dimensions constrain
    const label = d.params.label;
    if (label && ids.length === 2) {
      const v = params[label];
      if (v === undefined) throw new Error(`Dimension label "${label}" isn't a parameter`);
      sys.distances.push({ a: ids[0]!, b: ids[1]!, value: Math.abs(v) });
    }
    if (d.params.equality && ids.length >= 3) {
      for (let i = 0; i + 2 < ids.length; i++) sys.equal.push([ids[i]!, ids[i + 1]!, ids[i + 2]!]);
    }
  }
  return sys;
}

/** Reference plane lines for given parameter values (stored positions when nothing constrains them). */
export function solvedPlanes(doc: Document, params: Values): Map<ElementId, PlaneLine> {
  const sys = planeSystem(doc, params);
  const stored = new Map(sys.planes.map((p) => [p.id, { start: p.start, end: p.end }]));
  if (!solver || (!sys.distances.length && !sys.equal.length)) return stored;
  return solver(sys);
}

/** Move reference planes to satisfy the constraints for the current type ("flex"). */
export function flexFamily(tx: Transaction, doc: Document): void {
  if (!solver || !familyInfo(doc)) return;
  const solved = solvedPlanes(doc, familyParamValues(doc));
  for (const [id, line] of solved) {
    const r = doc.get<ReferencePlaneParams>(id);
    if (!r) continue;
    const moved = [r.params.start.x - line.start.x, r.params.start.y - line.start.y, r.params.end.x - line.end.x, r.params.end.y - line.end.y];
    if (moved.some((m) => Math.abs(m) > 1e-6)) tx.update<ReferencePlaneParams>(id, { start: line.start, end: line.end });
  }
}

/** Keep a family document's reference planes flexed to its constraints after every edit. */
export function enableFamilyFlex(doc: Document): () => void {
  return doc.addCommitHook((tx) => flexFamily(tx, doc));
}

export function createFamilyParameter(
  tx: Transaction,
  doc: Document,
  name: string,
  opts: { kind?: ParameterKind; instance?: boolean; formula?: string | null; value?: number } = {},
): FamilyParameter {
  if (!/^[A-Za-z][A-Za-z0-9_ ]*$/.test(name.trim())) throw new Error("Parameter names start with a letter and use letters, digits, spaces or _");
  if (familyParameters(doc).some((p) => p.name === name)) throw new Error(`Parameter "${name}" already exists`);
  const p = tx.create<FamilyParameterParams>(
    Cat.FamilyParameter,
    { kind: opts.kind ?? "length", instance: opts.instance ?? false, formula: opts.formula ?? null },
    { name },
  );
  const info = familyInfo(doc);
  if (info && opts.value !== undefined) {
    tx.update<FamilyInfoParams>(info.id, {
      types: info.params.types.map((t) => ({ ...t, values: { ...t.values, [name]: opts.value! } })),
    });
  }
  return p;
}

/** Add a family type, copying the current type's values. */
export function createFamilyType(tx: Transaction, doc: Document, name: string): void {
  const info = familyInfo(doc);
  if (!info) throw new Error("Not a family document");
  if (!name.trim()) throw new Error("Types need a name");
  if (info.params.types.some((t) => t.name === name)) throw new Error(`Type "${name}" already exists`);
  const current = info.params.types.find((t) => t.name === info.params.currentType) ?? info.params.types[0];
  tx.update<FamilyInfoParams>(info.id, { types: [...info.params.types, { name, values: { ...(current?.values ?? {}) } }], currentType: name });
}

/** Set a type parameter's value in the current type. */
export function setFamilyValue(tx: Transaction, doc: Document, name: string, value: number): void {
  const info = familyInfo(doc);
  if (!info) throw new Error("Not a family document");
  tx.update<FamilyInfoParams>(info.id, {
    types: info.params.types.map((t) => (t.name === info.params.currentType ? { ...t, values: { ...t.values, [name]: value } } : t)),
  });
}

/** Evaluate a form field against the family's current values; errors name the field. */
export function evalField(f: Num, values: Values, what: string): number {
  try {
    return evaluate(f, values);
  } catch (err) {
    throw new Error(`${what}: ${(err as Error).message}`);
  }
}

export const evalPts = (pts: NumPt[], values: Values, what: string) =>
  pts.map((p, i) => ({ x: evalField(p.x, values, `${what} point ${i + 1} x`), y: evalField(p.y, values, `${what} point ${i + 1} y`) }));

/** Starter parameters per family category. */
const STARTER: Record<FamilyCategory, [string, number][]> = {
  GenericModel: [],
  Furniture: [
    ["Width", 1200],
    ["Depth", 600],
    ["Height", 750],
  ],
  Casework: [
    ["Width", 600],
    ["Depth", 580],
    ["Height", 870],
  ],
  Door: [
    ["Width", 860],
    ["Height", 1980],
  ],
  Window: [
    ["Width", 1200],
    ["Height", 1200],
  ],
};

/** New family document: reference level, views, centre reference planes, starter parameters. */
export function applyFamilyTemplate(doc: Document, category: FamilyCategory = "GenericModel", name = "Family 1"): { levelId: ElementId } {
  return doc.transact(`New ${category} family`, (tx) => {
    createProjectSettings(tx, doc);
    const level = createLevel(tx, "Ref. Level", 0);
    createFloorPlan(tx, doc, level.id, { name: "Ref. Level" });
    createElevation(tx, doc, { x: -3000, y: -3000 }, { x: 3000, y: -3000 }, { name: "Front", farClip: 8000, zRange: { bottom: -500, top: 3000 } });
    createElevation(tx, doc, { x: 3000, y: -3000 }, { x: 3000, y: 3000 }, { name: "Right", farClip: 8000, zRange: { bottom: -500, top: 3000 } });
    create3DView(tx, doc, "{3D}");
    for (const rp of [
      createReferencePlane(tx, doc, { x: 0, y: -2500 }, { x: 0, y: 2500 }, "Center (Left/Right)"),
      createReferencePlane(tx, doc, { x: -2500, y: 0 }, { x: 2500, y: 0 }, "Center (Front/Back)"),
    ]) {
      // The centre planes define the origin and stay put (Revit pins them).
      tx.update<ReferencePlaneParams>(rp.id, { fixed: true });
    }
    tx.create<FamilyInfoParams>(Cat.FamilyInfo, {
      category,
      hosting: category === "Door" || category === "Window" ? "wall" : "none",
      types: [{ name: "Default", values: Object.fromEntries(STARTER[category]) }],
      currentType: "Default",
    }, { name });
    for (const [param] of STARTER[category]) {
      tx.create<FamilyParameterParams>(Cat.FamilyParameter, { kind: "length", instance: false, formula: null }, { name: param });
    }
    return { levelId: level.id };
  });
}

const base = (plane?: WorkPlane, isVoid = false): FormBase => ({ plane: plane ?? { kind: "XY", offset: 0 }, isVoid });

export function createExtrusion(
  tx: Transaction,
  profile: NumPt[],
  opts: { holes?: NumPt[][]; start?: Num; end?: Num; plane?: WorkPlane; isVoid?: boolean } = {},
): Element<ExtrusionParams> {
  if (profile.length < 3) throw new Error("Extrusion profile needs at least 3 points");
  return tx.create<ExtrusionParams>(Cat.Extrusion, { ...base(opts.plane, opts.isVoid), profile, holes: opts.holes ?? [], start: opts.start ?? 0, end: opts.end ?? 1000 });
}

export function createBlend(
  tx: Transaction,
  bottom: NumPt[],
  top: NumPt[],
  opts: { start?: Num; end?: Num; plane?: WorkPlane; isVoid?: boolean } = {},
): Element<BlendParams> {
  if (bottom.length < 3 || top.length < 3) throw new Error("Blend profiles need at least 3 points each");
  return tx.create<BlendParams>(Cat.Blend, { ...base(opts.plane, opts.isVoid), bottom, top, start: opts.start ?? 0, end: opts.end ?? 1000 });
}

export function createRevolution(
  tx: Transaction,
  profile: NumPt[],
  opts: { axis?: Num; startAngle?: Num; endAngle?: Num; plane?: WorkPlane; isVoid?: boolean } = {},
): Element<RevolutionParams> {
  if (profile.length < 3) throw new Error("Revolution profile needs at least 3 points");
  return tx.create<RevolutionParams>(Cat.Revolution, {
    ...base(opts.plane ?? { kind: "XZ", offset: 0 }, opts.isVoid),
    profile,
    axis: opts.axis ?? 0,
    startAngle: opts.startAngle ?? 0,
    endAngle: opts.endAngle ?? 360,
  });
}

export function createSweep(
  tx: Transaction,
  path: NumPt[],
  profile: NumPt[],
  opts: { plane?: WorkPlane; isVoid?: boolean } = {},
): Element<SweepParams> {
  if (path.length < 2) throw new Error("Sweep path needs at least 2 points");
  if (profile.length < 3) throw new Error("Sweep profile needs at least 3 points");
  return tx.create<SweepParams>(Cat.Sweep, { ...base(opts.plane, opts.isVoid), path, profile });
}

// ---- family files (.obim-family) ----------------------------------------------------------

/** Open family file: plain JSON around the family document, readable and diffable without the app. */
export interface FamilyFile {
  format: "open-bim-family";
  version: 1;
  name: string;
  category: FamilyCategory;
  document: DocumentJSON;
}

export function familyFile(doc: Document): FamilyFile {
  const info = familyInfo(doc);
  if (!info) throw new Error("Not a family document");
  return { format: "open-bim-family", version: 1, name: info.name ?? "Family", category: info.params.category, document: doc.toJSON() };
}

/** Read a family file into a family document (validated). */
export function readFamilyFile(json: unknown): Document {
  const f = json as Partial<FamilyFile> | null;
  if (!f || f.format !== "open-bim-family") throw new Error("Not an Open-BIM family file");
  if (f.version !== 1) throw new Error(`Unsupported family file version: ${String(f.version)}`);
  if (!f.document) throw new Error("Family file has no document");
  const doc = Document.fromJSON(f.document);
  if (!familyInfo(doc)) throw new Error("Family file has no family information");
  return doc;
}
