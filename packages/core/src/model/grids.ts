import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat } from "./architecture.ts";

// Grids are datums: named lines in plan that run through every level (Revit behaviour).
// They have no level of their own; views draw them at whatever level they show.

export type GridParams = {
  /** Plan mm. The bubble/label sits at both ends. */
  start: Vec2;
  end: Vec2;
};
export type Grid = Element<GridParams>;

registerCategory({ name: Cat.Grid, dependencies: () => [], cascadeDelete: false, isType: false });

/** Letters skip I and O so labels can't be confused with 1 and 0 (common drafting practice). */
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

/**
 * Next label in a series: "1" → "2", "A" → "B", "H" → "J", "Z" → "AA", "A9" → "A10".
 * Labels without a trailing number or letter get "1" appended.
 */
export function incrementGridName(name: string): string {
  const num = /^(.*?)(\d+)$/.exec(name);
  if (num) return `${num[1]}${Number(num[2]) + 1}`;
  const let_ = /^(.*?)([A-Za-z]+)$/.exec(name);
  if (!let_) return `${name}1`;
  const lower = let_[2] !== let_[2]!.toUpperCase();
  const letters = let_[2]!.toUpperCase().split("");
  let i = letters.length - 1;
  for (; i >= 0; i--) {
    const next = [...LETTERS].find((c) => c > letters[i]!); // LETTERS is sorted, so I → J
    if (next) {
      letters[i] = next;
      break;
    }
    letters[i] = "A"; // Z carries
  }
  const next = (i < 0 ? "A" : "") + letters.join("");
  return let_[1] + (lower ? next.toLowerCase() : next);
}

export function gridNameInUse(doc: Document, name: string, exceptId?: ElementId): boolean {
  return doc.byCategory(Cat.Grid).some((g) => g.name === name && g.id !== exceptId);
}

/** Continues the series of the most recently created grid; "1" for the first grid. */
export function nextGridName(doc: Document): string {
  const last = doc.byCategory(Cat.Grid).at(-1)?.name;
  let name = last ? incrementGridName(last) : "1";
  while (gridNameInUse(doc, name)) name = incrementGridName(name);
  return name;
}

/**
 * Create a grid. Without a name it continues the current series.
 * Grid names must be unique, as in Revit.
 */
export function createGrid(tx: Transaction, doc: Document, start: Vec2, end: Vec2, name?: string): Grid {
  if (Math.hypot(end.x - start.x, end.y - start.y) < 1) throw new Error("Grid must have non-zero length");
  const label = name ?? nextGridName(doc);
  if (!label) throw new Error("Grid needs a name");
  if (gridNameInUse(doc, label)) throw new Error(`Grid name "${label}" is already in use`);
  return tx.create<GridParams>(Cat.Grid, { start, end }, { name: label });
}

/** Rename a grid, enforcing unique names. */
export function renameGrid(tx: Transaction, doc: Document, id: ElementId, name: string): void {
  if (!name) throw new Error("Grid needs a name");
  if (gridNameInUse(doc, name, id)) throw new Error(`Grid name "${name}" is already in use`);
  tx.setName(id, name);
}
