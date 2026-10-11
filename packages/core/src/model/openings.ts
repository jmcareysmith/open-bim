import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat, wallExtent, wallLength, type Wall, type WallParams } from "./architecture.ts";

// Hosted elements that cut their host wall (Revit: wall openings, doors, windows).
// The cut is a box through the wall's full thickness, positioned along the wall's location line.

/** Placement shared by everything hosted in a wall. */
export type HostedParams = {
  hostId: ElementId;
  /** Distance along the wall's location line from its start to the centre of the opening, mm. */
  position: number;
  /** Clear width along the wall, mm. */
  width: number;
  /** Height of the opening above the wall's base, mm. */
  sillHeight: number;
  /** Clear height, mm. */
  height: number;
};

export type WallOpeningParams = HostedParams;
export type WallOpening = Element<WallOpeningParams>;

/** Resolves an element's placement and opening size (doors/windows take sizes from their type). */
export type PlacementResolver = (doc: Document, el: Element) => HostedParams;

/** Categories whose elements cut a rectangular hole in their host wall. */
const cutters = new Map<string, PlacementResolver>([[Cat.WallOpening, (_doc, el) => el.params as HostedParams]]);

export function registerWallCutter(category: string, resolve: PlacementResolver): void {
  cutters.set(category, resolve);
}

export function isWallCutter(category: string): boolean {
  return cutters.has(category);
}

/** Placement and cut size of a hosted element. */
export function hostedPlacement(doc: Document, el: Element): HostedParams {
  const resolve = cutters.get(el.category);
  if (!resolve) throw new Error(`${el.category} is not hosted in walls`);
  return resolve(doc, el);
}

const hostDeps = (el: Element) => [(el.params as HostedParams).hostId];

registerCategory({
  name: Cat.WallOpening,
  dependencies: hostDeps,
  // The host's geometry changes with the opening; the opening has none of its own.
  related: (_doc, el) => hostDeps(el),
  cascadeDelete: true,
  isType: false,
});

/** A cut through a wall, in wall coordinates: `u` along the location line, `z` absolute. */
export interface WallCut {
  id: ElementId;
  u0: number;
  u1: number;
  z0: number;
  z1: number;
}

/** Cuts in `wall` from its hosted openings/doors/windows. */
export function wallCuts(doc: Document, wall: Wall): WallCut[] {
  const { bottom } = wallExtent(doc, wall);
  return doc
    .all()
    .filter((e) => cutters.has(e.category) && (e.params as { hostId?: ElementId }).hostId === wall.id)
    .map((e) => {
      const p = hostedPlacement(doc, e);
      return {
        id: e.id,
        u0: p.position - p.width / 2,
        u1: p.position + p.width / 2,
        z0: bottom + p.sillHeight,
        z1: bottom + p.sillHeight + p.height,
      };
    });
}

/** Check a hosted placement fits inside its wall. Throws a user-facing message if not. */
export function validateHosted(doc: Document, p: HostedParams): void {
  const host = doc.get<WallParams>(p.hostId);
  if (!host || host.category !== Cat.Wall) throw new Error("Openings must be hosted by a wall");
  if (!(p.width > 0) || !(p.height > 0)) throw new Error("Opening width and height must be positive");
  if (p.sillHeight < 0) throw new Error("Sill height can't be below the wall base");
  const len = wallLength(host);
  if (p.position - p.width / 2 < 0 || p.position + p.width / 2 > len) throw new Error("Opening runs past the end of the wall");
  const { bottom, top } = wallExtent(doc, host);
  if (p.sillHeight + p.height > top - bottom) throw new Error("Opening is taller than the wall");
}

/** Distance along the wall of the point on its location line closest to `p`, clamped to the wall. */
export function positionAlongWall(wall: Wall, p: Vec2): number {
  const { start, end } = wall.params;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  return Math.max(0, Math.min(len, ((p.x - start.x) * dx + (p.y - start.y) * dy) / len));
}

/** Rectangular opening through a wall (Revit "Wall Opening"). */
export function createWallOpening(
  tx: Transaction,
  doc: Document,
  hostId: ElementId,
  position: number,
  opts: Partial<Omit<WallOpeningParams, "hostId" | "position">> = {},
): WallOpening {
  const params: WallOpeningParams = {
    hostId,
    position,
    width: opts.width ?? 900,
    sillHeight: opts.sillHeight ?? 0,
    height: opts.height ?? 2100,
  };
  validateHosted(doc, params);
  return tx.create<WallOpeningParams>(Cat.WallOpening, params);
}

/**
 * Flip a wall's orientation (Revit's flip arrows): swaps its ends so the exterior face changes side.
 * Hosted elements keep their physical place; doors keep their swing and hinge side.
 */
export function flipWall(tx: Transaction, doc: Document, wallId: ElementId): void {
  const wall = doc.require<WallParams>(wallId) as Wall;
  if (wall.category !== Cat.Wall) throw new Error("Only walls can be flipped");
  const len = wallLength(wall);
  tx.update<WallParams>(wallId, { start: wall.params.end, end: wall.params.start });
  for (const e of doc.all()) {
    if (!cutters.has(e.category)) continue;
    const p = e.params as { hostId?: ElementId; position: number; facingFlipped?: boolean; handFlipped?: boolean };
    if (p.hostId !== wallId) continue;
    const patch: Record<string, number | boolean> = { position: len - p.position };
    if (typeof p.facingFlipped === "boolean") patch.facingFlipped = !p.facingFlipped;
    if (typeof p.handFlipped === "boolean") patch.handFlipped = !p.handFlipped;
    tx.update(e.id, patch);
  }
}
