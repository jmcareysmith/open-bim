import type { Document } from "../document.ts";
import type { Element, ElementId } from "../element.ts";
import { Cat, type LevelParams } from "./architecture.ts";

// View-related helpers that aren't elements. View elements themselves live in viewdefs.ts.

/** Revit's default floor plan cut plane height above the level, mm. */
export const PLAN_CUT_HEIGHT = 1200;

/** Vertical slice a plan shows: everything between `bottom` and `cut` (absolute Z, mm). */
export interface ViewRange {
  bottom: number;
  cut: number;
}

/** Default floor plan range for a level: from the level up to the cut plane. */
export function planViewRange(doc: Document, levelId: ElementId, cutHeight = PLAN_CUT_HEIGHT): ViewRange {
  const elevation = doc.require<LevelParams>(levelId).params.elevation;
  return { bottom: elevation, cut: elevation + cutHeight };
}

// ---- Temporary hide/isolate ---------------------------------------------------

/**
 * Revit's temporary hide/isolate (HH/HI/HC/IC/HR): view-only, never saved, doesn't touch the model.
 * Hides accumulate; isolating replaces any earlier isolate. `reset()` clears everything.
 */
export class TemporaryVisibility {
  private hiddenIds = new Set<ElementId>();
  private hiddenCats = new Set<string>();
  private isolatedIds: Set<ElementId> | null = null;
  private isolatedCats: Set<string> | null = null;

  /** True while anything is hidden or isolated (Revit draws a cyan border). */
  get active(): boolean {
    return this.hiddenIds.size > 0 || this.hiddenCats.size > 0 || this.isolatedIds !== null || this.isolatedCats !== null;
  }

  hide(ids: Iterable<ElementId>): void {
    for (const id of ids) this.hiddenIds.add(id);
  }

  hideCategories(categories: Iterable<string>): void {
    for (const c of categories) this.hiddenCats.add(c);
  }

  isolate(ids: Iterable<ElementId>): void {
    this.isolatedIds = new Set(ids);
    this.isolatedCats = null;
  }

  isolateCategories(categories: Iterable<string>): void {
    this.isolatedCats = new Set(categories);
    this.isolatedIds = null;
  }

  reset(): void {
    this.hiddenIds.clear();
    this.hiddenCats.clear();
    this.isolatedIds = null;
    this.isolatedCats = null;
  }

  isVisible(el: Pick<Element, "id" | "category">): boolean {
    if (this.hiddenIds.has(el.id) || this.hiddenCats.has(el.category)) return false;
    if (this.isolatedIds && !this.isolatedIds.has(el.id)) return false;
    if (this.isolatedCats && !this.isolatedCats.has(el.category)) return false;
    return true;
  }
}

/** Type category for an instance category (Wall → WallType…), or undefined for untyped categories. */
export function typeCategoryOf(category: string): string | undefined {
  return TYPE_CATEGORY[category];
}

const TYPE_CATEGORY: Record<string, string> = {
  [Cat.Wall]: Cat.WallType,
  [Cat.Floor]: Cat.FloorType,
  [Cat.Ceiling]: Cat.CeilingType,
  [Cat.Roof]: Cat.RoofType,
  [Cat.Door]: Cat.DoorType,
  [Cat.Window]: Cat.WindowType,
  [Cat.Stair]: Cat.StairType,
  [Cat.Railing]: Cat.RailingType,
  [Cat.Ramp]: Cat.RampType,
};
