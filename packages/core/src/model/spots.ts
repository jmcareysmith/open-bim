import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { DEFAULT_TEXT_SIZE } from "./annotations.ts";
import { Cat, floorTopAt, type Floor, type LevelParams } from "./architecture.ts";
import { extrusionHeightAt, roofBaseElevation, roofHeightAt, roofPlanes, type Roof } from "./roofs.ts";
import { surfaceHeightAt, toposolidSurface, type Toposolid } from "./site.ts";
import type { ViewParams } from "./viewdefs.ts";

// Spot elevations (Revit: Annotate → Spot Elevation): a view's annotation pointing at a place, with
// a leader to a symbol and the height there. On a floor, roof or toposolid the height is that
// element's top, read live; otherwise a section's point height, or a plan's level.

export type SpotElevationParams = {
  viewId: ElementId;
  /** The point measured, in the view's 2D space (plan XY, or drawing x along / y up). */
  point: Vec2;
  /** Where the symbol and text sit (end of the leader), view 2D. */
  leader: Vec2;
  /** The element whose top is measured, if any. */
  hostId?: ElementId | null;
  /** Text height on paper, mm. */
  size: number;
};
export type SpotElevation = Element<SpotElevationParams>;

registerCategory({
  name: Cat.SpotElevation,
  dependencies: (el) => {
    const p = el.params as SpotElevationParams;
    return [p.viewId, ...(p.hostId ? [p.hostId] : [])];
  },
  cascadeDelete: true,
  isType: false,
});

/** Categories whose top a spot elevation reads. */
export const SPOT_HOSTS = new Set<string>([Cat.Floor, Cat.Roof, Cat.Toposolid]);

/** Plan position of a view-2D point (sections: along the view's line). */
function planPoint(view: Element<ViewParams>, p: Vec2): Vec2 {
  const line = view.params.line;
  if (!line) return p;
  const l = Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y) || 1;
  return { x: line.start.x + ((line.end.x - line.start.x) / l) * p.x, y: line.start.y + ((line.end.y - line.start.y) / l) * p.x };
}

/** Top of a floor, roof or toposolid at a plan point (absolute), or null if it isn't there. */
export function hostTopAt(doc: Document, host: Element, p: Vec2): number | null {
  if (host.category === Cat.Floor) return floorTopAt(doc, host as Floor, p);
  if (host.category === Cat.Roof) {
    const r = host as Roof;
    const t = r.typeId ? (doc.get<{ layers: { thickness: number }[] }>(r.typeId)?.params.layers ?? []).reduce((a, l) => a + l.thickness, 0) : 0;
    const e = r.params.extrusion;
    const h = e ? extrusionHeightAt(e, p) : roofHeightAt(roofPlanes(r.params.boundary, r.params.slopes), p);
    return h === null ? null : roofBaseElevation(doc, r) + h + t;
  }
  if (host.category === Cat.Toposolid) return surfaceHeightAt(toposolidSurface(doc, host as Toposolid), p);
  return null;
}

/** The elevation a spot shows, absolute mm (project zero). */
export function spotElevationValue(doc: Document, spot: SpotElevation): number {
  const view = doc.require<ViewParams>(spot.params.viewId);
  const host = spot.params.hostId ? doc.get(spot.params.hostId) : undefined;
  if (host) {
    const z = hostTopAt(doc, host, planPoint(view, spot.params.point));
    if (z !== null) return z;
  }
  if (view.params.line) return spot.params.point.y;
  const lv = view.params.levelId ? doc.get<LevelParams>(view.params.levelId) : undefined;
  return lv?.params.elevation ?? 0;
}

/** "RL" text in metres, 3 places (NZ drawings), with a + for heights above zero. */
export function formatSpotElevation(mm: number): string {
  const m = mm / 1000;
  return `${m >= 0 ? "+" : "−"}${Math.abs(m).toFixed(3)}`;
}

export function createSpotElevation(
  tx: Transaction,
  doc: Document,
  viewId: ElementId,
  point: Vec2,
  leader: Vec2,
  opts: { hostId?: ElementId | null; size?: number } = {},
): SpotElevation {
  const v = doc.require<ViewParams>(viewId);
  if (v.category !== Cat.View || v.params.kind === "3d") throw new Error("Spot elevations go in plans, sections and elevations");
  const host = opts.hostId ? doc.get(opts.hostId) : undefined;
  if (host && !SPOT_HOSTS.has(host.category)) throw new Error("Spot elevations read floors, roofs and toposolids");
  return tx.create<SpotElevationParams>(Cat.SpotElevation, { viewId, point: { ...point }, leader: { ...leader }, hostId: opts.hostId ?? null, size: opts.size ?? DEFAULT_TEXT_SIZE }) as SpotElevation;
}
