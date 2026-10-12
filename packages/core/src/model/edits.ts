import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Params, Vec2 } from "../element.ts";
import { Cat, wallLength, wallThickness, type Wall } from "./architecture.ts";
import { hostedPlacement, isWallCutter } from "./openings.ts";
import { transformElements, translation } from "./modify.ts";

// Align (AL), Offset (OF), Trim/Extend (TR) and Split (SL) for linear elements: walls, beams,
// grids, reference planes, detail lines, room separators and area boundaries. Each works on
// lines (a point and unit direction); walls offer their centreline and both faces.

export interface Line2 {
  point: Vec2;
  /** Unit direction. */
  dir: Vec2;
}

const LINEAR = new Set<string>([Cat.Wall, Cat.Beam, Cat.Grid, Cat.ReferencePlane, Cat.DetailLine, Cat.RoomSeparator, Cat.AreaBoundary]);
const SPLITTABLE = new Set<string>([Cat.Wall, Cat.Beam, Cat.DetailLine, Cat.RoomSeparator, Cat.AreaBoundary]);
const POLYGONS = new Set<string>([Cat.Floor, Cat.Ceiling, Cat.Roof, Cat.FilledRegion, Cat.Toposolid]);

export const isLinear = (el: Element) => LINEAR.has(el.category);

type Seg = { start: Vec2; end: Vec2 };
const seg = (el: Element) => el.params as unknown as Seg;
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
const unit = (v: Vec2): Vec2 => {
  const l = Math.hypot(v.x, v.y);
  return { x: v.x / l, y: v.y / l };
};
const along = (l: Line2, p: Vec2) => dot(sub(p, l.point), l.dir);
const at = (l: Line2, t: number): Vec2 => ({ x: l.point.x + l.dir.x * t, y: l.point.y + l.dir.y * t });

/** The element's own line (start → end). */
export function elementLine(el: Element): Line2 {
  if (!isLinear(el)) throw new Error(`${el.category} isn't a line`);
  const { start, end } = seg(el);
  return { point: start, dir: unit(sub(end, start)) };
}

/** Lines an element offers for aligning to: wall centreline and faces, segments, polygon edges. */
export function referenceLines(doc: Document, el: Element): Line2[] {
  if (el.category === Cat.Wall) {
    const c = elementLine(el);
    const n = { x: -c.dir.y, y: c.dir.x };
    const h = wallThickness(doc, el as Wall) / 2;
    return [c, { point: at({ point: c.point, dir: n }, h), dir: c.dir }, { point: at({ point: c.point, dir: n }, -h), dir: c.dir }];
  }
  if (isLinear(el)) return [elementLine(el)];
  if (POLYGONS.has(el.category)) {
    const b = (el.params as { boundary: Vec2[] }).boundary;
    return b.map((p, i) => ({ point: p, dir: unit(sub(b[(i + 1) % b.length]!, p)) }));
  }
  return [];
}

const distance = (l: Line2, p: Vec2) => Math.abs(cross(l.dir, sub(p, l.point)));

/** The reference line of `el` nearest a picked point (e.g. the wall face clicked). */
export function nearestLine(doc: Document, el: Element, pick: Vec2): Line2 | null {
  let best: Line2 | null = null;
  for (const l of referenceLines(doc, el)) if (!best || distance(l, pick) < distance(best, pick)) best = l;
  return best;
}

export function intersectLines(a: Line2, b: Line2): Vec2 | null {
  const den = cross(a.dir, b.dir);
  if (Math.abs(den) < 1e-9) return null;
  return at(a, cross(sub(b.point, a.point), b.dir) / den);
}

/** Lines closer to parallel than this (sine of the angle) can be aligned. */
const PARALLEL = Math.sin((0.1 * Math.PI) / 180);

/** Translation that puts `target` on `ref` (perpendicular to them). Throws unless parallel. */
export function alignMove(ref: Line2, target: Line2): Vec2 {
  if (Math.abs(cross(ref.dir, target.dir)) > PARALLEL) throw new Error("Align needs parallel lines");
  const n = { x: -ref.dir.y, y: ref.dir.x };
  const d = dot(sub(ref.point, target.point), n);
  return { x: n.x * d, y: n.y * d };
}

/** Align (AL): move `targetId` so its picked line lies on `ref`. Joined walls follow. */
export function alignElement(tx: Transaction, doc: Document, ref: Line2, targetId: ElementId, pick: Vec2): void {
  const el = doc.require(targetId);
  const line = nearestLine(doc, el, pick);
  if (!line) throw new Error(`${el.category} has no edges to align`);
  const move = alignMove(ref, line);
  if (Math.hypot(move.x, move.y) < 1e-6) return;
  transformElements(tx, doc, [targetId], translation(move));
}

/** Offset (OF): copy (or move) linear elements parallel by `dist`, towards `side`. */
export function offsetElements(tx: Transaction, doc: Document, ids: ElementId[], dist: number, side: Vec2, copy = true): ElementId[] {
  if (!(dist > 0)) throw new Error("Offset needs a distance above zero");
  const out: ElementId[] = [];
  for (const id of ids) {
    const el = doc.require(id);
    if (!isLinear(el)) throw new Error(`${el.category} can't be offset`);
    const l = elementLine(el);
    let n = { x: -l.dir.y, y: l.dir.x };
    if (dot(sub(side, l.point), n) < 0) n = { x: -n.x, y: -n.y };
    out.push(...transformElements(tx, doc, [id], translation({ x: n.x * dist, y: n.y * dist }), { copy }));
  }
  return out;
}

/** Elements hosted along a wall (doors, windows, openings, wall-hosted components). */
function hostedOn(doc: Document, wallId: ElementId): Element[] {
  return doc.all().filter((e) => {
    const h = (e.params as { hostId?: unknown }).hostId;
    return h === wallId && (isWallCutter(e.category) || e.category === Cat.FamilyInstance);
  });
}
const alongKey = (el: Element) => (el.category === Cat.FamilyInstance ? "along" : "position");
const hostedWidth = (doc: Document, el: Element) => (isWallCutter(el.category) ? hostedPlacement(doc, el).width : 0);

/** Move one end of a linear element, keeping hosted elements where they are. */
export function setLineEnds(tx: Transaction, doc: Document, el: Element, start: Vec2, end: Vec2): void {
  if (Math.hypot(end.x - start.x, end.y - start.y) < 1) throw new Error("That would leave the element with no length");
  if (el.category === Cat.Wall) {
    const old = elementLine(el);
    // Hosted positions are measured from the start; if the start moves they shift.
    const shift = along(old, start);
    const len = Math.hypot(end.x - start.x, end.y - start.y);
    for (const h of hostedOn(doc, el.id)) {
      const k = alongKey(h);
      const pos = (h.params as Record<string, number>)[k]! - shift;
      const half = hostedWidth(doc, h) / 2;
      if (pos - half < -1e-6 || pos + half > len + 1e-6) throw new Error("That would cut a door, window or opening off the wall");
      if (shift) tx.update(h.id, { [k]: pos });
    }
  }
  tx.update(el.id, { start: { ...start }, end: { ...end } } as Params);
}

/** Trim/Extend (TR) one element to a boundary line, keeping the part on the `keep` side. */
export function trimExtend(tx: Transaction, doc: Document, id: ElementId, keep: Vec2, to: Line2): void {
  const el = doc.require(id);
  const l = elementLine(el);
  const x = intersectLines(l, to);
  if (!x) throw new Error("The lines are parallel; they never meet");
  const { start, end } = seg(el);
  // Keep the side of the intersection the user clicked: the end beyond it is trimmed back, or
  // the end short of it extended.
  if (along(l, keep) <= along(l, x)) setLineEnds(tx, doc, el, start, x);
  else setLineEnds(tx, doc, el, x, end);
}

/** Trim/Extend to corner: both elements meet at their lines' intersection. */
export function trimToCorner(tx: Transaction, doc: Document, aId: ElementId, aKeep: Vec2, bId: ElementId, bKeep: Vec2): void {
  if (aId === bId) throw new Error("Pick two different elements");
  const a = elementLine(doc.require(aId));
  const b = elementLine(doc.require(bId));
  trimExtend(tx, doc, aId, aKeep, b);
  trimExtend(tx, doc, bId, bKeep, a);
}

/** Split (SL): cut a linear element in two at a point; returns the new (second) element. */
export function splitElement(tx: Transaction, doc: Document, id: ElementId, point: Vec2): ElementId {
  const el = doc.require(id);
  if (!SPLITTABLE.has(el.category)) throw new Error(`${el.category} can't be split`);
  const l = elementLine(el);
  const { start, end } = seg(el);
  const len = Math.hypot(end.x - start.x, end.y - start.y);
  const d = along(l, point);
  if (d < 1 || d > len - 1) throw new Error("Split inside the element, away from its ends");
  const cut = at(l, d);
  const hosted = el.category === Cat.Wall ? hostedOn(doc, id) : [];
  for (const h of hosted) {
    const pos = (h.params as Record<string, number>)[alongKey(h)]!;
    if (Math.abs(pos - d) < hostedWidth(doc, h) / 2) throw new Error("Can't split through a door, window or opening");
  }
  const p = { ...structuredClone(el.params), start: cut, end: { ...end } } as Params;
  const second = tx.create(el.category, p, { ...(el.name !== undefined ? { name: el.name } : {}), ...(el.typeId ? { typeId: el.typeId } : {}) });
  tx.update(id, { end: cut } as Params);
  for (const h of hosted) {
    const k = alongKey(h);
    const pos = (h.params as Record<string, number>)[k]!;
    if (pos > d) tx.update(h.id, { hostId: second.id, [k]: pos - d });
  }
  // Strip footings follow the split too.
  for (const f of doc.byCategory(Cat.StripFooting)) {
    if ((f.params as { wallId?: unknown }).wallId === id) tx.create(Cat.StripFooting, { ...structuredClone(f.params), wallId: second.id }, f.typeId ? { typeId: f.typeId } : {});
  }
  return second.id;
}

/** Length of a wall or line, for status messages. */
export const linearLength = (el: Element) => (el.category === Cat.Wall ? wallLength(el as Wall) : Math.hypot(seg(el).end.x - seg(el).start.x, seg(el).end.y - seg(el).start.y));
