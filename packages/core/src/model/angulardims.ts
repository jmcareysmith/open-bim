import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { resolveRef, type DimRef } from "./annotations.ts";
import { Cat, wallThickness, type Wall } from "./architecture.ts";
import { arcInfo, type ArcInfo } from "./arcs.ts";
import type { ViewParams } from "./viewdefs.ts";

// Angular and radial dimensions (Revit: Annotate → Dimension → Angular / Radial), plans only.
// Angular: between two line references (walls, grids, reference planes), measured on an arc
// through `at` in the quarter where it was placed. Radial: the radius of an arc wall or grid,
// along the line from its centre through `at`. Both stay live as their references move.

export type AngularDimensionParams = { viewId: ElementId; a: DimRef; b: DimRef; at: Vec2; size: number };
export type RadialDimensionParams = { viewId: ElementId; refId: ElementId; /** Wall faces: which (default centre). */ side?: "left" | "right" | "centre"; at: Vec2; size: number };
export type AngularDimension = Element<AngularDimensionParams>;
export type RadialDimension = Element<RadialDimensionParams>;

const refId = (r: DimRef): ElementId[] => (r.kind === "point" ? [] : [r.id]);

registerCategory({
  name: Cat.AngularDimension,
  dependencies: (el) => {
    const p = el.params as AngularDimensionParams;
    return [p.viewId, ...refId(p.a), ...refId(p.b)];
  },
  cascadeDelete: true,
  isType: false,
});
registerCategory({
  name: Cat.RadialDimension,
  dependencies: (el) => {
    const p = el.params as RadialDimensionParams;
    return [p.viewId, p.refId];
  },
  cascadeDelete: true,
  isType: false,
});

function requirePlan(doc: Document, viewId: ElementId): void {
  const v = doc.require<ViewParams>(viewId);
  if (v.category !== Cat.View || !["floorPlan", "callout", "areaPlan"].includes(v.params.kind)) throw new Error("Angular and radial dimensions go in plans");
}

/** The angle's vertex, its two arms (unit directions towards `at`'s quarter), the radius and the angle (radians). */
export function angularLayout(doc: Document, d: AngularDimension): { o: Vec2; u: Vec2; w: Vec2; r: number; angle: number } {
  const A = resolveRef(doc, d.params.a);
  const B = resolveRef(doc, d.params.b);
  if (!A.dir || !B.dir) throw new Error("Angles are between lines");
  const den = A.dir.x * B.dir.y - A.dir.y * B.dir.x;
  if (Math.abs(den) < 1e-9) throw new Error("Those lines are parallel: no angle between them");
  const t = ((B.point.x - A.point.x) * B.dir.y - (B.point.y - A.point.y) * B.dir.x) / den;
  const o = { x: A.point.x + A.dir.x * t, y: A.point.y + A.dir.y * t };
  const at = d.params.at;
  const v = { x: at.x - o.x, y: at.y - o.y };
  // Each arm points the way that has `at` on its side.
  const side = (dir: Vec2) => (v.x * dir.x + v.y * dir.y >= 0 ? dir : { x: -dir.x, y: -dir.y });
  const u = side(A.dir);
  const w = side(B.dir);
  const angle = Math.acos(Math.max(-1, Math.min(1, u.x * w.x + u.y * w.y)));
  return { o, u, w, r: Math.max(1, Math.hypot(v.x, v.y)), angle };
}

/** An arc reference's centre and radius (wall faces add or take off half the thickness). */
export function radialLayout(doc: Document, d: RadialDimension): { arc: ArcInfo; r: number } {
  const el = doc.require(d.params.refId);
  const p = el.params as { start: Vec2; end: Vec2; curve?: number | null };
  const arc = p.curve ? arcInfo(p.start, p.end, p.curve) : null;
  if (!arc) throw new Error("Radial dimensions measure arcs: curved walls and grids");
  let r = arc.radius;
  if (el.category === Cat.Wall && d.params.side && d.params.side !== "centre") {
    // Left of travel is away from the centre when the arc bows left.
    const h = wallThickness(doc, el as Wall) / 2;
    const away = (d.params.side === "left") === (p.curve! > 0);
    r += away ? h : -h;
  }
  return { arc, r };
}

export function createAngularDimension(tx: Transaction, doc: Document, viewId: ElementId, a: DimRef, b: DimRef, at: Vec2, size = 2.5): AngularDimension {
  requirePlan(doc, viewId);
  const d = tx.create<AngularDimensionParams>(Cat.AngularDimension, { viewId, a, b, at: { ...at }, size }) as AngularDimension;
  angularLayout(doc, d);
  return d;
}

export function createRadialDimension(tx: Transaction, doc: Document, viewId: ElementId, refId: ElementId, at: Vec2, opts: { side?: "left" | "right" | "centre"; size?: number } = {}): RadialDimension {
  requirePlan(doc, viewId);
  const d = tx.create<RadialDimensionParams>(Cat.RadialDimension, { viewId, refId, at: { ...at }, size: opts.size ?? 2.5, ...(opts.side ? { side: opts.side } : {}) }) as RadialDimension;
  radialLayout(doc, d);
  return d;
}
