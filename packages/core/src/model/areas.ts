import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat, type LevelParams } from "./architecture.ts";
import { DEFAULT_VIEW_RANGE, views, type View, type ViewParams } from "./viewdefs.ts";

// Area plans (Revit: Area Plan per area scheme). An area plan is a plan view of a level for one
// scheme; its Areas and Area Boundary lines belong to it (like annotations), and each area is the
// region of boundary lines around its point. Schemes follow NZ practice (PCNZ / NZIQS):
// GFA measured to the outside face of external walls, NLA to their inside face.

export type AreaScheme = "gross" | "rentable";
export const AREA_SCHEMES: Record<AreaScheme, { label: string; short: string }> = {
  gross: { label: "Gross Floor Area", short: "GFA" },
  rentable: { label: "Net Lettable Area", short: "NLA" },
};

export type AreaParams = { viewId: ElementId; point: Vec2; number: string };
export type Area = Element<AreaParams>;
export type AreaBoundaryParams = { viewId: ElementId; start: Vec2; end: Vec2 };
export type AreaBoundary = Element<AreaBoundaryParams>;

registerCategory({
  name: Cat.Area,
  dependencies: (el) => [(el.params as AreaParams).viewId],
  cascadeDelete: true,
  isType: false,
});
registerCategory({
  name: Cat.AreaBoundary,
  dependencies: (el) => [(el.params as AreaBoundaryParams).viewId],
  // Areas in the same plan re-find their boundaries.
  related: (doc, el) => areasIn(doc, (el.params as AreaBoundaryParams).viewId).map((a) => a.id),
  cascadeDelete: true,
  isType: false,
});

export function areasIn(doc: Document, viewId: ElementId): Area[] {
  return (doc.byCategory<AreaParams>(Cat.Area) as Area[]).filter((a) => a.params.viewId === viewId);
}

export function areaBoundariesIn(doc: Document, viewId: ElementId): AreaBoundary[] {
  return (doc.byCategory<AreaBoundaryParams>(Cat.AreaBoundary) as AreaBoundary[]).filter((b) => b.params.viewId === viewId);
}

export function areaPlans(doc: Document, scheme?: AreaScheme): View[] {
  return views(doc).filter((v) => v.params.kind === "areaPlan" && (!scheme || v.params.areaScheme === scheme));
}

export function createAreaPlan(tx: Transaction, doc: Document, levelId: ElementId, scheme: AreaScheme, opts: { name?: string } = {}): View {
  const level = doc.require<LevelParams>(levelId);
  if (level.category !== Cat.Level) throw new Error("Area plans belong to a level");
  const base = `${level.name ?? "Level"} ${AREA_SCHEMES[scheme].short}`;
  const taken = (n: string) => areaPlans(doc).some((v) => v.name === n);
  let name = opts.name ?? base;
  for (let i = 2; !opts.name && taken(name); i++) name = `${base} (${i})`;
  if (taken(name)) throw new Error(`An area plan called "${name}" already exists`);
  return tx.create<ViewParams>(
    Cat.View,
    { kind: "areaPlan", areaScheme: scheme, levelId, range: DEFAULT_VIEW_RANGE, scale: 100, detailLevel: "coarse", hiddenCategories: [] },
    { name },
  ) as View;
}

function requireAreaPlan(doc: Document, viewId: ElementId): View {
  const v = doc.get<ViewParams>(viewId);
  if (!v || v.category !== Cat.View || v.params.kind !== "areaPlan") throw new Error("Areas go in area plans");
  return v as View;
}

export function createArea(tx: Transaction, doc: Document, viewId: ElementId, point: Vec2, opts: { name?: string; number?: string } = {}): Area {
  requireAreaPlan(doc, viewId);
  const used = areasIn(doc, viewId).map((a) => Number(a.params.number)).filter(Number.isFinite);
  const number = opts.number ?? String(used.length ? Math.max(...used) + 1 : 1);
  return tx.create<AreaParams>(Cat.Area, { viewId, point: { ...point }, number }, { name: opts.name ?? "Area" }) as Area;
}

export function createAreaBoundary(tx: Transaction, doc: Document, viewId: ElementId, start: Vec2, end: Vec2): AreaBoundary {
  requireAreaPlan(doc, viewId);
  if (Math.hypot(end.x - start.x, end.y - start.y) < 1) throw new Error("Area boundary must have non-zero length");
  return tx.create<AreaBoundaryParams>(Cat.AreaBoundary, { viewId, start: { ...start }, end: { ...end } }) as AreaBoundary;
}
