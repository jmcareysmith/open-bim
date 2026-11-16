import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId } from "../element.ts";

// Join Geometry (Revit: Modify → Join): where two elements overlap, the first picked cuts the
// second (a wall through a slab, a slab through a wall). Stored on the cut element as `cutBy`.
// Unjoin removes the pair; Switch Join Order swaps which one cuts.

// Literal names: architecture.ts imports this module (no import cycle at load).
const JOINABLE = new Set<string>(["Wall", "Floor", "Ceiling", "Roof"]);

const cutByOf = (el: Element | undefined): ElementId[] => ((el?.params as { cutBy?: ElementId[] | null } | undefined)?.cutBy ?? []).filter((x) => typeof x === "string");

/** Join two elements: `cutter` cuts `cut` where they overlap. */
export function joinGeometry(tx: Transaction, doc: Document, cutter: ElementId, cut: ElementId): void {
  const a = doc.require(cutter);
  const b = doc.require(cut);
  if (a.id === b.id) throw new Error("Pick two different elements");
  if (!JOINABLE.has(a.category) || !JOINABLE.has(b.category)) throw new Error("Join Geometry works on walls, floors, ceilings and roofs");
  if (a.category === "Wall" && b.category === "Wall") throw new Error("Walls join each other at their ends already; use Wall Joins (Properties) instead");
  // Already joined the other way: switch.
  if (cutByOf(a).includes(b.id)) tx.update(a.id, { cutBy: cutByOf(a).filter((x) => x !== b.id) });
  if (!cutByOf(b).includes(a.id)) tx.update(b.id, { cutBy: [...cutByOf(b), a.id] });
}

/** Unjoin two elements (either order). */
export function unjoinGeometry(tx: Transaction, doc: Document, x: ElementId, y: ElementId): void {
  for (const [p, q] of [[x, y], [y, x]] as const) {
    const el = doc.get(p);
    if (el && cutByOf(el).includes(q)) tx.update(p, { cutBy: cutByOf(el).filter((z) => z !== q) });
  }
}

/** Switch which of two joined elements cuts the other. */
export function switchJoinOrder(tx: Transaction, doc: Document, x: ElementId, y: ElementId): void {
  const ex = doc.require(x);
  const ey = doc.require(y);
  if (cutByOf(ey).includes(x)) return joinGeometry(tx, doc, y, x);
  if (cutByOf(ex).includes(y)) return joinGeometry(tx, doc, x, y);
  throw new Error("Those two aren't joined");
}

/** The elements cutting `el` (that still exist). */
export function cuttersOf(doc: Document, el: Element): Element[] {
  return cutByOf(el).map((id) => doc.get(id)).filter((e): e is Element => !!e);
}

/** Elements joined with `id` either way (for regeneration). */
export function joinedGeometry(doc: Document, el: Element): ElementId[] {
  const out = new Set(cutByOf(el));
  for (const cat of JOINABLE) for (const o of doc.byCategory(cat)) if (cutByOf(o).includes(el.id)) out.add(o.id);
  return [...out];
}
