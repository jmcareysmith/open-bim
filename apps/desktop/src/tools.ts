import {
  Cat,
  closestPointOnDatum,
  createGrid,
  createWall,
  createReferencePlane,
  datumIntersection,
  datumLines,
  levels,
  nextGridName,
  type Grid,
  type DatumLine,
  type Document,
  type Element,
  type Transaction,
  type ElementId,
  type LevelParams,
  type Vec2,
  type Wall,
  type WallParams,
  totalThickness,
  type LayeredTypeParams,
} from "@open-bim/core";
import { buildGridLines, buildReferencePlaneLines, extrudePolygon, wallFootprint, type LineData } from "@open-bim/geometry";
import type { Viewport } from "./viewport.ts";

export interface ToolContext {
  doc: Document;
  viewport: Viewport;
  activeLevelId(): ElementId;
  activeWallTypeId(): ElementId;
  selection(): ElementId[];
  setSelection(ids: ElementId[]): void;
  status(text: string): void;
}

export interface Tool {
  readonly name: string;
  activate?(): void;
  deactivate?(): void;
  pointerMove?(ev: PointerEvent): void;
  click?(ev: PointerEvent): void;
  /** Return true if the key was handled. */
  key?(ev: KeyboardEvent): boolean;
}

// ---- Select ---------------------------------------------------------------

export class SelectTool implements Tool {
  readonly name = "select";
  constructor(private ctx: ToolContext) {}

  activate(): void {
    this.ctx.status("Select: click an element. Shift+click to add. Delete to remove. Middle-drag pan, right-drag orbit.");
  }

  click(ev: PointerEvent): void {
    const id = this.ctx.viewport.pick(ev);
    if (!id) {
      if (!ev.shiftKey) this.ctx.setSelection([]);
      return;
    }
    if (ev.shiftKey) {
      const cur = new Set(this.ctx.selection());
      if (cur.has(id)) cur.delete(id);
      else cur.add(id);
      this.ctx.setSelection([...cur]);
    } else {
      this.ctx.setSelection([id]);
    }
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key === "Delete" || ev.key === "Backspace") {
      const ids = this.ctx.selection();
      if (!ids.length) return false;
      try {
        this.ctx.doc.transact(`Delete ${ids.length} element(s)`, (tx) => ids.forEach((id) => tx.delete(id)));
        this.ctx.setSelection([]);
      } catch (err) {
        this.ctx.status(String((err as Error).message));
      }
      return true;
    }
    return false;
  }
}

// ---- Snapping ---------------------------------------------------------------

const INCREMENT = 50; // mm snap increment
const POINT_SNAP = 300; // mm, wall/grid endpoints and grid intersections
const LINE_SNAP = 200; // mm, onto grid lines
const ORTHO_DEG = 4;

export interface Snapped {
  p: Vec2;
  /** What the point snapped to, for status feedback. */
  kind: "endpoint" | "intersection" | "grid" | "increment";
}

/**
 * Snap a plan point. Priority: wall endpoints on the active level and grid endpoints,
 * grid intersections, grid lines (staying ortho to `start` when ortho applies), then the
 * 50 mm increment. `free` (Shift) turns off ortho.
 */
export function snapPoint(ctx: ToolContext, p: Vec2, start: Vec2 | null, free: boolean): Snapped {
  const grids = datumLines(ctx.doc); // grids and reference planes
  const nearest = (pts: Vec2[]) => {
    let best: Vec2 | null = null;
    let bestD = POINT_SNAP;
    for (const q of pts) {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bestD) [best, bestD] = [q, d];
    }
    return best;
  };

  // 1. Endpoints
  const ends: Vec2[] = grids.flatMap((g) => [g.params.start, g.params.end]);
  for (const w of ctx.doc.byCategory<WallParams>(Cat.Wall)) {
    if (w.params.baseLevelId === ctx.activeLevelId()) ends.push(w.params.start, w.params.end);
  }
  const end = nearest(ends);
  if (end) return { p: { ...end }, kind: "endpoint" };

  // 2. Grid intersections
  const crossings: Vec2[] = [];
  for (let i = 0; i < grids.length; i++) {
    for (let j = i + 1; j < grids.length; j++) {
      const x = datumIntersection(grids[i]!, grids[j]!);
      if (x) crossings.push(x);
    }
  }
  const cross = nearest(crossings);
  if (cross) return { p: cross, kind: "intersection" };

  // 3. Ortho to start point
  let q = { ...p };
  let locked: "x" | "y" | null = null; // coordinate held equal to the start point's
  if (start && !free) {
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    const ang = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI) % 90;
    if (ang < ORTHO_DEG || ang > 90 - ORTHO_DEG) {
      if (Math.abs(dx) > Math.abs(dy)) [q, locked] = [{ x: p.x, y: start.y }, "y"];
      else [q, locked] = [{ x: start.x, y: p.y }, "x"];
    }
  }

  // 4. Onto a grid line (along the ortho line when locked)
  for (const g of grids) {
    const c = closestPointOnDatum(g, q);
    if (Math.hypot(c.x - q.x, c.y - q.y) > LINE_SNAP) continue;
    if (!locked) return { p: c, kind: "grid" };
    const on = orthoOnGrid(g, start!, locked);
    if (on && Math.hypot(on.x - q.x, on.y - q.y) <= LINE_SNAP) return { p: on, kind: "grid" };
  }

  // 5. Increment
  const r = (v: number) => Math.round(v / INCREMENT) * INCREMENT;
  if (locked === "x") return { p: { x: q.x, y: r(q.y) }, kind: "increment" };
  if (locked === "y") return { p: { x: r(q.x), y: q.y }, kind: "increment" };
  return { p: { x: r(q.x), y: r(q.y) }, kind: "increment" };
}

/** Where the ortho line through `start` (with coordinate `locked` held) crosses grid `g`. */
function orthoOnGrid(g: DatumLine, start: Vec2, locked: "x" | "y"): Vec2 | null {
  const { start: a, end: b } = g.params;
  const free = locked === "x" ? "y" : "x";
  const d = b[locked] - a[locked];
  if (Math.abs(d) < 1e-9) return null; // grid parallel to the ortho line
  const t = (start[locked] - a[locked]) / d;
  if (t < 0 || t > 1) return null;
  const v = a[free] + (b[free] - a[free]) * t;
  return locked === "x" ? { x: start.x, y: v } : { x: v, y: start.y };
}

const SNAP_LABEL: Record<Snapped["kind"], string> = {
  endpoint: " · snap: endpoint",
  intersection: " · snap: grid intersection",
  grid: " · snap: grid / reference plane",
  increment: "",
};

// ---- Wall -----------------------------------------------------------------

export class WallTool implements Tool {
  readonly name = "wall";
  private start: Vec2 | null = null;

  constructor(private ctx: ToolContext) {}

  activate(): void {
    this.start = null;
    this.ctx.status("Wall: click start point, then end point. Walls chain; Esc to finish. Shift = free angle.");
  }

  deactivate(): void {
    this.start = null;
    this.ctx.viewport.setPreview(null);
  }

  private levelElevation(): number {
    return this.ctx.doc.require<LevelParams>(this.ctx.activeLevelId()).params.elevation;
  }

  /** Next level above the active one; walls are top-constrained to it. */
  private topLevelId(): ElementId | null {
    const all = levels(this.ctx.doc);
    const i = all.findIndex((l) => l.id === this.ctx.activeLevelId());
    return all[i + 1]?.id ?? null;
  }

  private snapped: Snapped | null = null;

  private point(ev: PointerEvent): Vec2 | null {
    const p = this.ctx.viewport.pickPlane(ev, this.levelElevation());
    this.snapped = p && snapPoint(this.ctx, p, this.start, ev.shiftKey);
    return this.snapped?.p ?? null;
  }

  pointerMove(ev: PointerEvent): void {
    const p = this.point(ev);
    if (!p || !this.start) {
      this.ctx.viewport.setPreview(null);
      return;
    }
    const len = Math.hypot(p.x - this.start.x, p.y - this.start.y);
    if (len < 1) {
      this.ctx.viewport.setPreview(null);
      return;
    }
    const type = this.ctx.doc.require<LayeredTypeParams>(this.ctx.activeWallTypeId());
    const z0 = this.levelElevation();
    const top = this.topLevelId();
    const z1 = top ? this.ctx.doc.require<LevelParams>(top).params.elevation : z0 + 2400;
    this.ctx.viewport.setPreview(extrudePolygon(wallFootprint(this.start, p, totalThickness(type)), [], z0, z1));
    this.ctx.status(`Wall length: ${Math.round(len)} mm${SNAP_LABEL[this.snapped!.kind]}`);
  }

  click(ev: PointerEvent): void {
    const p = this.point(ev);
    if (!p) return;
    if (!this.start) {
      this.start = p;
      return;
    }
    if (Math.hypot(p.x - this.start.x, p.y - this.start.y) < 10) return;
    const start = this.start;
    let wall: Wall | undefined;
    this.ctx.doc.transact("Create wall", (tx) => {
      wall = createWall(tx, this.ctx.activeWallTypeId(), start, p, this.ctx.activeLevelId(), {
        topLevelId: this.topLevelId(),
      });
    });
    this.start = p;
    if (wall) this.ctx.setSelection([wall.id]);
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key === "Escape" && this.start) {
      this.start = null;
      this.ctx.viewport.setPreview(null);
      this.ctx.status("Wall: click start point.");
      return true;
    }
    return false;
  }
}

// ---- Datum lines (grids, reference planes) -----------------------------------

interface DatumLineKind {
  readonly name: string;
  /** Label for status prompts, e.g. "Grid 4" or "Reference plane". */
  label(doc: Document): string;
  preview(doc: Document, start: Vec2, end: Vec2): LineData;
  create(tx: Transaction, doc: Document, start: Vec2, end: Vec2): Element;
  readonly txName: string;
}

/** Click a start point, then an end point. Snaps like the wall tool; no chaining. */
class DatumLineTool implements Tool {
  readonly name: string;
  private start: Vec2 | null = null;

  constructor(
    private ctx: ToolContext,
    private kind: DatumLineKind,
  ) {
    this.name = kind.name;
  }

  activate(): void {
    this.start = null;
    this.prompt();
  }

  deactivate(): void {
    this.start = null;
    this.ctx.viewport.setPreviewLines(null);
  }

  private prompt(): void {
    this.ctx.status(`${this.kind.label(this.ctx.doc)}: click start point, then end point. Shift = free angle.`);
  }

  private point(ev: PointerEvent): Snapped | null {
    const elevation = this.ctx.doc.require<LevelParams>(this.ctx.activeLevelId()).params.elevation;
    const p = this.ctx.viewport.pickPlane(ev, elevation);
    return p && snapPoint(this.ctx, p, this.start, ev.shiftKey);
  }

  pointerMove(ev: PointerEvent): void {
    const s = this.point(ev);
    const len = s && this.start ? Math.hypot(s.p.x - this.start.x, s.p.y - this.start.y) : 0;
    if (!s || !this.start || len < 1) {
      this.ctx.viewport.setPreviewLines(null);
      return;
    }
    this.ctx.viewport.setPreviewLines(this.kind.preview(this.ctx.doc, this.start, s.p));
    this.ctx.status(`${this.kind.label(this.ctx.doc)} length: ${Math.round(len)} mm${SNAP_LABEL[s.kind]}`);
  }

  click(ev: PointerEvent): void {
    const s = this.point(ev);
    if (!s) return;
    if (!this.start) {
      this.start = s.p;
      return;
    }
    if (Math.hypot(s.p.x - this.start.x, s.p.y - this.start.y) < 10) return;
    const start = this.start;
    const { doc } = this.ctx;
    const el = doc.transact(this.kind.txName, (tx) => this.kind.create(tx, doc, start, s.p));
    this.start = null;
    this.ctx.viewport.setPreviewLines(null);
    this.ctx.setSelection([el.id]);
    this.prompt();
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key === "Escape" && this.start) {
      this.start = null;
      this.ctx.viewport.setPreviewLines(null);
      this.prompt();
      return true;
    }
    return false;
  }
}

export class GridTool extends DatumLineTool {
  constructor(ctx: ToolContext) {
    super(ctx, {
      name: "grid",
      txName: "Create grid",
      label: (doc) => `Grid ${nextGridName(doc)}`,
      preview: (doc, start, end) =>
        buildGridLines(doc, { id: "preview", category: Cat.Grid, name: nextGridName(doc), params: { start, end } } as Grid),
      create: (tx, doc, start, end) => createGrid(tx, doc, start, end),
    });
  }
}

export class ReferencePlaneTool extends DatumLineTool {
  constructor(ctx: ToolContext) {
    super(ctx, {
      name: "refplane",
      txName: "Create reference plane",
      label: () => "Reference plane",
      preview: (doc, start, end) =>
        buildReferencePlaneLines(doc, { id: "preview", category: Cat.ReferencePlane, params: { start, end } }),
      create: (tx, doc, start, end) => createReferencePlane(tx, doc, start, end),
    });
  }
}
