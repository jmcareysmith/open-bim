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

/**
 * A straight datum's extent limited to its scope box (Revit: datums take the box's extents):
 * the part of start → end inside the box, or the line itself when unboxed, curved or missing it.
 */
export function datumExtent(doc: Document, d: { params: { start: Vec2; end: Vec2; curve?: number | null; scopeBoxId?: ElementId | null } }): { start: Vec2; end: Vec2 } {
  const { start, end, curve, scopeBoxId } = d.params;
  const box = scopeBoxId ? doc.get<ScopeBoxParams>(scopeBoxId) : undefined;
  if (!box || box.category !== Cat.ScopeBox || curve) return { start, end };
  const { min, max } = box.params;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [
    [-dx, start.x - min.x],
    [dx, max.x - start.x],
    [-dy, start.y - min.y],
    [dy, max.y - start.y],
  ] as const) {
    if (p === 0) {
      if (q < 0) return { start, end };
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
  }
  // A grid ending inside the box keeps its end; one crossing the box is cut at its edges.
  if (t0 >= t1) return { start, end };
  return { start: { x: start.x + dx * Math.max(0, t0), y: start.y + dy * Math.max(0, t0) }, end: { x: start.x + dx * Math.min(1, t1), y: start.y + dy * Math.min(1, t1) } };
}

/** Views cropped by this box. */
export function scopeBoxViews(doc: Document, boxId: ElementId): View[] {
  return doc.byCategory<ViewParams>(Cat.View).filter((v) => v.params.scopeBoxId === boxId) as View[];
}
