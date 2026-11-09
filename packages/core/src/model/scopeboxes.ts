import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat, levels, type LevelParams } from "./architecture.ts";
import type { View, ViewParams } from "./viewdefs.ts";

// Scope boxes (Revit: View → Scope Box): named plan boxes, from a bottom to a top height. A plan
// view set to a scope box takes its crop from the box, so a set of plans (a wing, a stage) crop
// alike and move together when the box changes.

export type ScopeBoxParams = {
  min: Vec2;
  max: Vec2;
  /** Height range it applies to, mm (absolute). */
  bottom: number;
  top: number;
};
export type ScopeBox = Element<ScopeBoxParams>;

registerCategory({ name: Cat.ScopeBox, dependencies: () => [], cascadeDelete: false, isType: false });

/** A scope box from two plan corners, spanning every level (lowest − 1 m to highest + 4 m). */
export function createScopeBox(tx: Transaction, doc: Document, a: Vec2, b: Vec2, name?: string): ScopeBox {
  if (Math.abs(a.x - b.x) < 100 || Math.abs(a.y - b.y) < 100) throw new Error("Drag a bigger box (at least 100 mm each way)");
  const els = levels(doc).map((l) => (l.params as LevelParams).elevation);
  const bottom = (els.length ? Math.min(...els) : 0) - 1000;
  const top = (els.length ? Math.max(...els) : 0) + 4000;
  let n = name ?? "Scope Box 1";
  for (let i = 2; !name && doc.byCategory(Cat.ScopeBox).some((s) => s.name === n); i++) n = `Scope Box ${i}`;
  return tx.create<ScopeBoxParams>(
    Cat.ScopeBox,
    { min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }, max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) }, bottom, top },
    { name: n },
  );
}

/**
 * A plan view's crop: its scope box's plan rectangle when it has one, else its own crop
 * (callouts), else none.
 */
export function planCrop(doc: Document, view: View): { min: Vec2; max: Vec2 } | null {
  const p = view.params as ViewParams;
  const box = p.scopeBoxId ? doc.get<ScopeBoxParams>(p.scopeBoxId) : undefined;
  if (box && box.category === Cat.ScopeBox) return { min: { ...box.params.min }, max: { ...box.params.max } };
  return p.crop ?? null;
}

/** Views cropped by this box. */
export function scopeBoxViews(doc: Document, boxId: ElementId): View[] {
  return doc.byCategory<ViewParams>(Cat.View).filter((v) => v.params.scopeBoxId === boxId) as View[];
}
