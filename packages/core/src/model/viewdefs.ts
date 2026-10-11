import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId } from "../element.ts";
import { Cat, levels, type LevelParams } from "./architecture.ts";
import { PLAN_CUT_HEIGHT, type ViewRange } from "./views.ts";

// Views are elements, as in Revit: saved with the project, listed in the browser, each with its
// own range, scale, detail level and visibility. Sections, elevations and sheets build on this.

export type ViewKind = "floorPlan" | "3d";
export type DetailLevel = "coarse" | "medium" | "fine";

/** Revit view range, as offsets from the view's level, mm. */
export type ViewRangeOffsets = {
  /** Primary range top (things above are not shown). */
  top: number;
  /** Cut plane: elements crossing it are drawn cut. */
  cut: number;
  /** Primary range bottom. */
  bottom: number;
  /** View depth: elements down to here are drawn beyond. Must be ≤ bottom. */
  depth: number;
};

export type ViewParams = {
  kind: ViewKind;
  /** Associated level (floor plans); null for 3D views. */
  levelId: ElementId | null;
  /** Plans only. */
  range: ViewRangeOffsets | null;
  /** Drawing scale denominator: 100 means 1:100. */
  scale: number;
  detailLevel: DetailLevel;
  /** Categories hidden in this view (Visibility/Graphics). */
  hiddenCategories: string[];
};
export type View = Element<ViewParams>;

/** Revit's default floor plan view range. */
export const DEFAULT_VIEW_RANGE: ViewRangeOffsets = { top: 2300, cut: PLAN_CUT_HEIGHT, bottom: 0, depth: 0 };
export const SCALES = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000] as const;

registerCategory({
  name: Cat.View,
  dependencies: (el) => {
    const p = el.params as ViewParams;
    return p.levelId ? [p.levelId] : [];
  },
  // Deleting a level deletes its plans (Revit does the same).
  cascadeDelete: true,
  isType: false,
});

export function views(doc: Document): View[] {
  return doc.byCategory<ViewParams>(Cat.View);
}

/** View names are unique per kind ("Ground Floor" plan and "Ground Floor" ceiling plan may coexist). */
function nameInUse(doc: Document, kind: ViewKind, name: string, exceptId?: ElementId): boolean {
  return views(doc).some((v) => v.params.kind === kind && v.name === name && v.id !== exceptId);
}

function uniqueName(doc: Document, kind: ViewKind, base: string): string {
  let name = base;
  for (let i = 2; nameInUse(doc, kind, name); i++) name = `${base} (${i})`;
  return name;
}

export function validateViewRange(r: ViewRangeOffsets): void {
  if (!(r.bottom <= r.cut && r.cut <= r.top)) throw new Error("View range must satisfy bottom ≤ cut plane ≤ top");
  if (r.depth > r.bottom) throw new Error("View depth can't be above the bottom of the view range");
}

export function createFloorPlan(
  tx: Transaction,
  doc: Document,
  levelId: ElementId,
  opts: { name?: string; range?: ViewRangeOffsets; scale?: number } = {},
): View {
  const level = doc.require<LevelParams>(levelId);
  if (level.category !== Cat.Level) throw new Error("Floor plans belong to a level");
  const range = opts.range ?? DEFAULT_VIEW_RANGE;
  validateViewRange(range);
  const name = opts.name ?? uniqueName(doc, "floorPlan", level.name ?? "Level");
  if (nameInUse(doc, "floorPlan", name)) throw new Error(`A floor plan called "${name}" already exists`);
  return tx.create<ViewParams>(
    Cat.View,
    { kind: "floorPlan", levelId, range, scale: opts.scale ?? 100, detailLevel: "coarse", hiddenCategories: [] },
    { name },
  );
}

export function create3DView(tx: Transaction, doc: Document, name = "{3D}"): View {
  if (nameInUse(doc, "3d", name)) throw new Error(`A 3D view called "${name}" already exists`);
  return tx.create<ViewParams>(
    Cat.View,
    { kind: "3d", levelId: null, range: null, scale: 100, detailLevel: "medium", hiddenCategories: [] },
    { name },
  );
}

export function renameView(tx: Transaction, doc: Document, id: ElementId, name: string): void {
  const v = doc.require<ViewParams>(id);
  if (!name) throw new Error("Views need a name");
  if (nameInUse(doc, v.params.kind, name, id)) throw new Error(`Another view is already called "${name}"`);
  tx.setName(id, name);
}

/** Absolute Z range a plan view shows: from its view depth up to its cut plane. */
export function viewRange(doc: Document, view: View): ViewRange {
  const p = view.params;
  if (p.kind !== "floorPlan" || !p.levelId || !p.range) throw new Error("Only plan views have a view range");
  const elevation = doc.require<LevelParams>(p.levelId).params.elevation;
  return { bottom: elevation + Math.min(p.range.bottom, p.range.depth), cut: elevation + p.range.cut };
}

export function floorPlanFor(doc: Document, levelId: ElementId): View | undefined {
  return views(doc).find((v) => v.params.kind === "floorPlan" && v.params.levelId === levelId);
}

/** Give every level a floor plan and the project a 3D view (for files saved before views existed). */
export function ensureDefaultViews(tx: Transaction, doc: Document): View[] {
  const created: View[] = [];
  for (const l of levels(doc)) if (!floorPlanFor(doc, l.id)) created.push(createFloorPlan(tx, doc, l.id));
  if (!views(doc).some((v) => v.params.kind === "3d")) created.push(create3DView(tx, doc));
  return created;
}

export function isViewVisible(view: View, category: string): boolean {
  return !view.params.hiddenCategories.includes(category);
}
