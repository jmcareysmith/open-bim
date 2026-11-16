import type { Document, Transaction } from "../document.ts";
import type { ElementId, Params } from "../element.ts";
import { Cat, type LevelParams } from "./architecture.ts";
import { IDENTITY, transformElements } from "./modify.ts";

// Paste Aligned (Revit: Modify → Paste ▾): copies at the same place, or on other levels. On another
// level a copy keeps its offsets from its level; a top constraint moves to the level the same
// distance up (else the top becomes unconnected at the same height).

const LEVEL_KEYS = ["levelId", "baseLevelId"] as const;

/** The level an element sits on (its levelId or baseLevelId), if any. */
function levelOfElement(p: Record<string, unknown>): ElementId | undefined {
  for (const k of LEVEL_KEYS) if (typeof p[k] === "string") return p[k] as ElementId;
  return undefined;
}

/** Copies of `ids` in the same place. Returns the copies. */
export function pasteSamePlace(tx: Transaction, doc: Document, ids: ElementId[]): ElementId[] {
  return transformElements(tx, doc, ids.filter((id) => doc.has(id)), IDENTITY, { copy: true });
}

/** Copies of `ids` on `levelId` (aligned in plan). Elements on no level are copied in place. */
export function pasteToLevel(tx: Transaction, doc: Document, ids: ElementId[], levelId: ElementId): ElementId[] {
  const target = doc.require<LevelParams>(levelId);
  if (target.category !== Cat.Level) throw new Error("Paste to a level");
  const levels = doc.byCategory<LevelParams>(Cat.Level);
  const copies = pasteSamePlace(tx, doc, ids);
  for (const id of copies) {
    const el = doc.get(id);
    if (!el) continue;
    const p = el.params as Record<string, unknown>;
    const from = levelOfElement(p);
    if (!from || from === levelId) continue;
    const z0 = doc.get<LevelParams>(from)?.params.elevation ?? 0;
    const dz = target.params.elevation - z0;
    const patch: Record<string, unknown> = {};
    for (const k of LEVEL_KEYS) if (p[k] === from) patch[k] = levelId;
    // A top on a level: the level the same distance up, else unconnected at the same height.
    if (typeof p.topLevelId === "string") {
      const top = doc.get<LevelParams>(p.topLevelId);
      const want = (top?.params.elevation ?? 0) + dz;
      const same = levels.find((l) => Math.abs(l.params.elevation - want) < 1);
      if (same) patch.topLevelId = same.id;
      else {
        patch.topLevelId = null;
        patch.height = (top?.params.elevation ?? 0) + Number(p.topOffset ?? 0) - (z0 + Number(p.baseOffset ?? 0));
      }
    }
    if (Object.keys(patch).length) tx.update(id, patch as Params);
  }
  return copies;
}
