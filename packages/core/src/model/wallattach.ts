import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import {
  Cat,
  ceilingExtent,
  floorExtent,
  floorThickness,
  floorTopAt,
  setWallAttachHook,
  wallExtentRaw,
  wallLength,
  type Ceiling,
  type Floor,
  type Wall,
  type WallParams,
} from "./architecture.ts";
import { roofBaseElevation, roofHeightAt, roofPlanes, type Roof, type RoofPlane } from "./roofs.ts";

// Wall attach (Revit: Attach Top/Base). A wall's top can attach to a roof (following the roof's
// underside, slopes and all), a floor or a ceiling above (their underside); its base can attach to
// a floor below (its top). The unattached top/base values stay, and come back on detach.

export const TOP_ATTACH = new Set<string>([Cat.Roof, Cat.Floor, Cat.Ceiling]);
export const BASE_ATTACH = new Set<string>([Cat.Floor]);

const roofCache = new WeakMap<object, RoofPlane[]>();
function planesOf(roof: Roof): RoofPlane[] {
  let p = roofCache.get(roof.params);
  if (!p) roofCache.set(roof.params, (p = roofPlanes(roof.params.boundary, roof.params.slopes)));
  return p;
}

const target = (doc: Document, id: ElementId | null | undefined): Element | undefined => (id ? doc.get(id) : undefined);

/** Height of what the wall's top is attached to at plan point `p`, or null when not attached. */
export function attachedTopAt(doc: Document, wall: Wall, p: Vec2): number | null {
  const t = target(doc, wall.params.topAttachId);
  if (!t) return null;
  if (t.category === Cat.Roof) return roofBaseElevation(doc, t as Roof) + roofHeightAt(planesOf(t as Roof), p);
  if (t.category === Cat.Floor) return floorTopAt(doc, t as Floor, p) - floorThickness(doc, t as Floor);
  if (t.category === Cat.Ceiling) return ceilingExtent(doc, t as Ceiling).bottom;
  return null;
}

/** Base height from an attached floor (its top), or null. */
export function attachedBase(doc: Document, wall: Wall): number | null {
  const t = target(doc, wall.params.baseAttachId);
  return t?.category === Cat.Floor ? floorExtent(doc, t as Floor).top : null;
}

/** True when the top follows a sloped roof (so it isn't one height). */
export function hasSlopedTop(doc: Document, wall: Wall): boolean {
  const t = target(doc, wall.params.topAttachId);
  if (t?.category === Cat.Floor) return !!(t as Floor).params.slope;
  return t?.category === Cat.Roof && (t as Roof).params.slopes.some((s) => s !== null);
}

const at = (wall: Wall, u: number): Vec2 => {
  const { start, end } = wall.params;
  const L = wallLength(wall);
  return { x: start.x + ((end.x - start.x) * u) / L, y: start.y + ((end.y - start.y) * u) / L };
};

/**
 * Where along the wall (mm from its start) the attached top changes slope — ridges, hips and
 * valleys crossing it — plus both ends. Found by sampling every 50 mm and intersecting the straight
 * runs either side of each change, so the kinks land where the roof planes actually meet.
 */
export function wallTopBreaks(doc: Document, wall: Wall): number[] {
  const L = wallLength(wall);
  if (!hasSlopedTop(doc, wall)) return [0, L];
  const n = Math.max(16, Math.ceil(L / 50));
  const us = Array.from({ length: n + 1 }, (_, i) => (L * i) / n);
  const zs = us.map((u) => attachedTopAt(doc, wall, at(wall, u)) ?? 0);
  const slope = (i: number) => (zs[i + 1]! - zs[i]!) / (us[i + 1]! - us[i]!);
  const out = [0];
  for (let i = 0; i + 1 < n; i++) {
    if (Math.abs(slope(i) - slope(i + 1)) < 1e-6) continue;
    // Kink inside interval i or i+1: intersect the runs on either side.
    const s1 = i > 0 ? slope(i - 1) : slope(i);
    const s2 = i + 2 < n ? slope(i + 2) : slope(i + 1);
    const u1 = us[i]!;
    const u2 = us[i + 2]!;
    let u = us[i + 1]!;
    if (Math.abs(s1 - s2) > 1e-9) u = (zs[i + 2]! - zs[i]! + s1 * u1 - s2 * u2) / (s1 - s2);
    u = Math.max(us[Math.max(0, i - 1)]!, Math.min(us[Math.min(n, i + 3)]!, u));
    if (u > out.at(-1)! + 1 && u < L - 1) out.push(u);
  }
  out.push(L);
  return out;
}

// Wall heights everywhere (schedules, doors, rooms…) respect attachments; a sloped top reports its
// highest point along the wall.
setWallAttachHook((doc, wall, ext) => {
  const bottom = attachedBase(doc, wall) ?? ext.bottom;
  let top = ext.top;
  if (target(doc, wall.params.topAttachId)) {
    const zs = wallTopBreaks(doc, wall).map((u) => attachedTopAt(doc, wall, at(wall, u)) ?? ext.top);
    top = Math.max(...zs);
  }
  return top > bottom ? { bottom, top } : ext;
});

/** Attach a wall's top (to a roof, floor or ceiling) or base (to a floor). */
export function attachWall(tx: Transaction, doc: Document, wallId: ElementId, end: "top" | "base", targetId: ElementId): void {
  const wall = doc.require<WallParams>(wallId) as Wall;
  if (wall.category !== Cat.Wall) throw new Error("Only walls attach");
  const t = doc.require(targetId);
  const ok = end === "top" ? TOP_ATTACH : BASE_ATTACH;
  if (!ok.has(t.category)) throw new Error(end === "top" ? "A wall's top attaches to a roof, floor or ceiling" : "A wall's base attaches to a floor");
  tx.update<WallParams>(wallId, end === "top" ? { topAttachId: targetId } : { baseAttachId: targetId });
  const after = doc.require<WallParams>(wallId) as Wall;
  // Refuse attachments that would turn the wall inside out.
  const raw = wallExtentRaw(doc, after);
  const base = attachedBase(doc, after) ?? raw.bottom;
  const tops = after.params.topAttachId ? wallTopBreaks(doc, after).map((u) => attachedTopAt(doc, after, at(after, u)) ?? raw.top) : [raw.top];
  if (tops.some((z) => z <= base + 1)) throw new Error("That would put the wall's top at or below its base");
}

export function detachWall(tx: Transaction, doc: Document, wallId: ElementId, end: "top" | "base"): void {
  tx.update<WallParams>(wallId, end === "top" ? { topAttachId: null } : { baseAttachId: null });
}

