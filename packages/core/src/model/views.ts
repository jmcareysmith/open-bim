import type { Document } from "../document.ts";
import type { ElementId } from "../element.ts";
import type { LevelParams } from "./architecture.ts";

// Minimal view concepts for Phase 1. Phase 2 turns views into elements with their own
// view range, visibility and detail level.

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
