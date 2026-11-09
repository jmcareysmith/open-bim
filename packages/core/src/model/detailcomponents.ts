import { registerCategory } from "../categories.ts";
import { Document, type DocumentJSON, type Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import type { DetailLineParams, FilledRegionParams, LineStyle, TextNoteParams } from "./annotations.ts";
import { Cat } from "./architecture.ts";
import type { FamilyDef, FamilyDefParams } from "./components.ts";
import type { ViewParams } from "./viewdefs.ts";

// Detail components (Revit: Annotate → Detail → Component). A "Detail Item" family is 2D: detail
// lines and filled regions drawn full size in its plan view, about the origin where its centre
// reference planes cross. An instance belongs to a view, sits at a point with a rotation (and can
// be mirrored), and draws the family's line work there at true size, like any other detail.

export type DetailComponentParams = {
  viewId: ElementId;
  familyId: ElementId;
  position: Vec2;
  /** Radians anticlockwise. */
  rotation: number;
  /** Mirrored across its own Y axis (Revit's flip). */
  mirrored: boolean;
  /**
   * Repeating Detail Component (Revit): copies from `position` along the line to `end`, every
   * `spacing` mm, each turned along the line (`rotation` is then the line's direction).
   */
  repeat?: { end: Vec2; spacing: number } | null;
};
export type DetailComponent = Element<DetailComponentParams>;

registerCategory({
  name: Cat.DetailComponent,
  dependencies: (el) => {
    const p = el.params as DetailComponentParams;
    return [p.viewId, p.familyId];
  },
  cascadeDelete: true,
  isType: false,
});

/** A detail family's 2D content, in family coordinates (mm). */
export interface DetailContent {
  lines: { start: Vec2; end: Vec2; style: LineStyle }[];
  regions: { boundary: Vec2[]; holes: Vec2[][]; color: number }[];
  /** Text notes; `size` is their height in family units (paper mm × the family view's scale). */
  texts: { position: Vec2; text: string; size: number }[];
}

const cache = new WeakMap<object, DetailContent>();

/** The detail lines and filled regions in a Detail Item family (cached per loaded version). */
export function detailContent(def: FamilyDef): DetailContent {
  const json = def.params.json as unknown as DocumentJSON;
  const hit = cache.get(json);
  if (hit) return hit;
  const fam = Document.fromJSON(json);
  const content: DetailContent = {
    lines: fam.byCategory<DetailLineParams>(Cat.DetailLine).map((l) => ({ start: l.params.start, end: l.params.end, style: l.params.style })),
    regions: fam.byCategory<FilledRegionParams>(Cat.FilledRegion).map((r) => ({ boundary: r.params.boundary, holes: r.params.holes, color: r.params.color })),
    texts: fam.byCategory<TextNoteParams>(Cat.TextNote).map((t) => ({
      position: t.params.position,
      text: t.params.text,
      size: t.params.size * ((fam.get(t.params.viewId)?.params as ViewParams | undefined)?.scale ?? 1),
    })),
  };
  cache.set(json, content);
  return content;
}

export function isDetailFamily(def: Element): boolean {
  return def.category === Cat.FamilyDef && (def.params as FamilyDefParams).category === "DetailItem";
}

export function createDetailComponent(
  tx: Transaction,
  doc: Document,
  viewId: ElementId,
  familyId: ElementId,
  position: Vec2,
  opts: { rotation?: number; mirrored?: boolean } = {},
): DetailComponent {
  const def = doc.require(familyId);
  if (!isDetailFamily(def)) throw new Error("Detail components come from Detail Item families");
  const view = doc.require<ViewParams>(viewId);
  if (view.category !== Cat.View || view.params.kind === "3d" || view.params.kind === "legend") throw new Error("Place detail components in plans, sections, elevations or drafting views");
  return tx.create<DetailComponentParams>(Cat.DetailComponent, { viewId, familyId, position: { ...position }, rotation: opts.rotation ?? 0, mirrored: opts.mirrored ?? false }, { name: def.name ?? "Detail" }) as DetailComponent;
}

/** Family coordinates → the view: mirror (across family Y), rotate, then move to the position. */
/** How wide a detail family is along its X (its natural repeat), mm; 100 when it has no line work. */
export function detailWidth(def: FamilyDef): number {
  const c = detailContent(def);
  const xs = [...c.lines.flatMap((l) => [l.start.x, l.end.x]), ...c.regions.flatMap((r) => r.boundary.map((q) => q.x))];
  const w = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  return w > 1 ? w : 100;
}

/** A repeating detail: the family repeated from `start` to `end` at its own width (or `spacing`). */
export function createRepeatingDetail(tx: Transaction, doc: Document, viewId: ElementId, familyId: ElementId, start: Vec2, end: Vec2, spacing?: number): DetailComponent {
  const len = Math.hypot(end.x - start.x, end.y - start.y);
  if (len < 1) throw new Error("Draw the repeating detail along a line");
  const def = doc.require(familyId) as FamilyDef;
  const el = createDetailComponent(tx, doc, viewId, familyId, start, { rotation: Math.atan2(end.y - start.y, end.x - start.x) });
  tx.update<DetailComponentParams>(el.id, { repeat: { end: { ...end }, spacing: spacing ?? detailWidth(def) } });
  return doc.require(el.id) as DetailComponent;
}

/** Where each copy of a (repeating) detail component sits: its own position, or one per spacing along its line. */
export function detailCopies(p: DetailComponentParams): DetailComponentParams[] {
  const r = p.repeat;
  if (!r) return [p];
  const len = Math.hypot(r.end.x - p.position.x, r.end.y - p.position.y);
  const step = Math.max(1, r.spacing);
  const n = Math.min(2000, Math.floor(len / step + 1e-6));
  const d = len > 0 ? { x: (r.end.x - p.position.x) / len, y: (r.end.y - p.position.y) / len } : { x: 1, y: 0 };
  const rotation = Math.atan2(d.y, d.x);
  return Array.from({ length: n + 1 }, (_, i) => ({ ...p, rotation, position: { x: p.position.x + d.x * step * i, y: p.position.y + d.y * step * i } }));
}

export function detailTransform(p: DetailComponentParams): (q: Vec2) => Vec2 {
  const c = Math.cos(p.rotation);
  const s = Math.sin(p.rotation);
  return (q) => {
    const x = p.mirrored ? -q.x : q.x;
    return { x: p.position.x + x * c - q.y * s, y: p.position.y + x * s + q.y * c };
  };
}
