import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat, type LayeredTypeParams, type WallParams } from "./architecture.ts";

// Arcs for curved walls and grids (Revit: Start-End-Radius Arc). An arc runs from `start` to `end`
// and bows out by `curve`: the sagitta, mm — how far its middle stands off the straight line
// between the ends, positive to the left of start → end. 0 (or unset) is straight.

export type ArcInfo = { center: Vec2; radius: number; a0: number; sweep: number };

/** Centre, radius and angles (from a0, through sweep radians) of the arc start → end bowing by `curve`. */
export function arcInfo(start: Vec2, end: Vec2, curve: number): ArcInfo | null {
  const c = Math.hypot(end.x - start.x, end.y - start.y);
  if (!curve || Math.abs(curve) < 1e-6 || c < 1e-6) return null;
  const n = { x: -(end.y - start.y) / c, y: (end.x - start.x) / c };
  const m = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const R = (c * c) / 4 / (2 * Math.abs(curve)) + Math.abs(curve) / 2;
  const off = curve - Math.sign(curve) * R;
  const center = { x: m.x + n.x * off, y: m.y + n.y * off };
  const a0 = Math.atan2(start.y - center.y, start.x - center.x);
  const a1 = Math.atan2(end.y - center.y, end.x - center.x);
  const mid = { x: m.x + n.x * curve, y: m.y + n.y * curve };
  const am = Math.atan2(mid.y - center.y, mid.x - center.x);
  // Go the way that passes through the arc's middle.
  const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccw = norm(am - a0) < norm(a1 - a0);
  const sweep = ccw ? norm(a1 - a0) : -norm(a0 - a1);
  return { center, radius: R, a0, sweep };
}

/** Points along the arc (ends included), at most `step` radians apart; the straight line when unset. */
export function arcPoints(start: Vec2, end: Vec2, curve: number | null | undefined, step = Math.PI / 36): Vec2[] {
  const a = curve ? arcInfo(start, end, curve) : null;
  if (!a) return [{ ...start }, { ...end }];
  const n = Math.max(2, Math.ceil(Math.abs(a.sweep) / step));
  return Array.from({ length: n + 1 }, (_, i) => {
    if (i === 0) return { ...start };
    if (i === n) return { ...end };
    const t = a.a0 + (a.sweep * i) / n;
    return { x: a.center.x + a.radius * Math.cos(t), y: a.center.y + a.radius * Math.sin(t) };
  });
}

/** Length along the arc (the chord when straight). */
export function arcLength(start: Vec2, end: Vec2, curve: number | null | undefined): number {
  const a = curve ? arcInfo(start, end, curve) : null;
  return a ? Math.abs(a.sweep) * a.radius : Math.hypot(end.x - start.x, end.y - start.y);
}

/** Curved walls and grids: is this one bowed? */
export function isCurved(el: Element): boolean {
  return !!(el.params as { curve?: number | null }).curve;
}

/**
 * The band `half` either side of the arc, counter-clockwise: its right face forwards, then its
 * left face back (as a straight wall's footprint).
 */
export function arcBand(start: Vec2, end: Vec2, curve: number, half: number, step?: number): Vec2[] {
  const a = arcInfo(start, end, curve)!;
  const pts = arcPoints(start, end, curve, step);
  // Left of travel: away from the centre when the arc bows left, towards it when it bows right.
  const leftR = a.radius + half * Math.sign(curve);
  const rightR = a.radius - half * Math.sign(curve);
  const at = (p: Vec2, r: number) => {
    const ux = (p.x - a.center.x) / a.radius;
    const uy = (p.y - a.center.y) / a.radius;
    return { x: a.center.x + ux * r, y: a.center.y + uy * r };
  };
  return [...pts.map((p) => at(p, rightR)), ...[...pts].reverse().map((p) => at(p, leftR))];
}

function validCurve(start: Vec2, end: Vec2, curve: number): void {
  const c = Math.hypot(end.x - start.x, end.y - start.y);
  if (!Number.isFinite(curve)) throw new Error("The curve must be a number");
  if (Math.abs(curve) > c / 2 + 1e-6) throw new Error("A curve can bow out at most half its length (a semicircle)");
}

/** Bow a wall into an arc (0 / null: straight). Curtain and stacked walls stay straight. */
export function setWallCurve(tx: Transaction, doc: Document, id: ElementId, curve: number | null): void {
  const w = doc.require<WallParams>(id);
  if (w.category !== Cat.Wall) throw new Error("Only walls and grids curve");
  if (curve) {
    validCurve(w.params.start, w.params.end, curve);
    const t = w.typeId ? doc.get<LayeredTypeParams>(w.typeId)?.params : undefined;
    if (t?.curtain || t?.stack?.length) throw new Error("Curtain and stacked walls are straight for now");
    const hosted = doc.all().some((e) => (e.params as { hostId?: ElementId }).hostId === id);
    if (hosted) throw new Error("Take the doors, windows and openings out first: curved walls can't host them yet");
  }
  tx.update<WallParams>(id, { curve: curve || null });
}

export function setGridCurve(tx: Transaction, doc: Document, id: ElementId, curve: number | null): void {
  const g = doc.require<{ start: Vec2; end: Vec2; curve?: number | null }>(id);
  if (g.category !== Cat.Grid) throw new Error("Only walls and grids curve");
  if (curve) validCurve(g.params.start, g.params.end, curve);
  tx.update(id, { curve: curve || null });
}
