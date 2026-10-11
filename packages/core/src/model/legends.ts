import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat } from "./architecture.ts";
import { views, type View, type ViewParams } from "./viewdefs.ts";

// Legends (Revit: Legend views). A legend is a 2D view with no model in it: text, detail lines and
// regions as in any view, plus legend components (a type's symbol, drawn from the type so it stays
// current) and keynote legends (the keynotes tagged in a view, or in the whole project).

export type LegendComponentParams = {
  viewId: ElementId;
  /** Wall/floor/ceiling/roof, door or window type. */
  typeId: ElementId;
  /** Top-left of the symbol in legend coordinates, mm. */
  position: Vec2;
  /** Swatch length for layered types, mm. */
  length: number;
  /** Write the type's name beside the symbol. */
  label: boolean;
};
export type LegendComponent = Element<LegendComponentParams>;

export type KeynoteLegendParams = {
  viewId: ElementId;
  position: Vec2;
  /** List keynotes tagged in this view, or in every view when null. */
  sourceViewId: ElementId | null;
};
export type KeynoteLegend = Element<KeynoteLegendParams>;

/** Types a legend component can show. */
export const LEGEND_TYPE_CATEGORIES = new Set<string>([Cat.WallType, Cat.FloorType, Cat.CeilingType, Cat.RoofType, Cat.DoorType, Cat.WindowType]);

registerCategory({
  name: Cat.LegendComponent,
  dependencies: (el) => [(el.params as LegendComponentParams).viewId, (el.params as LegendComponentParams).typeId],
  cascadeDelete: true,
  isType: false,
});
registerCategory({
  name: Cat.KeynoteLegend,
  // Not dependent on the source view: deleting it falls back to listing the whole project.
  dependencies: (el) => [(el.params as KeynoteLegendParams).viewId],
  cascadeDelete: true,
  isType: false,
});

export function legends(doc: Document): View[] {
  return views(doc).filter((v) => v.params.kind === "legend");
}

export function createLegend(tx: Transaction, doc: Document, opts: { name?: string; scale?: number } = {}): View {
  let name = opts.name ?? "Legend 1";
  for (let i = 2; !opts.name && legends(doc).some((v) => v.name === name); i++) name = `Legend ${i}`;
  if (legends(doc).some((v) => v.name === name)) throw new Error(`A legend called "${name}" already exists`);
  return tx.create<ViewParams>(
    Cat.View,
    { kind: "legend", levelId: null, range: null, scale: opts.scale ?? 20, detailLevel: "fine", hiddenCategories: [] },
    { name },
  ) as View;
}

function requireLegend(doc: Document, viewId: ElementId): void {
  const v = doc.get<ViewParams>(viewId);
  if (!v || v.category !== Cat.View || v.params.kind !== "legend") throw new Error("Legend components go in legend views");
}

export function createLegendComponent(
  tx: Transaction,
  doc: Document,
  viewId: ElementId,
  typeId: ElementId,
  position: Vec2,
  opts: { length?: number; label?: boolean } = {},
): LegendComponent {
  requireLegend(doc, viewId);
  const type = doc.require(typeId);
  if (!LEGEND_TYPE_CATEGORIES.has(type.category)) throw new Error(`${type.category} can't be shown in a legend`);
  return tx.create<LegendComponentParams>(Cat.LegendComponent, {
    viewId,
    typeId,
    position: { ...position },
    length: opts.length ?? 1000,
    label: opts.label ?? true,
  }) as LegendComponent;
}

/** Height a component's symbol hangs down from its position, mm. */
export function legendComponentHeight(doc: Document, c: LegendComponent): number {
  const t = doc.get(c.params.typeId);
  if (!t) return 0;
  const p = t.params as { layers?: { thickness: number }[]; leafHeight?: number; frameWidth?: number; height?: number };
  if (p.layers) return p.layers.reduce((s, l) => s + l.thickness, 0);
  if (t.category === Cat.DoorType) return (p.leafHeight ?? 0) + (p.frameWidth ?? 0);
  return p.height ?? 0;
}

/** Position for a new component: below everything already in the legend. */
export function nextLegendPosition(doc: Document, viewId: ElementId, gap = 600): Vec2 {
  const comps = (doc.byCategory<LegendComponentParams>(Cat.LegendComponent) as LegendComponent[]).filter((c) => c.params.viewId === viewId);
  if (!comps.length) return { x: 0, y: 0 };
  return { x: 0, y: Math.min(...comps.map((c) => c.params.position.y - legendComponentHeight(doc, c))) - gap };
}

export function createKeynoteLegend(tx: Transaction, doc: Document, viewId: ElementId, position: Vec2, sourceViewId: ElementId | null = null): KeynoteLegend {
  const v = doc.get<ViewParams>(viewId);
  if (!v || v.category !== Cat.View || v.params.kind === "3d") throw new Error("Keynote legends go in 2D views");
  return tx.create<KeynoteLegendParams>(Cat.KeynoteLegend, { viewId, position: { ...position }, sourceViewId }) as KeynoteLegend;
}
