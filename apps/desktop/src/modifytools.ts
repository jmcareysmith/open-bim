import {
  Cat,
  applyAffine,
  arrayElements,
  isModifiable,
  mirrorAcross,
  planPoints,
  rotationAbout,
  selectionCentre,
  transformElements,
  translation,
  type Affine,
  type Element,
  type ElementId,
  type GroupParams,
  type Vec2,
} from "@open-bim/core";
import type { LineData } from "@open-bim/geometry";
import { viewPoint, type Tool, type ToolContext } from "./tools.ts";

// Modify tools (Revit: Move MV, Copy CO, Rotate RO, Mirror MM, Array AR). Select first, then
// pick points. Type a number and press Enter for an exact distance (Move/Copy/Array), angle
// (Rotate, degrees anticlockwise) or, for Array, the number of items.

export type ModifyMode = "move" | "copy" | "rotate" | "mirror" | "array";

/** A tool option shown in the options strip (Revit's options bar). */
export type ToolOption =
  | { kind: "check"; label: string; value: boolean; set(v: boolean): void }
  | { kind: "number"; label: string; value: number; min: number; set(v: number): void };

export interface ModifyToolContext extends ToolContext {
  setToolOptions(options: ToolOption[] | null): void;
}

const LABEL: Record<ModifyMode, string> = { move: "Move", copy: "Copy", rotate: "Rotate", mirror: "Mirror", array: "Array" };
const deg = (r: number) => (r * 180) / Math.PI;

/** Outline of the selection, for the drag preview. */
function ghost(doc: ModifyToolContext["doc"], els: Element[], t: Affine): number[] {
  const seg: number[] = [];
  const line = (a: Vec2, b: Vec2) => {
    const p = applyAffine(t, a);
    const q = applyAffine(t, b);
    seg.push(p.x, p.y, 0, q.x, q.y, 0);
  };
  for (const el of els) {
    const p = el.params as Record<string, unknown>;
    if (el.category === Cat.Group) {
      const o = (p as unknown as GroupParams).origin;
      line({ x: o.x - 200, y: o.y }, { x: o.x + 200, y: o.y });
      line({ x: o.x, y: o.y - 200 }, { x: o.x, y: o.y + 200 });
      continue;
    }
    const loop = (pts: Vec2[], closed: boolean) => pts.forEach((a, i) => (i < pts.length - 1 || closed) && line(a, pts[(i + 1) % pts.length]!));
    if (Array.isArray(p.boundary)) loop(p.boundary as Vec2[], true);
    else if (Array.isArray(p.path)) loop(p.path as Vec2[], false);
    else if (Array.isArray(p.runs)) for (const r of p.runs as { start: Vec2; end: Vec2 }[]) line(r.start, r.end);
    else {
      const pts = planPoints(doc, el);
      if (pts.length >= 2) loop(pts, false);
      else if (pts[0]) {
        const o = pts[0];
        line({ x: o.x - 150, y: o.y - 150 }, { x: o.x + 150, y: o.y + 150 });
        line({ x: o.x - 150, y: o.y + 150 }, { x: o.x + 150, y: o.y - 150 });
      }
    }
  }
  return seg;
}

export class ModifyTool implements Tool {
  readonly name: string;
  private ids: ElementId[] = [];
  /** Clicked points: base/start (and for Rotate, the start ray's point). */
  private pts: Vec2[] = [];
  private centre: Vec2 | null = null;
  private placingCentre = false;
  private cursor: Vec2 | null = null;
  private typed = "";
  // Options (Revit defaults: Mirror copies; the others move).
  private copy = false;
  private multiple = false;
  private disjoin = false;
  private count = 3;

  constructor(
    private ctx: ModifyToolContext,
    private mode: ModifyMode,
  ) {
    this.name = mode;
  }

  activate(): void {
    const { doc } = this.ctx;
    const drawing = this.ctx.viewport.viewMode === "drawing";
    const viewId = this.ctx.activeViewId();
    const usable = (el: Element) => {
      if (!isModifiable(el)) return false;
      // In sections, elevations and sheets only this view's annotations (and viewports) move.
      if (!drawing) return true;
      const p = el.params as { viewId?: unknown; sheetId?: unknown };
      return p.viewId === viewId || p.sheetId === viewId;
    };
    const sel = this.ctx.selection().map((id) => doc.get(id)).filter((e): e is Element => !!e);
    this.ids = sel.filter(usable).map((e) => e.id);
    this.pts = [];
    this.typed = "";
    this.cursor = null;
    this.placingCentre = false;
    this.copy = this.mode === "copy" || this.mode === "mirror";
    this.multiple = this.mode === "copy";
    this.centre = this.mode === "rotate" ? selectionCentre(doc, this.ids) : null;
    if (!this.ids.length) {
      this.ctx.status(`${LABEL[this.mode]}: select the elements first, then start the tool.${sel.length ? " (Nothing selected can be moved here.)" : ""}`);
    } else this.prompt(sel.length > this.ids.length ? ` ${sel.length - this.ids.length} selected element(s) can't be moved here and were left out.` : "");
    this.showOptions();
    this.preview();
  }

  deactivate(): void {
    this.ctx.viewport.setPreviewLines(null);
    this.ctx.setToolOptions(null);
  }

  private showOptions(): void {
    const opts: ToolOption[] = [];
    if (this.mode === "move" || this.mode === "rotate" || this.mode === "mirror") {
      opts.push({ kind: "check", label: "Copy", value: this.copy, set: (v) => (this.copy = v) });
    }
    if (this.mode === "copy") opts.push({ kind: "check", label: "Multiple", value: this.multiple, set: (v) => (this.multiple = v) });
    if (this.mode === "move" || this.mode === "rotate") {
      opts.push({ kind: "check", label: "Disjoin", value: this.disjoin, set: (v) => (this.disjoin = v) });
    }
    if (this.mode === "array") opts.push({ kind: "number", label: "Number", value: this.count, min: 2, set: (v) => (this.count = Math.max(2, Math.round(v))) });
    this.ctx.setToolOptions(this.ids.length ? opts : null);
  }

  private prompt(extra = ""): void {
    const typed = this.typed ? ` Typed: ${this.typed} (Enter to apply)` : "";
    const step = (() => {
      switch (this.mode) {
        case "move":
        case "copy":
          return this.pts.length ? "click the destination, or type a distance." : "click a base point.";
        case "array":
          return this.pts.length ? `click the second item's position, or type the spacing. ${this.count} items in total.` : "click a base point.";
        case "rotate":
          if (this.placingCentre) return "click the centre of rotation.";
          return this.pts.length ? "click the end of the rotation, or type an angle." : "click the start of the rotation, or type an angle. Press C to move the centre.";
        case "mirror":
          return this.pts.length ? "click the second point of the mirror axis." : "click the first point of the mirror axis.";
      }
    })();
    this.ctx.status(`${LABEL[this.mode]}: ${step}${typed}${extra}`);
  }

  /** The transform for the current cursor (or a typed value), or null when not ready. */
  private transform(cursor: Vec2 | null): Affine | null {
    const typed = this.typed ? Number(this.typed) : NaN;
    const [a] = this.pts;
    switch (this.mode) {
      case "move":
      case "copy":
      case "array": {
        if (!a || !cursor) return null;
        let d = { x: cursor.x - a.x, y: cursor.y - a.y };
        if (Number.isFinite(typed)) {
          const len = Math.hypot(d.x, d.y);
          if (len < 1e-6) return null;
          d = { x: (d.x / len) * typed, y: (d.y / len) * typed };
        }
        return translation(d);
      }
      case "rotate": {
        const c = this.centre;
        if (!c) return null;
        if (Number.isFinite(typed)) return rotationAbout(c, (typed * Math.PI) / 180);
        if (!a || !cursor) return null;
        const angle = Math.atan2(cursor.y - c.y, cursor.x - c.x) - Math.atan2(a.y - c.y, a.x - c.x);
        return rotationAbout(c, angle);
      }
      case "mirror":
        if (!a || !cursor || Math.hypot(cursor.x - a.x, cursor.y - a.y) < 1) return null;
        return mirrorAcross(a, cursor);
    }
  }

  private preview(): void {
    const seg: number[] = [];
    const [a] = this.pts;
    const c = this.centre;
    if (c && this.mode === "rotate") {
      const r = 250;
      seg.push(c.x - r, c.y, 0, c.x + r, c.y, 0, c.x, c.y - r, 0, c.x, c.y + r, 0);
      if (a) seg.push(c.x, c.y, 0, a.x, a.y, 0);
      if (this.cursor) seg.push(c.x, c.y, 0, this.cursor.x, this.cursor.y, 0);
    } else if (a && this.cursor) seg.push(a.x, a.y, 0, this.cursor.x, this.cursor.y, 0);
    const t = this.placingCentre ? null : this.transform(this.cursor);
    if (t) {
      const els = this.ids.map((id) => this.ctx.doc.get(id)).filter((e): e is Element => !!e);
      seg.push(...ghost(this.ctx.doc, els, t));
      if (this.mode === "array") {
        // Show every item.
        let k = t;
        for (let i = 2; i < this.count; i++) {
          k = { ...k, tx: k.tx + t.tx, ty: k.ty + t.ty };
          seg.push(...ghost(this.ctx.doc, els, k));
        }
      }
    }
    this.ctx.viewport.setPreviewLines(seg.length ? { segments: new Float32Array(seg), labels: [] } satisfies LineData : null);
  }

  pointerMove(ev: PointerEvent): void {
    if (!this.ids.length) return;
    const from = this.mode === "rotate" ? (this.placingCentre ? null : this.centre) : (this.pts[0] ?? null);
    this.cursor = viewPoint(this.ctx, ev, from);
    this.preview();
    const t = this.transform(this.cursor);
    if (!t || this.typed) return;
    if (this.mode === "rotate") this.ctx.status(`${LABEL.rotate}: ${deg(Math.atan2(t.yx, t.xx)).toFixed(1)}° — click to finish, or type an angle.`);
    else if (this.mode !== "mirror") this.ctx.status(`${LABEL[this.mode]}: ${Math.round(Math.hypot(t.tx, t.ty))} mm — click to finish, or type a distance.`);
  }

  click(ev: PointerEvent): void {
    if (!this.ids.length) return;
    const from = this.mode === "rotate" ? (this.placingCentre ? null : this.centre) : (this.pts[0] ?? null);
    const p = viewPoint(this.ctx, ev, from);
    if (!p) return;
    if (this.placingCentre) {
      this.centre = p;
      this.placingCentre = false;
      this.pts = [];
      return this.prompt();
    }
    if (!this.pts.length) {
      this.pts = [p];
      this.cursor = p;
      return this.prompt();
    }
    this.apply(this.transform(p));
  }

  private apply(t: Affine | null): void {
    if (!t) return;
    const { doc } = this.ctx;
    const ids = this.ids;
    try {
      let result: ElementId[];
      if (this.mode === "array") {
        const copies = doc.transact(`Array (${this.count})`, (tx) => arrayElements(tx, doc, ids, t, this.count));
        result = [...ids, ...copies.flat()];
      } else {
        const copy = this.copy || this.mode === "copy";
        result = doc.transact(LABEL[this.mode], (tx) => transformElements(tx, doc, ids, t, { copy, disjoin: this.disjoin }));
      }
      this.typed = "";
      if (this.mode === "copy" && this.multiple) {
        // Keep copying from the same base point.
        this.ctx.status(`Copied. Click another destination, or Esc to finish.`);
        return this.preview();
      }
      this.ctx.setSelection(result);
      this.ids = result;
      this.pts = [];
      this.cursor = null;
      if (this.mode === "rotate") this.centre = selectionCentre(doc, this.ids);
      this.preview();
      this.ctx.status(`${LABEL[this.mode]} done. Pick again to repeat, or Esc to finish.`);
    } catch (e) {
      this.ctx.status(`⚠ ${(e as Error).message}`);
    }
  }

  key(ev: KeyboardEvent): boolean {
    if (!this.ids.length) return false;
    if (/^[0-9.\-]$/.test(ev.key) && !(this.mode === "mirror")) {
      this.typed += ev.key;
      this.prompt();
      this.preview();
      return true;
    }
    if (ev.key === "Backspace" && this.typed) {
      this.typed = this.typed.slice(0, -1);
      this.prompt();
      this.preview();
      return true;
    }
    if (ev.key === "Enter" && this.typed) {
      if (!Number.isFinite(Number(this.typed))) {
        this.ctx.status(`⚠ "${this.typed}" isn't a number.`);
        this.typed = "";
        return true;
      }
      const t = this.transform(this.cursor);
      if (!t) {
        this.ctx.status(`${LABEL[this.mode]}: ${this.mode === "rotate" ? "" : "click a base point and point the cursor the way to go, then "}type the value and press Enter.`);
        return true;
      }
      this.apply(t);
      return true;
    }
    if (this.mode === "rotate" && ev.key.toLowerCase() === "c") {
      this.placingCentre = true;
      this.prompt();
      return true;
    }
    if (ev.key === "Escape" && (this.pts.length || this.typed || this.placingCentre)) {
      this.pts = [];
      this.typed = "";
      this.placingCentre = false;
      this.preview();
      this.prompt();
      return true;
    }
    return false;
  }
}
