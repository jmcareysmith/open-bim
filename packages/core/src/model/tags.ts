import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat, ceilingExtent, floorExtent, wallExtent, type Ceiling, type Floor, type LevelParams, type Wall, type WallParams } from "./architecture.ts";
import { DEFAULT_TEXT_SIZE } from "./annotations.ts";
import type { AreaParams } from "./areas.ts";
import type { FamilyInstanceParams } from "./components.ts";
import { hostedPlacement, isWallCutter } from "./openings.ts";
import { roomExtent, type Room, type RoomParams } from "./rooms.ts";
import { isDrawingView, toViewCoords, viewFrame, type View, type ViewParams } from "./viewdefs.ts";

// Tags (Revit: Tag by Category, Keynote). A tag belongs to a view and points at one element; its
// text is read from the element (Mark, type name, room name/number, keynote), so it updates when
// the element changes, and it is placed relative to the element's anchor so it moves with it.

export type TagKind = "category" | "keynote";

export type TagParams = {
  viewId: ElementId;
  hostId: ElementId;
  kind: TagKind;
  /** Tag centre relative to the host's anchor, in view coordinates, mm. */
  offset: Vec2;
  /** Draw a leader from the host's anchor to the tag. */
  leader: boolean;
  /** Text height on paper, mm. */
  size: number;
};
export type Tag = Element<TagParams>;

/** Categories that can be tagged. */
export const TAGGABLE = new Set<string>([
  Cat.Wall,
  Cat.Door,
  Cat.Window,
  Cat.FamilyInstance,
  Cat.Floor,
  Cat.Ceiling,
  Cat.Roof,
  Cat.Room,
  Cat.Area,
]);

registerCategory({
  name: Cat.Tag,
  // Deleting the host deletes its tags; moving it regenerates them.
  dependencies: (el) => [(el.params as TagParams).viewId, (el.params as TagParams).hostId],
  cascadeDelete: true,
  isType: false,
});

/** Instance mark (Revit "Mark"), if set. */
export function elementMark(el: Element): string | undefined {
  const m = (el.params as { mark?: unknown }).mark;
  return typeof m === "string" && m ? m : undefined;
}

/** Point a tag is attached to, in model space. */
export function elementAnchor(doc: Document, el: Element): [number, number, number] | null {
  const level = (id: ElementId) => doc.get<LevelParams>(id)?.params.elevation ?? 0;
  if (isWallCutter(el.category) && (el.category !== Cat.FamilyInstance || (el.params as FamilyInstanceParams).hostId)) {
    const h = hostedPlacement(doc, el);
    const wall = doc.get<WallParams>(h.hostId) as Wall | undefined;
    if (!wall) return null;
    const { start, end } = wall.params;
    const len = Math.hypot(end.x - start.x, end.y - start.y) || 1;
    const t = h.position / len;
    const z = wallExtent(doc, wall).bottom + h.sillHeight + h.height / 2;
    return [start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t, z];
  }
  switch (el.category) {
    case Cat.Wall: {
      const w = el as Wall;
      const { start, end } = w.params;
      const e = wallExtent(doc, w);
      return [(start.x + end.x) / 2, (start.y + end.y) / 2, (e.bottom + e.top) / 2];
    }
    case Cat.FamilyInstance: {
      const p = el.params as FamilyInstanceParams;
      return [p.position.x, p.position.y, level(p.levelId) + p.offset];
    }
    case Cat.Floor:
    case Cat.Ceiling:
    case Cat.Roof: {
      const p = el.params as { boundary: Vec2[]; levelId: ElementId };
      const c = centroid(p.boundary);
      const z = el.category === Cat.Floor ? floorExtent(doc, el as Floor).top : el.category === Cat.Ceiling ? ceilingExtent(doc, el as Ceiling).bottom : level(p.levelId);
      return [c.x, c.y, z];
    }
    case Cat.Room: {
      const r = el as Room;
      return [r.params.point.x, r.params.point.y, roomExtent(doc, r).bottom];
    }
    case Cat.Area: {
      const p = (el.params as AreaParams).point;
      return [p.x, p.y, 0];
    }
    default:
      return null;
  }
}

/** The anchor in a view's 2D space: plan XY, or section/elevation drawing coordinates. */
export function anchorInView(doc: Document, view: View, el: Element): Vec2 | null {
  const a = elementAnchor(doc, el);
  if (!a) return null;
  if (!isDrawingView(view)) return { x: a[0], y: a[1] };
  const [x, y] = toViewCoords(viewFrame(view), a);
  return { x, y };
}

/** Tag text: keynote, or by category (Mark, else type name; rooms show name and number). */
export function tagText(doc: Document, tag: Tag): string {
  const host = doc.get(tag.params.hostId);
  if (!host) return "?";
  if (tag.params.kind === "keynote") return elementKeynote(doc, host) ?? "?";
  switch (host.category) {
    case Cat.Room:
      return `${host.name ?? "Room"} ${(host.params as RoomParams).number}`;
    case Cat.Area:
      return host.name ?? "Area";
    case Cat.FamilyInstance:
      return elementMark(host) ?? (host.params as FamilyInstanceParams).typeName;
    default:
      return elementMark(host) ?? (host.typeId ? (doc.get(host.typeId)?.name ?? "?") : "?");
  }
}

/** Keynote of an element: its own, else its type's (Revit: element and type keynotes). */
export function elementKeynote(doc: Document, el: Element): string | undefined {
  const own = (el.params as { keynote?: unknown }).keynote;
  if (typeof own === "string" && own) return own;
  const type = el.typeId ? doc.get(el.typeId) : undefined;
  const k = type ? (type.params as { keynote?: unknown }).keynote : undefined;
  return typeof k === "string" && k ? k : undefined;
}

/** Where a tag sits in its view (host anchor + offset), or null when the host is gone. */
export function tagPosition(doc: Document, tag: Tag): Vec2 | null {
  const view = doc.get<ViewParams>(tag.params.viewId) as View | undefined;
  const host = doc.get(tag.params.hostId);
  if (!view || !host) return null;
  const a = anchorInView(doc, view, host);
  return a ? { x: a.x + tag.params.offset.x, y: a.y + tag.params.offset.y } : null;
}

/** Next numeric mark among elements of a category ("1", "2", …). */
export function nextMark(doc: Document, category: string): string {
  const used = doc.byCategory(category).map((e) => Number(elementMark(e))).filter(Number.isFinite);
  return String(used.length ? Math.max(...used) + 1 : 1);
}

/**
 * Tag an element at a point in the view. Doors and windows without a Mark are numbered, as
 * Revit numbers them on placement.
 */
export function createTag(
  tx: Transaction,
  doc: Document,
  viewId: ElementId,
  hostId: ElementId,
  at: Vec2,
  opts: { kind?: TagKind; leader?: boolean; size?: number } = {},
): Tag {
  const view = doc.get<ViewParams>(viewId) as View | undefined;
  if (!view || view.category !== Cat.View || view.params.kind === "3d") throw new Error("Tags go in plans, sections and elevations");
  const host = doc.require(hostId);
  if (!TAGGABLE.has(host.category)) throw new Error(`${host.category} elements can't be tagged`);
  const a = anchorInView(doc, view, host);
  if (!a) throw new Error("That element has no tag position");
  const kind = opts.kind ?? "category";
  if (kind === "category" && (host.category === Cat.Door || host.category === Cat.Window) && !elementMark(host)) {
    tx.update(hostId, { mark: nextMark(doc, host.category) });
  }
  return tx.create<TagParams>(Cat.Tag, {
    viewId,
    hostId,
    kind,
    offset: { x: at.x - a.x, y: at.y - a.y },
    leader: opts.leader ?? false,
    size: opts.size ?? DEFAULT_TEXT_SIZE,
  }) as Tag;
}

function centroid(pts: Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    const c = p.x * q.y - q.x * p.y;
    a += c;
    cx += (p.x + q.x) * c;
    cy += (p.y + q.y) * c;
  });
  if (Math.abs(a) < 1e-9) return pts[0] ?? { x: 0, y: 0 };
  return { x: cx / (3 * a), y: cy / (3 * a) };
}
