import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Params, Vec2 } from "../element.ts";
import { Cat, type Wall, type WallParams } from "./architecture.ts";
import { elementLine, isLinear, setLineEnds } from "./edits.ts";
import { JOIN_TOLERANCE } from "./joins.ts";
import { transformElements, translation } from "./modify.ts";
import { isWallCutter } from "./openings.ts";
import { normaliseFootprint } from "./roofs.ts";
import { validateRegion } from "./sketch.ts";
import { tagPosition, type Tag } from "./tags.ts";
import type { DimensionParams } from "./annotations.ts";

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
    const { start, end } = p as { start: Vec2; end: Vec2 };
    return [
      { key: "start", point: start, kind: "end" },
      { key: "end", point: end, kind: "end" },
    ];
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
  if (isLinear(el) && (key === "start" || key === "end")) {
    const { start, end } = p as { start: Vec2; end: Vec2 };
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
