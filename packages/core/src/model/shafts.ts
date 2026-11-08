import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat, type LevelParams } from "./architecture.ts";
import { validateRegion } from "./sketch.ts";

// Shaft openings (Revit: Opening → Shaft): a plan outline between a base and a top level that cuts
// every floor and ceiling in that height — stairwells, lift and service shafts.

export type ShaftParams = { baseLevelId: ElementId; topLevelId: ElementId; baseOffset: number; topOffset: number; boundary: Vec2[] };
export type Shaft = Element<ShaftParams>;

registerCategory({
  name: Cat.Shaft,
  dependencies: (el) => {
    const p = el.params as ShaftParams;
    return [p.baseLevelId, p.topLevelId];
  },
  // The floors and ceilings it cuts are rebuilt with it.
  related: (doc) => [...doc.byCategory(Cat.Floor), ...doc.byCategory(Cat.Ceiling)].map((e) => e.id),
  cascadeDelete: true,
  isType: false,
});

/** The shaft's absolute bottom and top, mm. */
export function shaftExtent(doc: Document, s: Shaft): { bottom: number; top: number } {
  const lv = (id: ElementId) => doc.get<LevelParams>(id)?.params.elevation ?? 0;
  return { bottom: lv(s.params.baseLevelId) + s.params.baseOffset, top: lv(s.params.topLevelId) + s.params.topOffset };
}

/** Shaft outlines cutting anything between z0 and z1. */
export function shaftsCutting(doc: Document, z0: number, z1: number): Vec2[][] {
  return (doc.byCategory<ShaftParams>(Cat.Shaft) as Shaft[])
    .filter((s) => {
      const e = shaftExtent(doc, s);
      return e.bottom < z1 - 1e-6 && e.top > z0 + 1e-6;
    })
    .map((s) => s.params.boundary);
}

/**
 * A shaft from `baseLevelId` up to `topLevelId` (default: the next level up, so it cuts the floor
 * above as well as everything between).
 */
export function createShaft(tx: Transaction, doc: Document, baseLevelId: ElementId, boundary: Vec2[], opts: { topLevelId?: ElementId; topOffset?: number } = {}): Shaft {
  const levels = doc.byCategory<LevelParams>(Cat.Level).sort((a, b) => a.params.elevation - b.params.elevation);
  const base = doc.require<LevelParams>(baseLevelId);
  const top = opts.topLevelId ?? levels.find((l) => l.params.elevation > base.params.elevation)?.id;
  if (!top) throw new Error("A shaft needs a level above its base");
  const region = validateRegion({ boundary, holes: [] });
  // Default top offset: a little past the top level so the floor there is cut through.
  return tx.create<ShaftParams>(Cat.Shaft, { baseLevelId, topLevelId: top, baseOffset: 0, topOffset: opts.topOffset ?? 50, boundary: region.boundary }) as Shaft;
}
