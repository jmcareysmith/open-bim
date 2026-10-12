import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat } from "./architecture.ts";
import type { ViewParams } from "./viewdefs.ts";

// CAD imports (Revit: Import CAD, current view only). DXF line work and text placed in one view
// as a single element, in the view's 2D coordinates (plan mm for plans), movable by its offset.

export type CadImportParams = {
  viewId: ElementId;
  /** [x0, y0, x1, y1, …] mm, before the offset. */
  segments: number[];
  texts: { text: string; x: number; y: number; size: number }[];
  offset: Vec2;
  layers: string[];
};
export type CadImport = Element<CadImportParams>;

registerCategory({
  name: Cat.CadImport,
  dependencies: (el) => [(el.params as CadImportParams).viewId],
  cascadeDelete: true,
  isType: false,
});

export function createCadImport(
  tx: Transaction,
  doc: Document,
  viewId: ElementId,
  content: { segments: number[]; texts: CadImportParams["texts"]; layers: string[] },
  name: string,
): CadImport {
  const v = doc.get<ViewParams>(viewId);
  if (!v || v.category !== Cat.View || v.params.kind === "3d") throw new Error("CAD imports go in plans, sections, elevations or legends");
  if (!content.segments.length && !content.texts.length) throw new Error("That file has no line work to import");
  return tx.create<CadImportParams>(
    Cat.CadImport,
    { viewId, segments: [...content.segments], texts: content.texts.map((t) => ({ ...t })), offset: { x: 0, y: 0 }, layers: [...content.layers] },
    { name },
  ) as CadImport;
}
