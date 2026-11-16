import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId } from "../element.ts";

// Pin (Revit: Modify → Pin, PN / UP): a pinned element can't be moved, reshaped or deleted until
// it's unpinned; its other properties stay editable. Stored as `pinned: true` in its params and
// enforced by a commit check, so every tool (and scripts, and collaborators) is held to it.

/** Where an element is and what shape it has: a pinned element's must stay as they are. */
const PLACE_KEYS = [
  "start",
  "end",
  "curve",
  "position",
  "rotation",
  "boundary",
  "holes",
  "points",
  "path",
  "via",
  "runs",
  "line",
  "at",
  "origin",
  "marker",
  "offset",
  "baseOffset",
  "topOffset",
  "height",
  "levelId",
  "baseLevelId",
  "topLevelId",
  "hostId",
  "sillHeight",
  "elevation",
  "profile",
];

export function isPinned(el: Element | undefined): boolean {
  return !!el && (el.params as { pinned?: boolean }).pinned === true;
}

/** Pin or unpin elements (one undo step with the caller's transaction). */
export function setPinned(tx: Transaction, doc: Document, ids: ElementId[], on: boolean): number {
  let n = 0;
  for (const id of ids) {
    const el = doc.get(id);
    if (!el || isPinned(el) === on) continue;
    tx.update(id, { pinned: on });
    n++;
  }
  return n;
}

const label = (el: Element) => (el.name ? `${el.category} "${el.name}"` : el.category);

/** Refuse edits that move, reshape or delete pinned elements. Returns a function that stops it. */
export function enablePinning(doc: Document): () => void {
  return doc.addCommitCheck((changes) => {
    for (const c of changes) {
      if (!c.before || !isPinned(c.before)) continue;
      if (!c.after) throw new Error(`${label(c.before)} is pinned: unpin it (UP) before deleting it`);
      if (!isPinned(c.after)) continue; // being unpinned (it can change in the same step)
      const a = c.before.params as Record<string, unknown>;
      const b = c.after.params as Record<string, unknown>;
      for (const k of PLACE_KEYS) {
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) throw new Error(`${label(c.before)} is pinned: unpin it (UP) to move or reshape it`);
      }
    }
  });
}
