import {
  Cat,
  createWall,
  levels,
  type Document,
  type ElementId,
  type LevelParams,
  type Vec2,
  type Wall,
  type WallParams,
  totalThickness,
  type LayeredTypeParams,
} from "@open-bim/core";
import { extrudePolygon, wallFootprint } from "@open-bim/geometry";
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

// ---- Wall -----------------------------------------------------------------

const GRID = 50; // mm snap increment
const ENDPOINT_SNAP = 300; // mm
const ORTHO_DEG = 4;

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

  private snap(p: Vec2, free: boolean): Vec2 {
    // 1. Wall endpoints on this level
    let best: Vec2 | null = null;
    let bestD = ENDPOINT_SNAP;
    for (const w of this.ctx.doc.byCategory<WallParams>(Cat.Wall)) {
      if (w.params.baseLevelId !== this.ctx.activeLevelId()) continue;
      for (const q of [w.params.start, w.params.end]) {
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = q;
        }
      }
    }
    if (best) return { ...best };

    // 2. Orthogonal to start point
    let q = { ...p };
    if (this.start && !free) {
      const dx = p.x - this.start.x;
      const dy = p.y - this.start.y;
      const ang = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI) % 90;
      if (ang < ORTHO_DEG || ang > 90 - ORTHO_DEG) {
        if (Math.abs(dx) > Math.abs(dy)) q = { x: p.x, y: this.start.y };
        else q = { x: this.start.x, y: p.y };
      }
    }
    // 3. Grid increment
    const r = (v: number) => Math.round(v / GRID) * GRID;
    if (this.start && q.x === this.start.x) return { x: q.x, y: r(q.y) };
    if (this.start && q.y === this.start.y) return { x: r(q.x), y: q.y };
    return { x: r(q.x), y: r(q.y) };
  }

  private point(ev: PointerEvent): Vec2 | null {
    const p = this.ctx.viewport.pickPlane(ev, this.levelElevation());
    return p && this.snap(p, ev.shiftKey);
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
    this.ctx.status(`Wall length: ${Math.round(len)} mm`);
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
