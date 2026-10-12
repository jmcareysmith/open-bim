import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Params, Vec2 } from "../element.ts";
import { Cat, wallLength, wallThickness, type Wall, type WallParams } from "./architecture.ts";
import { groupOf, moveGroup, placeGroup, type Group, type GroupParams } from "./groups.ts";
import { JOIN_TOLERANCE } from "./joins.ts";
import { isWallCutter } from "./openings.ts";
import { normaliseFootprint } from "./roofs.ts";
import { tagPosition, type Tag, type TagParams } from "./tags.ts";
import type { ViewParams } from "./viewdefs.ts";

// Modify tools (Revit: Move, Copy, Rotate, Mirror, Array). One 2D affine transform drives them
// all: it maps every plan point an element stores. Walls drag the ends of walls joined to them
// (unless disjoined), hosted doors/windows ride on their wall, and a door moved on its own slides
// along its host. Mirroring reverses loop order (sketches stay counter-clockwise) and swaps wall
// ends, so exterior faces, door hands and railing sides come out mirrored.

/** x' = xx·x + xy·y + tx;  y' = yx·x + yy·y + ty. */
export interface Affine {
  xx: number;
  xy: number;
  yx: number;
  yy: number;
  tx: number;
  ty: number;
}

export const IDENTITY: Affine = { xx: 1, xy: 0, yx: 0, yy: 1, tx: 0, ty: 0 };

export function translation(move: Vec2): Affine {
  return { ...IDENTITY, tx: move.x, ty: move.y };
}

/** Rotate by `angle` radians (anticlockwise) about `about`. */
export function rotationAbout(about: Vec2, angle: number): Affine {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { xx: c, xy: -s, yx: s, yy: c, tx: about.x - c * about.x + s * about.y, ty: about.y - s * about.x - c * about.y };
}

/** Reflect across the line through `a` and `b`. */
export function mirrorAcross(a: Vec2, b: Vec2): Affine {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-9) throw new Error("Pick two different points for the mirror axis");
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const xx = 2 * ux * ux - 1;
  const xy = 2 * ux * uy;
  const yy = 2 * uy * uy - 1;
  return { xx, xy, yx: xy, yy, tx: a.x - xx * a.x - xy * a.y, ty: a.y - xy * a.x - yy * a.y };
}

/** `second` after `first`. */
export function compose(second: Affine, first: Affine): Affine {
  return {
    xx: second.xx * first.xx + second.xy * first.yx,
    xy: second.xx * first.xy + second.xy * first.yy,
    yx: second.yx * first.xx + second.yy * first.yx,
    yy: second.yx * first.xy + second.yy * first.yy,
    tx: second.xx * first.tx + second.xy * first.ty + second.tx,
    ty: second.yx * first.tx + second.yy * first.ty + second.ty,
  };
}

export function applyAffine(t: Affine, p: Vec2): Vec2 {
  return { x: t.xx * p.x + t.xy * p.y + t.tx, y: t.yx * p.x + t.yy * p.y + t.ty };
}

/** Apply to a direction (no translation). */
export function applyLinear(t: Affine, v: Vec2): Vec2 {
  return { x: t.xx * v.x + t.xy * v.y, y: t.yx * v.x + t.yy * v.y };
}

export const isMirror = (t: Affine) => t.xx * t.yy - t.xy * t.yx < 0;
const isTranslation = (t: Affine) => Math.abs(t.xx - 1) < 1e-12 && Math.abs(t.yy - 1) < 1e-12 && Math.abs(t.xy) < 1e-12 && Math.abs(t.yx) < 1e-12;
/** A rotation angle θ (about Z) after the transform. */
const mapAngle = (t: Affine, theta: number) => {
  const d = applyLinear(t, { x: Math.cos(theta), y: Math.sin(theta) });
  return Math.atan2(d.y, d.x);
};
const unit = (v: Vec2): Vec2 => {
  const l = Math.hypot(v.x, v.y);
  return { x: v.x / l, y: v.y / l };
};

export interface ModifyOptions {
  /** Keep the originals and transform copies (Revit's Copy / Multiple option). */
  copy?: boolean;
  /** Moving walls drags the ends of walls joined to them, unless disjoined. Ignored for copies. */
  disjoin?: boolean;
}

/** Elements hosted in a wall (doors, windows, openings, wall-hosted components). */
const wallHost = (el: Element): ElementId | null => {
  const p = el.params as { hostId?: unknown };
  if (typeof p.hostId !== "string") return null;
  return isWallCutter(el.category) || el.category === Cat.FamilyInstance ? p.hostId : null;
};
/** Where a wall-hosted element sits along its host: its param name. */
const alongKey = (el: Element) => (el.category === Cat.FamilyInstance ? "along" : "position");

/** Elements a host brings along when copied (doors in walls, railings on stairs, strip footings). */
function dependants(doc: Document, ids: Set<ElementId>): Element[] {
  return doc.all().filter((e) => {
    if (ids.has(e.id)) return false;
    const p = e.params as { hostId?: unknown; wallId?: unknown };
    if (wallHost(e) && ids.has(p.hostId as string)) return true;
    if (e.category === Cat.Railing && typeof p.hostId === "string" && ids.has(p.hostId)) return true;
    if (e.category === Cat.StripFooting && typeof p.wallId === "string" && ids.has(p.wallId)) return true;
    return false;
  });
}

/** Ids an element refers to that a copy should remap to the matching copy. */
function remapRefs(p: Record<string, unknown>, map: Map<ElementId, ElementId>): void {
  for (const key of ["hostId", "wallId"]) if (typeof p[key] === "string" && map.has(p[key] as string)) p[key] = map.get(p[key] as string);
  if (Array.isArray(p.refs)) p.refs = (p.refs as { id?: string }[]).map((r) => (r.id && map.has(r.id) ? { ...r, id: map.get(r.id) } : r));
}

const MOVABLE = new Set<string>([
  Cat.Wall, Cat.Floor, Cat.Ceiling, Cat.Roof, Cat.Grid, Cat.ReferencePlane, Cat.Door, Cat.Window, Cat.WallOpening,
  Cat.FamilyInstance, Cat.Room, Cat.RoomSeparator, Cat.Area, Cat.AreaBoundary, Cat.DetailLine, Cat.FilledRegion,
  Cat.TextNote, Cat.Dimension, Cat.Tag, Cat.RevisionCloud, Cat.LegendComponent, Cat.KeynoteLegend, Cat.DirectShape,
  Cat.CadImport, Cat.Link, Cat.Stair, Cat.Ramp, Cat.Railing, Cat.Toposolid, Cat.Column, Cat.Beam, Cat.PadFooting,
  Cat.StripFooting, Cat.Viewport, Cat.View, Cat.Group, Cat.Symbol,
]);

/** Can this element be moved/copied with the modify tools? */
export function isModifiable(el: Element): boolean {
  if (!MOVABLE.has(el.category)) return false;
  if (el.category === Cat.View) return ["section", "elevation", "callout"].includes((el.params as ViewParams).kind);
  return true;
}

interface Ctx {
  doc: Document;
  t: Affine;
  mirror: boolean;
  /** Everything transformed together (selection + dependants). */
  set: Set<ElementId>;
}

const mapPts = (t: Affine, pts: Vec2[], reverse: boolean) => {
  const out = pts.map((p) => applyAffine(t, p));
  return reverse ? out.reverse() : out;
};

/** New params for `el` under the transform. Returns null when nothing changes (it rides on a host). */
function transformed(c: Ctx, el: Element): Record<string, unknown> | null {
  const { doc, t, mirror, set } = c;
  const p = structuredClone(el.params) as Record<string, unknown>;
  const pt = (k: string) => {
    if (p[k]) p[k] = applyAffine(t, p[k] as Vec2);
  };
  const loop = (k: string) => {
    if (Array.isArray(p[k])) p[k] = mapPts(t, p[k] as Vec2[], mirror);
  };
  const holes = () => {
    if (Array.isArray(p.holes)) p.holes = (p.holes as Vec2[][]).map((h) => mapPts(t, h, mirror));
  };
  const host = wallHost(el);
  if (host) {
    const k = alongKey(el);
    if (set.has(host)) {
      // Rides on its wall. A mirrored wall swaps its ends, so measure from the other end.
      if (!mirror) return null;
      const len = wallLength(doc.require<WallParams>(host) as Wall);
      p[k] = len - (p[k] as number);
      if (typeof p.handFlipped === "boolean") p.handFlipped = !p.handFlipped;
      return p;
    }
    // On its own it slides along its wall.
    if (!isTranslation(t)) throw new Error("Doors, windows and openings move along their wall; they can't be rotated or mirrored on their own");
    const wall = doc.require<WallParams>(host) as Wall;
    const d = unit({ x: wall.params.end.x - wall.params.start.x, y: wall.params.end.y - wall.params.start.y });
    p[k] = Math.min(wallLength(wall), Math.max(0, (p[k] as number) + t.tx * d.x + t.ty * d.y));
    return p;
  }
  switch (el.category) {
    case Cat.Wall:
    case Cat.Beam:
    case Cat.Grid:
    case Cat.ReferencePlane:
    case Cat.RoomSeparator:
    case Cat.AreaBoundary:
    case Cat.DetailLine: {
      const a = applyAffine(t, p.start as Vec2);
      const b = applyAffine(t, p.end as Vec2);
      // Walls swap ends when mirrored so the exterior face is mirrored too.
      [p.start, p.end] = mirror && el.category === Cat.Wall ? [b, a] : [a, b];
      return p;
    }
    case Cat.Floor:
    case Cat.Ceiling:
    case Cat.FilledRegion:
    case Cat.RevisionCloud:
      loop("boundary");
      holes();
      return p;
    case Cat.Roof: {
      const b = (p.boundary as Vec2[]).map((q) => applyAffine(t, q));
      Object.assign(p, normaliseFootprint(b, p.slopes as (number | null)[]));
      return p;
    }
    case Cat.Toposolid:
      loop("boundary");
      p.points = (p.points as { x: number; y: number; z: number }[]).map((q) => ({ ...applyAffine(t, q), z: q.z }));
      return p;
    case Cat.Room:
    case Cat.Area:
      pt("point");
      return p;
    case Cat.Symbol:
      pt("position");
      p.rotation = mapAngle(t, p.rotation as number);
      return p;
    case Cat.TextNote:
    case Cat.LegendComponent:
    case Cat.KeynoteLegend:
      pt("position");
      return p;
    case Cat.FamilyInstance:
    case Cat.Column:
    case Cat.PadFooting:
      pt("position");
      if (typeof p.rotation === "number") p.rotation = mapAngle(t, p.rotation);
      return p;
    case Cat.Stair:
    case Cat.Ramp:
      p.runs = (p.runs as { start: Vec2; end: Vec2 }[]).map((r) => ({ ...r, start: applyAffine(t, r.start), end: applyAffine(t, r.end) }));
      return p;
    case Cat.Railing: {
      const stair = p.hostId as string | null;
      if (stair) {
        // On a stair it follows the stair; mirroring puts it on the stair's other side.
        if (!set.has(stair)) throw new Error("Railings on stairs move with their stair");
        if (!mirror) return null;
        p.side = p.side === "left" ? "right" : "left";
        return p;
      }
      p.path = (p.path as Vec2[]).map((q) => applyAffine(t, q));
      return p;
    }
    case Cat.StripFooting:
      if (!set.has(p.wallId as string)) throw new Error("Strip footings move with their wall");
      return null;
    case Cat.DirectShape: {
      const pos = (p.positions as number[]).slice();
      for (let i = 0; i < pos.length; i += 3) {
        const q = applyAffine(t, { x: pos[i]!, y: pos[i + 1]! });
        pos[i] = q.x;
        pos[i + 1] = q.y;
      }
      p.positions = pos;
      // Mirroring turns triangles inside out; flip their winding.
      if (mirror) {
        const idx = (p.indices as number[]).slice();
        for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2]!, idx[i + 1]!];
        p.indices = idx;
      }
      return p;
    }
    case Cat.CadImport: {
      // Bake the offset in so rotations and mirrors work on the line work itself.
      const o = p.offset as Vec2;
      const seg = (p.segments as number[]).slice();
      for (let i = 0; i < seg.length; i += 2) {
        const q = applyAffine(t, { x: seg[i]! + o.x, y: seg[i + 1]! + o.y });
        seg[i] = q.x;
        seg[i + 1] = q.y;
      }
      p.segments = seg;
      p.texts = (p.texts as { x: number; y: number }[]).map((q) => ({ ...q, ...applyAffine(t, { x: q.x + o.x, y: q.y + o.y }) }));
      p.offset = { x: 0, y: 0 };
      return p;
    }
    case Cat.Link: {
      if (mirror) throw new Error("Links can't be mirrored");
      const o = p.offset as { x: number; y: number; z: number };
      p.offset = { ...applyAffine(t, o), z: o.z };
      p.rotation = (p.rotation as number) + mapAngle(t, 0);
      return p;
    }
    case Cat.Viewport:
      if (!isTranslation(t)) throw new Error("Viewports can only be moved");
      pt("centre");
      return p;
    case Cat.View: {
      const v = p as unknown as ViewParams;
      if (v.line) {
        const a = applyAffine(t, v.line.start);
        const b = applyAffine(t, v.line.end);
        // A section looks to the left of its line; swap the ends so a mirrored one looks the mirrored way.
        p.line = mirror ? { start: b, end: a } : { start: a, end: b };
      }
      if (v.crop) {
        if (!isTranslation(t)) throw new Error("Callouts can only be moved");
        p.crop = { min: applyAffine(t, v.crop.min), max: applyAffine(t, v.crop.max) };
      }
      return p;
    }
    case Cat.Tag: {
      const tag = el as Tag;
      if (set.has(tag.params.hostId)) {
        // Tag and host move together: in plans the offset turns with them.
        const view = doc.get<ViewParams>(tag.params.viewId);
        if (view && (view.params.kind === "floorPlan" || view.params.kind === "callout" || view.params.kind === "areaPlan")) {
          p.offset = applyLinear(t, tag.params.offset);
          return p;
        }
        return null;
      }
      const at = tagPosition(doc, tag);
      if (!at) return null;
      const to = applyAffine(t, at);
      p.offset = { x: tag.params.offset.x + to.x - at.x, y: tag.params.offset.y + to.y - at.y } satisfies TagParams["offset"];
      return p;
    }
    case Cat.Dimension: {
      const refs = p.refs as { kind: string; id?: string; pick?: Vec2; at?: Vec2 }[];
      if (!isTranslation(t) && refs.some((r) => r.id && !set.has(r.id))) {
        throw new Error("Dimensions rotate or mirror only together with what they measure");
      }
      p.refs = refs.map((r) => (r.kind === "point" ? { ...r, at: applyAffine(t, r.at!) } : { ...r, pick: applyAffine(t, r.pick!) }));
      p.dir = unit(applyLinear(t, p.dir as Vec2));
      pt("at");
      return p;
    }
  }
  throw new Error(`${el.category} can't be moved this way`);
}

/** Wall ends (of walls not being moved) joined to the moved walls follow them. */
function dragJoinedWalls(tx: Transaction, doc: Document, t: Affine, moved: Wall[], set: Set<ElementId>): void {
  const others = (doc.byCategory<WallParams>(Cat.Wall) as Wall[]).filter((w) => !set.has(w.id));
  for (const o of others) {
    const patch: Partial<WallParams> = {};
    for (const end of ["start", "end"] as const) {
      const q = o.params[end];
      for (const w of moved) {
        const { start: a, end: b } = w.params;
        if (Math.hypot(q.x - a.x, q.y - a.y) < JOIN_TOLERANCE || Math.hypot(q.x - b.x, q.y - b.y) < JOIN_TOLERANCE) {
          patch[end] = applyAffine(t, q);
          break;
        }
        // A tee: this end butts into the moved wall's side; keep it on the wall's new line.
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
        const along = (q.x - a.x) * d.x + (q.y - a.y) * d.y;
        const off = Math.abs((q.x - a.x) * d.y - (q.y - a.y) * d.x);
        if (along < -JOIN_TOLERANCE || along > len + JOIN_TOLERANCE || off > wallThickness(doc, w) / 2 + JOIN_TOLERANCE) continue;
        // Keep the same offset from the moved wall's (new) centreline, along this wall's own line.
        const other = o.params[end === "start" ? "end" : "start"];
        const od = unit({ x: q.x - other.x, y: q.y - other.y });
        const n = { x: d.y, y: -d.x };
        const side = (q.x - a.x) * n.x + (q.y - a.y) * n.y;
        const p0 = applyAffine(t, { x: a.x + n.x * side, y: a.y + n.y * side });
        const nd = applyLinear(t, d);
        const den = od.x * nd.y - od.y * nd.x;
        if (Math.abs(den) < 1e-6) continue;
        const s = ((p0.x - other.x) * nd.y - (p0.y - other.y) * nd.x) / den;
        patch[end] = { x: other.x + od.x * s, y: other.y + od.y * s };
        break;
      }
    }
    if (patch.start || patch.end) tx.update<WallParams>(o.id, patch);
  }
}

/**
 * Move (or copy) elements by a plan transform. Returns the moved elements, or the copies.
 * Dependants come along: doors with walls, railings with stairs, members with groups.
 */
export function transformElements(tx: Transaction, doc: Document, ids: ElementId[], t: Affine, opts: ModifyOptions = {}): ElementId[] {
  const picked = [...new Set(ids)].map((id) => doc.require(id));
  for (const el of picked) {
    if (!isModifiable(el)) throw new Error(`${el.category} can't be moved this way`);
    const g = groupOf(el);
    if (g && !picked.some((e) => e.id === g)) throw new Error("That element is in a group; move the group or ungroup it first");
  }
  const mirror = isMirror(t);
  const groups = picked.filter((e) => e.category === Cat.Group) as Group[];
  if (mirror && groups.length) throw new Error("Groups can't be mirrored yet");
  const loose = picked.filter((e) => e.category !== Cat.Group && !groupOf(e));
  const set = new Set(loose.map((e) => e.id));
  const all = opts.copy ? [...loose, ...dependants(doc, set)] : loose;
  for (const e of all) set.add(e.id);
  const c: Ctx = { doc, t, mirror, set };
  const out: ElementId[] = [];

  // Groups move rigidly (rotation about any point = rotate about the origin + translate).
  for (const g of groups) {
    const origin = applyAffine(t, g.params.origin);
    const rotation = g.params.rotation + mapAngle(t, 0);
    if (opts.copy) out.push(placeGroup(tx, doc, g.id, origin, rotation).id);
    else {
      moveGroup(tx, doc, g.id, origin, rotation);
      out.push(g.id);
    }
  }

  if (opts.copy) {
    // Hosts before what they host, so references can be remapped to the copies.
    const order = (e: Element) => {
      const p = e.params as { hostId?: unknown; wallId?: unknown; refs?: unknown };
      return e.category === Cat.Tag || e.category === Cat.Dimension ? 2 : typeof p.hostId === "string" || typeof p.wallId === "string" ? 1 : 0;
    };
    const map = new Map<ElementId, ElementId>();
    for (const e of [...all].sort((a, b) => order(a) - order(b))) {
      const p = (transformed(c, e) ?? structuredClone(e.params)) as Record<string, unknown>;
      remapRefs(p, map);
      const copy = tx.create(e.category, p as Params, { ...(e.name !== undefined ? { name: e.name } : {}), ...(e.typeId ? { typeId: e.typeId } : {}) });
      map.set(e.id, copy.id);
      if (loose.some((l) => l.id === e.id)) out.push(copy.id);
    }
    return out;
  }

  // In place: hosted elements in moved walls only change when mirrored; collect them first.
  const riders = mirror ? dependants(doc, set) : [];
  const walls = loose.filter((e) => e.category === Cat.Wall) as Wall[];
  const before = walls.map((w) => ({ ...w, params: structuredClone(w.params) }) as Wall);
  for (const e of [...riders, ...loose]) {
    const p = transformed(c, e);
    if (p) tx.update(e.id, p as Params);
  }
  if (walls.length && !opts.disjoin) dragJoinedWalls(tx, doc, t, before, set);
  out.push(...loose.map((e) => e.id));
  return out;
}

/** The transform applied `k` times. */
export function repeat(t: Affine, k: number): Affine {
  let r = IDENTITY;
  for (let i = 0; i < k; i++) r = compose(t, r);
  return r;
}

/**
 * Array (Revit AR): `count` items in total including the originals, each `step` on from the last
 * (a translation for linear arrays, a rotation for radial ones). Returns the copies per item.
 */
export function arrayElements(tx: Transaction, doc: Document, ids: ElementId[], step: Affine, count: number): ElementId[][] {
  if (!Number.isInteger(count) || count < 2) throw new Error("An array needs at least 2 items");
  const out: ElementId[][] = [];
  for (let k = 1; k < count; k++) out.push(transformElements(tx, doc, ids, repeat(step, k), { copy: true }));
  return out;
}

/** Plan points an element stores (hosted elements use their host's), for centring rotations. */
export function planPoints(doc: Document, el: Element): Vec2[] {
  const host = wallHost(el);
  if (host) {
    const w = doc.get<WallParams>(host);
    return w ? [w.params.start, w.params.end] : [];
  }
  const p = el.params as Record<string, unknown>;
  const isV = (v: unknown): v is Vec2 => !!v && typeof (v as Vec2).x === "number" && typeof (v as Vec2).y === "number";
  const out: Vec2[] = [];
  for (const k of ["start", "end", "point", "position", "at", "centre", "origin"]) if (isV(p[k])) out.push(p[k] as Vec2);
  for (const k of ["boundary", "path"]) if (Array.isArray(p[k])) out.push(...(p[k] as Vec2[]));
  if (Array.isArray(p.runs)) for (const r of p.runs as { start: Vec2; end: Vec2 }[]) out.push(r.start, r.end);
  const line = (p as { line?: { start: Vec2; end: Vec2 } | null }).line;
  if (line) out.push(line.start, line.end);
  return out;
}

/** Centre of the selection's plan extents (Revit's default centre of rotation). */
export function selectionCentre(doc: Document, ids: ElementId[]): Vec2 | null {
  const pts = ids.flatMap((id) => {
    const el = doc.get(id);
    if (!el) return [];
    if (el.category === Cat.Group) return [(el.params as GroupParams).origin];
    return planPoints(doc, el);
  });
  if (!pts.length) return null;
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}
