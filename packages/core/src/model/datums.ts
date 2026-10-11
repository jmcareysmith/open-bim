import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat } from "./architecture.ts";

// Line datums in plan: grids and reference planes. Both are vertical planes through every
// level, stored as a plan segment; tools snap to them.

export type DatumLineParams = {
  start: Vec2;
  end: Vec2;
};
export type DatumLine = Element<DatumLineParams>;

/** Grids and reference planes, in creation order. */
export function datumLines(doc: Document): DatumLine[] {
  return doc.all().filter((e) => e.category === Cat.Grid || e.category === Cat.ReferencePlane) as DatumLine[];
}

/** Intersection of two datum segments within both extents, or null. */
export function datumIntersection(a: DatumLine, b: DatumLine): Vec2 | null {
  const p = a.params.start;
  const r = { x: a.params.end.x - p.x, y: a.params.end.y - p.y };
  const q = b.params.start;
  const s = { x: b.params.end.x - q.x, y: b.params.end.y - q.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q.x - p.x) * s.y - (q.y - p.y) * s.x) / den;
  const u = ((q.x - p.x) * r.y - (q.y - p.y) * r.x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p.x + r.x * t, y: p.y + r.y * t };
}

/** Closest point on the datum segment to `p`. */
export function closestPointOnDatum(d: DatumLine, p: Vec2): Vec2 {
  const { start, end } = d.params;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const t = Math.max(0, Math.min(1, ((p.x - start.x) * dx + (p.y - start.y) * dy) / (dx * dx + dy * dy)));
  return { x: start.x + dx * t, y: start.y + dy * t };
}

// ---- Reference planes --------------------------------------------------------

export type ReferencePlaneParams = DatumLineParams & {
  /** Pinned: constraint solving never moves it (the family template's centre planes). */
  fixed?: boolean;
};
export type ReferencePlane = Element<ReferencePlaneParams>;

registerCategory({ name: Cat.ReferencePlane, dependencies: () => [], cascadeDelete: false, isType: false });

function refPlaneNameInUse(doc: Document, name: string, exceptId?: ElementId): boolean {
  return doc.byCategory(Cat.ReferencePlane).some((r) => r.name === name && r.id !== exceptId);
}

/** Reference planes may be unnamed; named ones must be unique (as in Revit). */
export function createReferencePlane(
  tx: Transaction,
  doc: Document,
  start: Vec2,
  end: Vec2,
  name?: string,
): ReferencePlane {
  if (Math.hypot(end.x - start.x, end.y - start.y) < 1) throw new Error("Reference plane must have non-zero length");
  if (name && refPlaneNameInUse(doc, name)) throw new Error(`Reference plane name "${name}" is already in use`);
  return tx.create<ReferencePlaneParams>(Cat.ReferencePlane, { start, end }, name ? { name } : {});
}

/** Rename, or clear the name with "". */
export function renameReferencePlane(tx: Transaction, doc: Document, id: ElementId, name: string): void {
  if (name && refPlaneNameInUse(doc, name, id)) throw new Error(`Reference plane name "${name}" is already in use`);
  tx.setName(id, name || undefined);
}
