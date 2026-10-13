import { registerCategory } from "../categories.ts";
import { optionVisible } from "./options.ts";
import { PHASED, phaseGraphics, phaseStatus, viewPhase, type PhaseFilter } from "./phases.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, ParamValue } from "../element.ts";
import { Cat } from "./architecture.ts";
import type { DetailLevel, ViewParams } from "./viewdefs.ts";
import { customValue } from "./parameters.ts";

// Visibility/Graphics: per-view category visibility and overrides, rule-based filters, and view
// templates that several views share (Revit V/G, Filters, View Templates).

/** Line patterns for overridden lines. */
export type LinePattern = "solid" | "dash" | "dot" | "dashDot" | "longDash";
export const LINE_PATTERNS: LinePattern[] = ["solid", "dash", "dot", "dashDot", "longDash"];

/** Line override (Revit: Projection/Cut Lines). Weight is Revit's 1-16 pen number. */
export type LineOverride = { color?: number | null; weight?: number | null; pattern?: LinePattern | null };
/** One layer of a fill (Revit: Foreground/Background pattern): pattern name ("solid" or a hatch). */
export type FillOverride = { visible?: boolean; color?: number | null; pattern?: string | null };
export type PatternOverride = { foreground?: FillOverride; background?: FillOverride };

/**
 * Graphic override for an element, category or filter in a view (Revit: Override Graphics in View).
 * Unset fields don't override. `color` is the older single line colour (projection and cut).
 */
export type GraphicOverride = {
  visible?: boolean;
  halftone?: boolean;
  /** 0 (opaque) to 100 (invisible). */
  transparency?: number;
  color?: number;
  projectionLines?: LineOverride;
  surfacePatterns?: PatternOverride;
  cutLines?: LineOverride;
  cutPatterns?: PatternOverride;
};

export type FilterOp = "equals" | "notEquals" | "contains" | "notContains" | "greater" | "less";

/**
 * A filter rule tests one property: "name", "type" (type name), "category", or any element
 * parameter by key (numbers, strings, booleans; level ids compare by level name too).
 */
export type FilterRule = { field: string; op: FilterOp; value: string };

export type ViewFilterParams = {
  /** Categories the filter applies to; empty = all. */
  categories: string[];
  /** All rules must match (AND). */
  rules: FilterRule[];
};
export type ViewFilter = Element<ViewFilterParams>;

/** Filter applied in a view, with its override. Earlier entries win (Revit's filter priority). */
export type AppliedFilter = { filterId: ElementId; override: GraphicOverride };

/** The graphic settings a view (or view template) carries. */
export type ViewGraphicsParams = {
  scale: number;
  detailLevel: DetailLevel;
  hiddenCategories: string[];
  categoryOverrides?: Record<string, GraphicOverride> | null;
  filters?: AppliedFilter[] | null;
  /** Per-element overrides (Revit: Override Graphics in View, By Element); from the view, never a template. */
  elementOverrides?: Record<ElementId, GraphicOverride> | null;
  /** Phase filter (templates can set it); see phases.ts. */
  phaseFilter?: PhaseFilter | null;
  /** The view's phase (from the view, never the template). */
  phase?: string | null;
  /** Design option shown per option set (from the view; default each set's primary). */
  designOptions?: Record<string, string> | null;
};

export type ViewTemplateParams = ViewGraphicsParams & {
  /** Which views it's meant for (informational, like Revit's template view type). */
  forKind: "floorPlan" | "section" | "elevation" | "3d" | "any";
};
export type ViewTemplate = Element<ViewTemplateParams>;

registerCategory({ name: Cat.ViewFilter, dependencies: () => [], cascadeDelete: false, isType: false });
registerCategory({
  name: Cat.ViewTemplate,
  // Templates reference their filters: filter edits update every view using the template.
  dependencies: (el) => ((el.params as ViewTemplateParams).filters ?? []).map((f) => f.filterId),
  cascadeDelete: false,
  isType: false,
});

export function createViewFilter(tx: Transaction, doc: Document, name: string, params: Partial<ViewFilterParams> = {}): ViewFilter {
  if (!name.trim()) throw new Error("Filters need a name");
  if (doc.byCategory(Cat.ViewFilter).some((f) => f.name === name)) throw new Error(`A filter called "${name}" already exists`);
  return tx.create<ViewFilterParams>(Cat.ViewFilter, { categories: params.categories ?? [], rules: params.rules ?? [] }, { name });
}

/** New template from a view's current graphics (Revit "Create Template from Current View"). */
export function createViewTemplate(tx: Transaction, doc: Document, name: string, from: Element<ViewParams>): ViewTemplate {
  if (!name.trim()) throw new Error("View templates need a name");
  if (doc.byCategory(Cat.ViewTemplate).some((t) => t.name === name)) throw new Error(`A view template called "${name}" already exists`);
  const p = from.params;
  return tx.create<ViewTemplateParams>(
    Cat.ViewTemplate,
    {
      forKind: p.kind === "callout" || p.kind === "areaPlan" ? "floorPlan" : p.kind === "legend" ? "any" : p.kind,
      scale: p.scale,
      detailLevel: p.detailLevel,
      hiddenCategories: [...p.hiddenCategories],
      categoryOverrides: p.categoryOverrides ?? null,
      filters: p.filters ?? null,
    },
    { name },
  );
}

/** A view's graphics after applying its template (the template controls everything it defines). */
export function effectiveGraphics(doc: Document, view: Element<ViewParams>): ViewGraphicsParams {
  const tid = view.params.templateId;
  const t = tid ? doc.get<ViewTemplateParams>(tid) : undefined;
  const src: ViewGraphicsParams = t && t.category === Cat.ViewTemplate ? t.params : view.params;
  return {
    scale: src.scale,
    detailLevel: src.detailLevel,
    hiddenCategories: src.hiddenCategories,
    categoryOverrides: src.categoryOverrides ?? null,
    filters: src.filters ?? null,
    elementOverrides: view.params.elementOverrides ?? null,
    phaseFilter: src.phaseFilter ?? view.params.phaseFilter ?? "all",
    phase: view.params.phase ?? null,
    designOptions: view.params.designOptions ?? null,
  };
}

// ---- rule evaluation ------------------------------------------------------------

/** The value of a filter field for an element, as a string or number. */
function fieldValue(doc: Document, el: Element, field: string): string | number | undefined {
  if (field === "name") return el.name ?? "";
  if (field === "category") return el.category;
  if (field === "type") return el.typeId ? (doc.get(el.typeId)?.name ?? "") : "";
  const v: ParamValue | undefined = (el.params as Record<string, ParamValue>)[field] ?? customValue(doc, el, field);
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    // References (levels, hosts…) also match by the referenced element's name.
    const ref = doc.get(v);
    return ref?.name ?? v;
  }
  if (typeof v === "boolean") return String(v);
  return undefined;
}

export function ruleMatches(doc: Document, el: Element, rule: FilterRule): boolean {
  const actual = fieldValue(doc, el, rule.field);
  if (actual === undefined) return rule.op === "notEquals" || rule.op === "notContains";
  const a = String(actual).toLowerCase();
  const b = rule.value.toLowerCase();
  switch (rule.op) {
    case "equals":
      return typeof actual === "number" ? actual === Number(rule.value) : a === b;
    case "notEquals":
      return typeof actual === "number" ? actual !== Number(rule.value) : a !== b;
    case "contains":
      return a.includes(b);
    case "notContains":
      return !a.includes(b);
    case "greater":
      return Number(actual) > Number(rule.value);
    case "less":
      return Number(actual) < Number(rule.value);
  }
}

export function filterMatches(doc: Document, filter: ViewFilter, el: Element): boolean {
  const { categories, rules } = filter.params;
  if (categories.length && !categories.includes(el.category)) return false;
  return rules.every((r) => ruleMatches(doc, el, r));
}

export interface ResolvedLine {
  color: number | null;
  weight: number | null;
  pattern: LinePattern | null;
}
export interface ResolvedFill {
  visible: boolean;
  color: number | null;
  pattern: string | null;
}

/** Resolved display of an element in a view. */
export interface ResolvedGraphics {
  visible: boolean;
  halftone: boolean;
  /** Line colour for anything that doesn't distinguish projection from cut. */
  color: number | null;
  /** 0-100. */
  transparency: number;
  projection: ResolvedLine;
  cut: ResolvedLine;
  surface: { foreground: ResolvedFill; background: ResolvedFill };
  cutFill: { foreground: ResolvedFill; background: ResolvedFill };
}

const line0 = (): ResolvedLine => ({ color: null, weight: null, pattern: null });
const fill0 = (): ResolvedFill => ({ visible: true, color: null, pattern: null });

/** The plain resolution: visible, nothing overridden. */
export function defaultGraphics(): ResolvedGraphics {
  return {
    visible: true,
    halftone: false,
    color: null,
    transparency: 0,
    projection: line0(),
    cut: line0(),
    surface: { foreground: fill0(), background: fill0() },
    cutFill: { foreground: fill0(), background: fill0() },
  };
}

/** Lay `o` over `r`, field by field (later layers win). */
function layer(r: ResolvedGraphics, o: GraphicOverride): void {
  if (o.visible !== undefined) r.visible = o.visible;
  if (o.halftone !== undefined) r.halftone = o.halftone;
  if (o.transparency !== undefined) r.transparency = Math.max(0, Math.min(100, o.transparency));
  if (o.color !== undefined) {
    r.color = o.color;
    r.projection.color = o.color;
    r.cut.color = o.color;
  }
  const lines = (dst: ResolvedLine, src?: LineOverride) => {
    if (!src) return;
    if (src.color !== undefined) dst.color = src.color;
    if (src.weight !== undefined) dst.weight = src.weight;
    if (src.pattern !== undefined) dst.pattern = src.pattern;
  };
  const fills = (dst: { foreground: ResolvedFill; background: ResolvedFill }, src?: PatternOverride) => {
    for (const k of ["foreground", "background"] as const) {
      const f = src?.[k];
      if (!f) continue;
      if (f.visible !== undefined) dst[k].visible = f.visible;
      if (f.color !== undefined) dst[k].color = f.color;
      if (f.pattern !== undefined) dst[k].pattern = f.pattern;
    }
  };
  lines(r.projection, o.projectionLines);
  lines(r.cut, o.cutLines);
  fills(r.surface, o.surfacePatterns);
  fills(r.cutFill, o.cutPatterns);
  if (o.projectionLines?.color !== undefined) r.color = o.projectionLines.color;
}

/**
 * How an element shows in a view: category visibility and overrides first, then filters in
 * priority order (the first filter to set a property wins over later filters and the category).
 */
/** The category V/G uses for an element: masses (family instances of Mass families) are "Mass". */
export function graphicsCategory(doc: Document, el: Element): string {
  if (el.category === Cat.FamilyInstance) {
    const def = doc.get((el.params as { familyId?: string }).familyId ?? "");
    if ((def?.params as { category?: string } | undefined)?.category === "Mass") return MASS_CATEGORY;
  }
  return el.category;
}

/** V/G category for conceptual masses. */
export const MASS_CATEGORY = "Mass";

export function elementGraphics(doc: Document, g: ViewGraphicsParams, el: Element): ResolvedGraphics {
  const r = defaultGraphics();
  const category = graphicsCategory(doc, el);
  r.visible = !g.hiddenCategories.includes(category);
  const cat = g.categoryOverrides?.[category];
  if (cat) {
    // A hidden category stays hidden even if its override says visible.
    const v = r.visible;
    layer(r, cat);
    r.visible = v && cat.visible !== false;
  }
  // Phasing: the view's phase filter hides or overrides by the element's status in its phase.
  if (PHASED.has(el.category) && g.phaseFilter && g.phaseFilter !== "none") {
    const pg = phaseGraphics(g.phaseFilter, phaseStatus(doc, el, viewPhase(doc, g.phase)));
    if (!pg.visible) r.visible = false;
    if (pg.halftone) r.halftone = true;
    if (pg.color !== undefined && r.color === null) layer(r, { color: pg.color });
  }
  // Filters: the first in the list wins, so lay them on lowest priority first.
  for (const af of [...(g.filters ?? [])].reverse()) {
    const f = doc.get<ViewFilterParams>(af.filterId);
    if (!f || f.category !== Cat.ViewFilter || !filterMatches(doc, f as ViewFilter, el)) continue;
    layer(r, af.override);
  }
  // Element overrides win over everything.
  const own = g.elementOverrides?.[el.id];
  if (own) layer(r, own);
  // Design options: only the option the view shows (default primary) is visible.
  if (!optionVisible(doc, el, g.designOptions)) r.visible = false;
  return r;
}

/** Override (or clear, with null) elements' graphics in a view (Override Graphics in View, By Element). */
export function setElementOverrides(tx: Transaction, doc: Document, viewId: ElementId, ids: ElementId[], o: GraphicOverride | null): void {
  const v = doc.require<ViewParams>(viewId);
  if (v.category !== Cat.View) throw new Error("Element overrides belong to a view");
  const next = { ...(v.params.elementOverrides ?? {}) };
  for (const id of ids) {
    if (o && Object.keys(o).length) next[id] = o;
    else delete next[id];
  }
  tx.update<ViewParams>(viewId, { elementOverrides: Object.keys(next).length ? next : null });
}

/** Where a view's category overrides live: its template if it has one, else the view. */
export function graphicsOwner(doc: Document, viewId: ElementId): ElementId {
  const v = doc.require<ViewParams>(viewId);
  const t = v.params.templateId;
  return t && doc.get(t)?.category === Cat.ViewTemplate ? t : viewId;
}

/** Override (or clear) a category's graphics in a view (By Category); edits the template when there is one. */
export function setCategoryOverride(tx: Transaction, doc: Document, viewId: ElementId, category: string, o: GraphicOverride | null): void {
  const owner = graphicsOwner(doc, viewId);
  const cur = (doc.require(owner).params as ViewGraphicsParams).categoryOverrides ?? {};
  const next = { ...cur };
  if (o && Object.keys(o).length) next[category] = o;
  else delete next[category];
  tx.update<ViewGraphicsParams>(owner, { categoryOverrides: Object.keys(next).length ? next : null });
  if (o?.visible !== undefined) {
    const hidden = (doc.require(owner).params as ViewGraphicsParams).hiddenCategories.filter((c) => c !== category);
    tx.update<ViewGraphicsParams>(owner, { hiddenCategories: o.visible ? hidden : [...hidden, category] });
  }
}
