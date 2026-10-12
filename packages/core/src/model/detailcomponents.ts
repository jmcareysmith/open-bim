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
  if (view.category !== Cat.View || view.params.kind === "3d" || view.params.kind === "legend") throw new Error("Place detail components in plans, sections or elevations");
  return tx.create<DetailComponentParams>(Cat.DetailComponent, { viewId, familyId, position: { ...position }, rotation: opts.rotation ?? 0, mirrored: opts.mirrored ?? false }, { name: def.name ?? "Detail" }) as DetailComponent;
}

/** Family coordinates → the view: mirror (across family Y), rotate, then move to the position. */
export function detailTransform(p: DetailComponentParams): (q: Vec2) => Vec2 {
  const c = Math.cos(p.rotation);
  const s = Math.sin(p.rotation);
  return (q) => {
    const x = p.mirrored ? -q.x : q.x;
    return { x: p.position.x + x * c - q.y * s, y: p.position.y + x * s + q.y * c };
  };
}
