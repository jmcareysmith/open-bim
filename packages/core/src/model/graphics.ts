import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, ParamValue } from "../element.ts";
import { Cat } from "./architecture.ts";
import type { DetailLevel, ViewParams } from "./viewdefs.ts";
import { customValue } from "./parameters.ts";

// Visibility/Graphics: per-view category visibility and overrides, rule-based filters, and view
// templates that several views share (Revit V/G, Filters, View Templates).

/** Graphic override for a category or filter in a view. Unset fields don't override. */
export type GraphicOverride = {
  visible?: boolean;
  halftone?: boolean;
  /** Line colour, 0xRRGGBB. */
  color?: number;
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
      forKind: p.kind === "callout" || p.kind === "areaPlan" ? "floorPlan" : p.kind,
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

/** Resolved display of an element in a view. */
export interface ResolvedGraphics {
  visible: boolean;
  halftone: boolean;
  color: number | null;
}

/**
 * How an element shows in a view: category visibility and overrides first, then filters in
 * priority order (the first filter to set a property wins over later filters and the category).
 */
export function elementGraphics(doc: Document, g: ViewGraphicsParams, el: Element): ResolvedGraphics {
  const cat = g.categoryOverrides?.[el.category] ?? {};
  let visible = !g.hiddenCategories.includes(el.category) && cat.visible !== false;
  let halftone = cat.halftone ?? false;
  let color = cat.color ?? null;
  const set = { visible: false, halftone: false, color: false };
  for (const af of g.filters ?? []) {
    const f = doc.get<ViewFilterParams>(af.filterId);
    if (!f || f.category !== Cat.ViewFilter || !filterMatches(doc, f as ViewFilter, el)) continue;
    const o = af.override;
    if (o.visible !== undefined && !set.visible) [visible, set.visible] = [o.visible, true];
    if (o.halftone !== undefined && !set.halftone) [halftone, set.halftone] = [o.halftone, true];
    if (o.color !== undefined && !set.color) [color, set.color] = [o.color, true];
  }
  return { visible, halftone, color };
}
