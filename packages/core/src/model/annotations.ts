import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat, wallThickness, type LevelParams, type Wall, type WallParams } from "./architecture.ts";
import type { DatumLineParams } from "./datums.ts";
import { validateRegion } from "./sketch.ts";
import type { ViewParams } from "./viewdefs.ts";

// View-specific annotation (Revit "detail" elements): owned by one view, drawn only there, in that
// view's 2D space — model XY for plans/callouts, drawing coordinates (x along, y = Z) for
// sections/elevations. Deleting the view deletes them.

export type LineStyle = "thin" | "medium" | "wide" | "hidden";

export type DetailLineParams = { viewId: ElementId; start: Vec2; end: Vec2; style: LineStyle };
export type FilledRegionParams = {
  viewId: ElementId;
  boundary: Vec2[];
  holes: Vec2[][];
  /** Fill colour as 0xRRGGBB; patterns come with materials. */
  color: number;
};
export type TextNoteParams = {
  viewId: ElementId;
  position: Vec2;
  text: string;
  /** Text height on paper, mm (scaled by the view scale in the model). */
  size: number;
};

/**
 * A dimension reference. Line references (wall faces, grids, reference planes, levels) are
 * re-resolved on every regeneration, which is what makes dimensions live: `pick` is where the user
 * clicked, and the measured point is that pick projected onto the reference's current position.
 */
export type DimRef =
  | { kind: "wallFace"; id: ElementId; side: "left" | "right" | "centre"; pick: Vec2 }
  | { kind: "datum"; id: ElementId; pick: Vec2 }
  | { kind: "level"; id: ElementId; pick: Vec2 }
  | { kind: "point"; at: Vec2 };

export type DimensionParams = {
  viewId: ElementId;
  refs: DimRef[];
  /** Unit vector the dimension measures along (perpendicular to the references). */
  dir: Vec2;
  /** A point the dimension line passes through. */
  at: Vec2;
  /** Text height on paper, mm. */
  size: number;
  /** Families: parameter whose value this (two-reference) dimension drives. */
  label?: string | null;
  /** Families: keep all segments equal (Revit's EQ). */
  equality?: boolean;
};

export type DetailLine = Element<DetailLineParams>;
export type FilledRegion = Element<FilledRegionParams>;
export type TextNote = Element<TextNoteParams>;
export type Dimension = Element<DimensionParams>;

/** Revit default annotation text height, mm on paper. */
export const DEFAULT_TEXT_SIZE = 2.5;

export const ANNOTATION_CATEGORIES = [Cat.DetailLine, Cat.FilledRegion, Cat.TextNote, Cat.Dimension, Cat.Area, Cat.AreaBoundary] as const;

const refIds = (r: DimRef): ElementId[] => (r.kind === "point" ? [] : [r.id]);

for (const name of [Cat.DetailLine, Cat.FilledRegion, Cat.TextNote]) {
  registerCategory({ name, dependencies: (el) => [(el.params as { viewId: ElementId }).viewId], cascadeDelete: true, isType: false });
}
registerCategory({
  name: Cat.Dimension,
  // Referenced elements are dependencies: moving them regenerates the dimension, deleting them deletes it.
  dependencies: (el) => {
    const p = el.params as DimensionParams;
    return [p.viewId, ...p.refs.flatMap(refIds)];
  },
  cascadeDelete: true,
  isType: false,
});

/** The view that owns an annotation, or undefined for model elements. */
export function annotationView(el: Element): ElementId | undefined {
  return (ANNOTATION_CATEGORIES as readonly string[]).includes(el.category) ? (el.params as { viewId: ElementId }).viewId : undefined;
}

function requireView(doc: Document, viewId: ElementId): Element<ViewParams> {
  const v = doc.require<ViewParams>(viewId);
  if (v.category !== Cat.View) throw new Error("Annotations belong to a view");
  if (v.params.kind === "3d") throw new Error("Annotate in plans, sections or elevations, not 3D views");
  return v;
}

export function createDetailLine(tx: Transaction, doc: Document, viewId: ElementId, start: Vec2, end: Vec2, style: LineStyle = "medium"): DetailLine {
  requireView(doc, viewId);
  if (Math.hypot(end.x - start.x, end.y - start.y) < 1) throw new Error("Detail line must have non-zero length");
  return tx.create<DetailLineParams>(Cat.DetailLine, { viewId, start, end, style });
}

export function createFilledRegion(
  tx: Transaction,
  doc: Document,
  viewId: ElementId,
  boundary: Vec2[],
  opts: { holes?: Vec2[][]; color?: number } = {},
): FilledRegion {
  requireView(doc, viewId);
  const region = validateRegion({ boundary, holes: opts.holes ?? [] });
  return tx.create<FilledRegionParams>(Cat.FilledRegion, { viewId, ...region, color: opts.color ?? 0x7a8494 });
}

export function createTextNote(tx: Transaction, doc: Document, viewId: ElementId, position: Vec2, text: string, size = DEFAULT_TEXT_SIZE): TextNote {
  requireView(doc, viewId);
  if (!text.trim()) throw new Error("Text can't be empty");
  if (!(size > 0)) throw new Error("Text size must be positive");
  return tx.create<TextNoteParams>(Cat.TextNote, { viewId, position, text, size });
}

/** Height of annotation text in model mm for a view (paper size × scale). */
export function modelTextSize(doc: Document, viewId: ElementId, paperSize: number): number {
  return paperSize * (doc.get<ViewParams>(viewId)?.params.scale ?? 100);
}

// ---- dimensions --------------------------------------------------------------

/** A reference resolved to a line (point + unit direction), or a bare point. */
export interface ResolvedRef {
  point: Vec2;
  dir: Vec2 | null;
}

const unit = (v: Vec2): Vec2 => {
  const l = Math.hypot(v.x, v.y);
  return { x: v.x / l, y: v.y / l };
};

/** Where a reference is now, in its view's 2D space. Throws if a referenced element is gone. */
export function resolveRef(doc: Document, ref: DimRef): ResolvedRef {
  switch (ref.kind) {
    case "point":
      return { point: ref.at, dir: null };
    case "wallFace": {
      const w = doc.require<WallParams>(ref.id) as Wall;
      const d = unit({ x: w.params.end.x - w.params.start.x, y: w.params.end.y - w.params.start.y });
      const off = ref.side === "centre" ? 0 : (ref.side === "left" ? 1 : -1) * (wallThickness(doc, w) / 2);
      return { point: { x: w.params.start.x - d.y * off, y: w.params.start.y + d.x * off }, dir: d };
    }
    case "datum": {
      const g = doc.require<DatumLineParams>(ref.id);
      return { point: g.params.start, dir: unit({ x: g.params.end.x - g.params.start.x, y: g.params.end.y - g.params.start.y }) };
    }
    case "level": {
      // In sections/elevations: a horizontal line at the level's elevation (drawing y = Z).
      const l = doc.require<LevelParams>(ref.id);
      return { point: { x: 0, y: l.params.elevation }, dir: { x: 1, y: 0 } };
    }
  }
}

/** The measured point of a reference: its pick projected onto where the reference is now. */
export function refPoint(doc: Document, ref: DimRef): Vec2 {
  const r = resolveRef(doc, ref);
  if (!r.dir || ref.kind === "point") return r.point;
  const t = (ref.pick.x - r.point.x) * r.dir.x + (ref.pick.y - r.point.y) * r.dir.y;
  return { x: r.point.x + r.dir.x * t, y: r.point.y + r.dir.y * t };
}

export interface DimensionLayout {
  /** Measured points on each reference, in reference order. */
  points: Vec2[];
  /** Points on the dimension line for each reference, sorted along `dir`. */
  ticks: Vec2[];
  /** Segment lengths between consecutive ticks, mm. */
  values: number[];
}

/** Live geometry and values of a dimension. */
export function dimensionLayout(doc: Document, dim: Dimension): DimensionLayout {
  const { refs, dir, at } = dim.params;
  const points = refs.map((r) => refPoint(doc, r));
  const along = (p: Vec2) => p.x * dir.x + p.y * dir.y;
  const base = along(at);
  const ticks = points
    .map((p) => along(p))
    .sort((a, b) => a - b)
    .map((s) => ({ x: at.x + dir.x * (s - base), y: at.y + dir.y * (s - base) }));
  const values = ticks.slice(1).map((t, i) => Math.hypot(t.x - ticks[i]!.x, t.y - ticks[i]!.y));
  return { points, ticks, values };
}

/**
 * Aligned dimension across parallel references. `dir` defaults to the normal of the first line
 * reference; references not parallel to it are rejected.
 */
export function createDimension(
  tx: Transaction,
  doc: Document,
  viewId: ElementId,
  refs: DimRef[],
  at: Vec2,
  opts: { dir?: Vec2; size?: number } = {},
): Dimension {
  requireView(doc, viewId);
  if (refs.length < 2) throw new Error("A dimension needs at least two references");
  const lines = refs.map((r) => resolveRef(doc, r));
  const first = lines.find((l) => l.dir);
  let dir = opts.dir ? unit(opts.dir) : first?.dir ? { x: -first.dir.y, y: first.dir.x } : null;
  if (!dir) throw new Error("Give a direction when dimensioning between points");
  // Point the dimension from the first reference towards the last, so values read in pick order.
  const pts = refs.map((r) => refPoint(doc, r));
  const span = (pts.at(-1)!.x - pts[0]!.x) * dir.x + (pts.at(-1)!.y - pts[0]!.y) * dir.y;
  if (span < 0) dir = { x: -dir.x, y: -dir.y };
  for (const l of lines) {
    if (l.dir && Math.abs(l.dir.x * dir.x + l.dir.y * dir.y) > 1e-3) throw new Error("Dimension references must be parallel");
  }
  return tx.create<DimensionParams>(Cat.Dimension, { viewId, refs, dir, at, size: opts.size ?? DEFAULT_TEXT_SIZE });
}
