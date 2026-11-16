import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Params, Vec2 } from "../element.ts";
import { Cat, wallExtent, wallExtentRaw, wallThickness, type LevelParams, type Wall, type WallParams } from "./architecture.ts";
import { columnExtent, type Column, type ColumnParams } from "./structure.ts";
import { elementLine, isLinear, setLineEnds } from "./edits.ts";
import { JOIN_TOLERANCE } from "./joins.ts";
import { transformElements, translation } from "./modify.ts";
import { hostedPlacement, isWallCutter, validateHosted } from "./openings.ts";
import { normaliseFootprint } from "./roofs.ts";
import { validateRegion } from "./sketch.ts";
import { tagPosition, type Tag } from "./tags.ts";
import type { DimensionParams } from "./annotations.ts";
import { calloutHeadPosition, viewFrame, type View, type ViewParams } from "./viewdefs.ts";
import { setGridCurve, setWallCurve, tangentLine } from "./arcs.ts";

/** The middle of an arc (start → end, bowing by `curve` to the left). */
export function arcMid(start: Vec2, end: Vec2, curve: number): Vec2 {
  const c = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  return { x: (start.x + end.x) / 2 - ((end.y - start.y) / c) * curve, y: (start.y + end.y) / 2 + ((end.x - start.x) / c) * curve };
}

// Grips (Revit's drag controls): handles on a selected element that reshape it when dragged —
// line ends, sketch vertices, stair run ends, a door's place along its wall — or move it.
// Temporary dimensions: the editable length of a selected wall or line.

export type GripKind = "end" | "vertex" | "move";

export interface Grip {
  /** What the grip edits: "start"/"end", "v3" (vertex 3), "r0s" (run 0 start), "along", "move". */
  key: string;
  point: Vec2;
  kind: GripKind;
}

const POLYGON = new Set<string>([Cat.Floor, Cat.Ceiling, Cat.Roof, Cat.FilledRegion, Cat.RevisionCloud, Cat.Toposolid]);
const POINT_KEY: Record<string, string> = {
  [Cat.Room]: "point",
  [Cat.Area]: "point",
  [Cat.TextNote]: "position",
  [Cat.Symbol]: "position",
  [Cat.DetailComponent]: "position",
  [Cat.Column]: "position",
  [Cat.PadFooting]: "position",
  [Cat.FamilyInstance]: "position",
  [Cat.LegendComponent]: "position",
  [Cat.KeynoteLegend]: "position",
  [Cat.Viewport]: "centre",
  [Cat.Group]: "origin",
};

const wallHostOf = (el: Element): ElementId | null => {
  const h = (el.params as { hostId?: unknown }).hostId;
  return typeof h === "string" && (isWallCutter(el.category) || el.category === Cat.FamilyInstance) ? h : null;
};
const alongKey = (el: Element) => (el.category === Cat.FamilyInstance ? "along" : "position");

/** The grips a selected element shows. */
export function elementGrips(doc: Document, el: Element): Grip[] {
  const p = el.params as Record<string, unknown>;
  const host = wallHostOf(el);
  if (host) {
    const w = doc.get<WallParams>(host) as Wall | undefined;
    if (!w) return [];
    const l = elementLine(w);
    const t = p[alongKey(el)] as number;
    return [{ key: "along", point: { x: l.point.x + l.dir.x * t, y: l.point.y + l.dir.y * t }, kind: "move" }];
  }
  if (isLinear(el)) {
    const { start, end, curve } = p as { start: Vec2; end: Vec2; curve?: number | null };
    const grips: Grip[] = [
      { key: "start", point: start, kind: "end" },
      { key: "end", point: end, kind: "end" },
    ];
    // Arcs: drag the middle to change how far they bow.
    if (curve) grips.push({ key: "bow", point: arcMid(start, end, curve), kind: "move" });
    return grips;
  }
  if (POLYGON.has(el.category)) return (p.boundary as Vec2[]).map((q, i) => ({ key: `v${i}`, point: q, kind: "vertex" }));
  if (el.category === Cat.Railing && !p.hostId) return (p.path as Vec2[]).map((q, i) => ({ key: `v${i}`, point: q, kind: "vertex" }));
  if (el.category === Cat.Stair || el.category === Cat.Ramp) {
    return (p.runs as { start: Vec2; end: Vec2 }[]).flatMap((r, i) => [
      { key: `r${i}s`, point: r.start, kind: "end" as const },
      { key: `r${i}e`, point: r.end, kind: "end" as const },
    ]);
  }
  if (el.category === Cat.Tag) {
    const at = tagPosition(doc, el as Tag);
    return at ? [{ key: "move", point: at, kind: "move" }] : [];
  }
  if (el.category === Cat.Dimension) return [{ key: "at", point: (p as unknown as DimensionParams).at, kind: "move" }];
  if (el.category === Cat.View) {
    // View extents: the line's ends (width), the far clip (depth); elevations move by their marker.
    const v = el as View;
    const vp = v.params;
    if (vp.line) {
      const f = viewFrame(v);
      const dir = { x: f.dir[0], y: f.dir[1] };
      const { start, end } = vp.line;
      const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      const far = vp.farClip ?? 0;
      const grips: Grip[] = [
        { key: "lstart", point: start, kind: "end" },
        { key: "lend", point: end, kind: "end" },
        { key: "far", point: { x: mid.x + dir.x * far, y: mid.y + dir.y * far }, kind: "end" },
      ];
      if (vp.kind === "elevation") grips.push({ key: "move", point: vp.marker ?? mid, kind: "move" });
      return grips;
    }
    if (vp.crop) {
      return [
        { key: "cmin", point: vp.crop.min, kind: "end" },
        { key: "cmax", point: vp.crop.max, kind: "end" },
        { key: "head", point: calloutHeadPosition(vp)!, kind: "move" },
      ];
    }
    return [];
  }
  const k = POINT_KEY[el.category];
  if (k && (el.category !== Cat.FamilyInstance || !p.hostId)) return [{ key: "move", point: p[k] as Vec2, kind: "move" }];
  return [];
}

/** Wall ends (other than `wallId`'s) sitting on `p`: they follow a dragged corner. */
function joinedEnds(doc: Document, wallId: ElementId, p: Vec2): { wall: Wall; end: "start" | "end" }[] {
  const out: { wall: Wall; end: "start" | "end" }[] = [];
  for (const w of doc.byCategory<WallParams>(Cat.Wall) as Wall[]) {
    if (w.id === wallId) continue;
    for (const end of ["start", "end"] as const) {
      const q = w.params[end];
      if (Math.hypot(q.x - p.x, q.y - p.y) < JOIN_TOLERANCE) out.push({ wall: w, end });
    }
  }
  return out;
}

/**
 * Drag grip `key` of element `id` to `to` (plan mm, or the view's 2D coordinates for annotations).
 * A wall end drags the ends of walls joined there only if they're in `together` (also selected).
 */
export function dragGrip(tx: Transaction, doc: Document, id: ElementId, key: string, to: Vec2, together: ElementId[] = []): void {
  const el = doc.require(id);
  const p = structuredClone(el.params) as Record<string, unknown>;
  const grip = elementGrips(doc, el).find((g) => g.key === key);
  if (!grip) throw new Error(`No grip "${key}" on ${el.category}`);

  if (key === "along") {
    // Slide along the host wall: project onto its line.
    const w = doc.require<WallParams>(wallHostOf(el)!) as Wall;
    const l = elementLine(w);
    const len = Math.hypot(w.params.end.x - w.params.start.x, w.params.end.y - w.params.start.y);
    const t = (to.x - l.point.x) * l.dir.x + (to.y - l.point.y) * l.dir.y;
    tx.update(id, { [alongKey(el)]: Math.min(len, Math.max(0, t)) });
    return;
  }
  if (key === "move") {
    transformElements(tx, doc, [id], translation({ x: to.x - grip.point.x, y: to.y - grip.point.y }));
    return;
  }
  if (key === "at") {
    tx.update(id, { at: { ...to } } as Params);
    return;
  }
  if (el.category === Cat.View) {
    const v = el as View;
    const vp = v.params;
    if (vp.line && (key === "lstart" || key === "lend" || key === "far")) {
      const { start, end } = vp.line;
      const len = Math.hypot(end.x - start.x, end.y - start.y);
      const u = { x: (end.x - start.x) / len, y: (end.y - start.y) / len };
      if (key === "far") {
        const f = viewFrame(v);
        const depth = (to.x - start.x) * f.dir[0] + (to.y - start.y) * f.dir[1];
        tx.update<ViewParams>(id, { farClip: Math.max(100, depth) });
        return;
      }
      // Ends slide along the line, so the view keeps its direction.
      const t = (to.x - start.x) * u.x + (to.y - start.y) * u.y;
      const line = key === "lstart" ? { start: { x: start.x + u.x * Math.min(t, len - 100), y: start.y + u.y * Math.min(t, len - 100) }, end } : { start, end: { x: start.x + u.x * Math.max(t, 100), y: start.y + u.y * Math.max(t, 100) } };
      tx.update<ViewParams>(id, { line });
      return;
    }
    if (vp.crop && key === "head") {
      tx.update<ViewParams>(id, { headPosition: { ...to } });
      return;
    }
    if (vp.crop && (key === "cmin" || key === "cmax")) {
      const other = key === "cmin" ? vp.crop.max : vp.crop.min;
      if (Math.abs(to.x - other.x) < 100 || Math.abs(to.y - other.y) < 100) throw new Error("A callout needs some size");
      tx.update<ViewParams>(id, { crop: { min: { x: Math.min(to.x, other.x), y: Math.min(to.y, other.y) }, max: { x: Math.max(to.x, other.x), y: Math.max(to.y, other.y) } } });
      return;
    }
  }
  if (isLinear(el) && key === "bow") {
    const { start, end } = p as { start: Vec2; end: Vec2 };
    const c = Math.hypot(end.x - start.x, end.y - start.y);
    const n = { x: -(end.y - start.y) / c, y: (end.x - start.x) / c };
    const d = (to.x - (start.x + end.x) / 2) * n.x + (to.y - (start.y + end.y) / 2) * n.y;
    const curve = Math.round(Math.max(-c / 2, Math.min(c / 2, d))) || 1;
    if (el.category === Cat.Wall) setWallCurve(tx, doc, id, curve);
    else setGridCurve(tx, doc, id, curve);
    return;
  }
  if (isLinear(el) && (key === "start" || key === "end")) {
    const { start, end } = p as { start: Vec2; end: Vec2 };
    // Grids and reference planes keep their line: their ends only slide along it (arcs move freely).
    if ((el.category === Cat.Grid || el.category === Cat.ReferencePlane) && !(p as { curve?: number }).curve) {
      const l = elementLine(el);
      const t = (to.x - l.point.x) * l.dir.x + (to.y - l.point.y) * l.dir.y;
      to = { x: l.point.x + l.dir.x * t, y: l.point.y + l.dir.y * t };
    }
    // Joined walls that are selected too follow the corner, so their join holds; others stay put.
    const followers = el.category === Cat.Wall ? joinedEnds(doc, id, key === "start" ? start : end).filter((f) => together.includes(f.wall.id)) : [];
    setLineEnds(tx, doc, el, key === "start" ? to : start, key === "end" ? to : end);
    for (const f of followers) {
      const w = doc.require<WallParams>(f.wall.id) as Wall;
      setLineEnds(tx, doc, w, f.end === "start" ? to : w.params.start, f.end === "end" ? to : w.params.end);
    }
    return;
  }
  const v = /^v(\d+)$/.exec(key);
  if (v) {
    const i = Number(v[1]);
    if (el.category === Cat.Railing) {
      const path = (p.path as Vec2[]).slice();
      path[i] = { ...to };
      tx.update(id, { path } as Params);
      return;
    }
    const boundary = (p.boundary as Vec2[]).slice();
    boundary[i] = { ...to };
    if (el.category === Cat.Roof) {
      tx.update(id, normaliseFootprint(boundary, p.slopes as (number | null)[]) as unknown as Params);
      return;
    }
    if (el.category === Cat.Toposolid || el.category === Cat.RevisionCloud) {
      tx.update(id, { boundary } as Params);
      return;
    }
    const region = validateRegion({ boundary, holes: (p.holes as Vec2[][]) ?? [] });
    tx.update(id, { boundary: region.boundary, holes: region.holes } as unknown as Params);
    return;
  }
  const r = /^r(\d+)([se])$/.exec(key);
  if (r) {
    const runs = (p.runs as { start: Vec2; end: Vec2 }[]).map((x) => ({ ...x }));
    const run = runs[Number(r[1])]!;
    if (r[2] === "s") run.start = { ...to };
    else run.end = { ...to };
    if (Math.hypot(run.end.x - run.start.x, run.end.y - run.start.y) < 1) throw new Error("A run needs a length");
    tx.update(id, { runs } as Params);
    return;
  }
  throw new Error(`Can't drag ${key} on ${el.category}`);
}

/** Temporary dimension: the length of a selected wall or line, editable. */
export function lineLength(el: Element): number | null {
  if (!isLinear(el)) return null;
  const { start, end } = el.params as unknown as { start: Vec2; end: Vec2 };
  return Math.hypot(end.x - start.x, end.y - start.y);
}

/** Set a wall or line's length, keeping its start (Revit: type into the temporary dimension). */
export function setLineLength(tx: Transaction, doc: Document, id: ElementId, length: number): void {
  if (!(length >= 1)) throw new Error("Length must be at least 1 mm");
  const el = doc.require(id);
  const l = elementLine(el);
  const { start, end } = el.params as unknown as { start: Vec2; end: Vec2 };
  const to = { x: l.point.x + l.dir.x * length, y: l.point.y + l.dir.y * length };
  const followers = el.category === Cat.Wall ? joinedEnds(doc, id, end) : [];
  setLineEnds(tx, doc, el, start, to);
  for (const f of followers) {
    const w = doc.require<WallParams>(f.wall.id) as Wall;
    setLineEnds(tx, doc, w, f.end === "start" ? to : w.params.start, f.end === "end" ? to : w.params.end);
  }
}

// ---- shape handles (3D): drag tops and bases up and down -------------------------------------

/**
 * Where a selected element's up/down handles sit: walls and columns have a top and a base; floors
 * their top; ceilings, roofs and free-standing families their base (moving the whole element).
 */
export function verticalHandles(doc: Document, el: Element): { at: Vec2; top: number | null; bottom: number | null } | null {
  const p = el.params as Record<string, unknown>;
  const level = (id: unknown) => (typeof id === "string" ? (doc.get<LevelParams>(id)?.params.elevation ?? 0) : 0);
  const centre = (pts: Vec2[]) => ({ x: pts.reduce((s, q) => s + q.x, 0) / pts.length, y: pts.reduce((s, q) => s + q.y, 0) / pts.length });
  if (el.category === Cat.Wall) {
    const w = el as Wall;
    const { start, end, curve } = w.params;
    const { bottom, top } = wallExtentRaw(doc, w);
    return { at: curve ? arcMid(start, end, curve) : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, top, bottom };
  }
  if (el.category === Cat.Column) {
    const c = el as Column;
    const { bottom, top } = columnExtent(doc, c);
    return { at: c.params.position, top, bottom };
  }
  // Doors, windows, openings and wall-hosted families: their sill, along the wall.
  if (isWallCutter(el.category) && typeof p.hostId === "string" && p.hostId) {
    const host = doc.get<WallParams>(p.hostId) as Wall | undefined;
    if (!host) return null;
    const hp = hostedPlacement(doc, el);
    const t = tangentLine(host, hp.position);
    return { at: { x: t.start.x + t.dir.x * hp.position, y: t.start.y + t.dir.y * hp.position }, top: null, bottom: wallExtent(doc, host).bottom + hp.sillHeight };
  }
  const boundary = Array.isArray(p.boundary) ? (p.boundary as Vec2[]) : null;
  if (el.category === Cat.Floor && boundary?.length) return { at: centre(boundary), top: level(p.levelId) + Number(p.offset ?? 0), bottom: null };
  if (el.category === Cat.Ceiling && boundary?.length) return { at: centre(boundary), top: null, bottom: level(p.levelId) + Number(p.offset ?? 0) };
  if (el.category === Cat.Roof && boundary?.length) return { at: centre(boundary), top: null, bottom: level(p.levelId) + Number(p.baseOffset ?? 0) };
  if (el.category === Cat.FamilyInstance && !p.hostId && p.position && !p.nestedOf) return { at: p.position as Vec2, top: null, bottom: level(p.levelId) + Number(p.offset ?? 0) };
  return null;
}

/**
 * Move an element's top or base to height `z` (absolute mm). Wall/column tops on a level change
 * their offset from it; an unconnected wall top changes its height. A wall/column base changes
 * its offset (an unconnected wall keeps its top); at least 10 mm stays between base and top.
 * Floors (top), ceilings, roofs and free-standing families (base) move to the height.
 */
export function setVerticalEdge(tx: Transaction, doc: Document, id: ElementId, edge: "top" | "base", z: number): void {
  const el = doc.require(id);
  const MIN = 10;
  const p = el.params as Record<string, unknown>;
  const level = (lid: unknown) => (typeof lid === "string" ? doc.require<LevelParams>(lid).params.elevation : 0);
  if (el.category === Cat.Wall) {
    const w = el as Wall;
    const wp = w.params;
    const { bottom, top } = wallExtentRaw(doc, w);
    if (edge === "top") {
      const t = Math.max(z, bottom + MIN);
      if (wp.topAttachId) throw new Error("The top is attached: detach it first (Properties → Detach)");
      if (wp.topLevelId) tx.update<WallParams>(id, { topOffset: Math.round(t - level(wp.topLevelId)) });
      else tx.update<WallParams>(id, { height: Math.round(t - bottom) });
    } else {
      const b = Math.min(z, top - MIN);
      if (wp.baseAttachId) throw new Error("The base is attached: detach it first (Properties → Detach)");
      const base = level(wp.baseLevelId);
      const patch: Partial<WallParams> = { baseOffset: Math.round(b - base) };
      if (!wp.topLevelId) patch.height = Math.round(top - (base + patch.baseOffset!));
      tx.update<WallParams>(id, patch);
    }
    return;
  }
  if (el.category === Cat.Column) {
    const c = el as Column;
    const { bottom, top } = columnExtent(doc, c);
    if (edge === "top") tx.update<ColumnParams>(id, { topOffset: Math.round(Math.max(z, bottom + MIN) - level(c.params.topLevelId)) });
    else tx.update<ColumnParams>(id, { baseOffset: Math.round(Math.min(z, top - MIN) - level(c.params.baseLevelId)) });
    return;
  }
  const h = verticalHandles(doc, el);
  if (!h || (edge === "top" ? h.top : h.bottom) === null) throw new Error(`This element has no ${edge} handle`);
  if (isWallCutter(el.category) && typeof p.hostId === "string" && p.hostId) {
    const host = doc.require<WallParams>(p.hostId) as Wall;
    const sillHeight = Math.max(0, Math.round(z - wallExtent(doc, host).bottom));
    validateHosted(doc, { ...hostedPlacement(doc, el), sillHeight });
    tx.update(id, { sillHeight });
    return;
  }
  const key = el.category === Cat.Roof ? "baseOffset" : "offset";
  tx.update(id, { [key]: Math.round(z - level(p.levelId)) });
}

// ---- temporary dimensions for hosted elements ------------------------------------------------

/**
 * A door's, window's or opening's clearances along its wall (Revit's temporary dimensions): from
 * its edges to the nearest wall face either side (walls teeing in or crossing, else the host's ends).
 * `u` is its centre along the host, `half` half its width.
 */
export function hostedClearances(doc: Document, el: Element): { hostId: ElementId; u: number; half: number; left: { stop: number; dist: number }; right: { stop: number; dist: number } } | null {
  const p = el.params as Record<string, unknown>;
  if (!isWallCutter(el.category) || typeof p.hostId !== "string" || !p.hostId) return null;
  const host = doc.get<WallParams>(p.hostId) as Wall | undefined;
  if (!host || host.params.curve) return null;
  const hp = hostedPlacement(doc, el);
  const { start, end } = host.params;
  const L = Math.hypot(end.x - start.x, end.y - start.y);
  if (L < 1 || !(hp.width > 0)) return null;
  const d = { x: (end.x - start.x) / L, y: (end.y - start.y) / L };
  const half = hp.width / 2;
  const hostHalf = wallThickness(doc, host) / 2;
  // Faces of walls meeting the host along its length.
  const stops = [0, L];
  for (const w of doc.byCategory<WallParams>(Cat.Wall) as Wall[]) {
    if (w.id === host.id || w.params.curve) continue;
    for (const q of [w.params.start, w.params.end]) {
      const u = (q.x - start.x) * d.x + (q.y - start.y) * d.y;
      const v = -(q.x - start.x) * d.y + (q.y - start.y) * d.x;
      if (u <= 1 || u >= L - 1 || Math.abs(v) > hostHalf + 1) continue;
      const t = wallThickness(doc, w) / 2;
      stops.push(u - t, u + t);
    }
  }
  const lo = hp.position - half;
  const hi = hp.position + half;
  const left = Math.max(...stops.filter((s) => s <= lo + 0.5));
  const right = Math.min(...stops.filter((s) => s >= hi - 0.5));
  return { hostId: host.id, u: hp.position, half, left: { stop: left, dist: lo - left }, right: { stop: right, dist: right - hi } };
}

/** Move a hosted element so its `side` clearance is `dist` (validated: it must stay in the wall). */
export function setHostedClearance(tx: Transaction, doc: Document, id: ElementId, side: "left" | "right", dist: number): void {
  const el = doc.require(id);
  const c = hostedClearances(doc, el);
  if (!c) throw new Error("Only doors, windows and openings in straight walls have clearances");
  if (!(dist >= 0)) throw new Error("The distance can't be negative");
  const position = side === "left" ? c.left.stop + dist + c.half : c.right.stop - dist - c.half;
  validateHosted(doc, { ...hostedPlacement(doc, el), position });
  tx.update(id, { [alongKey(el)]: Math.round(position * 10) / 10 });
}
