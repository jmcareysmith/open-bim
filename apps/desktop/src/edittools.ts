import {
  alignElement,
  elementLine,
  isLinear,
  nearestLine,
  offsetElements,
  referenceLines,
  splitElement,
  trimExtend,
  trimToCorner,
  type ElementId,
  type Line2,
  type Vec2,
} from "@open-bim/core";
import type { ModifyToolContext, ToolOption } from "./modifytools.ts";
import type { Tool } from "./tools.ts";

// Align (AL), Offset (OF), Trim/Extend (TR) and Split (SL). Plans and 3D only: they pick model
// lines (wall faces and centrelines, grids, reference planes, beams, detail lines).

const REACH = 1e5;
/** A long preview line along a picked reference. */
const lineSeg = (l: Line2) => [l.point.x - l.dir.x * REACH, l.point.y - l.dir.y * REACH, 0, l.point.x + l.dir.x * REACH, l.point.y + l.dir.y * REACH, 0];

abstract class LineTool implements Tool {
  abstract readonly name: string;
  constructor(protected ctx: ModifyToolContext) {}

  protected abstract prompt(): string;
  protected options(): ToolOption[] | null {
    return null;
  }

  activate(): void {
    this.reset();
    this.ctx.setToolOptions(this.options());
  }

  deactivate(): void {
    this.ctx.viewport.setPreviewLines(null);
    this.ctx.setToolOptions(null);
  }

  protected reset(): void {
    this.ctx.viewport.setPreviewLines(null);
    this.ctx.status(this.prompt());
  }

  protected show(lines: Line2[]): void {
    this.ctx.viewport.setPreviewLines(lines.length ? { segments: new Float32Array(lines.flatMap(lineSeg)), labels: [] } : null);
  }

  /** The element under the cursor that passes `ok`, and where it was hit (plan mm). */
  protected hit(ev: PointerEvent, ok: (id: ElementId) => boolean): { id: ElementId; point: Vec2 } | null {
    if (this.ctx.viewport.viewMode === "drawing") {
      this.ctx.status("This tool works in plans and 3D views for now.");
      return null;
    }
    return this.ctx.viewport.pickHit(ev, ok);
  }

  protected linear = (id: ElementId) => {
    const el = this.ctx.doc.get(id);
    return !!el && isLinear(el);
  };

  protected run(name: string, fn: Parameters<ModifyToolContext["doc"]["transact"]>[1]): boolean {
    try {
      this.ctx.doc.transact(name, fn);
      return true;
    } catch (e) {
      this.ctx.status(`⚠ ${(e as Error).message}`);
      return false;
    }
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key === "Escape" && this.busy()) {
      this.reset();
      return true;
    }
    return false;
  }
  protected abstract busy(): boolean;
}

/** Align: pick the line to align to, then the line on the element to move. */
export class AlignTool extends LineTool {
  readonly name = "align";
  private ref: Line2 | null = null;

  protected prompt() {
    return "Align: click the line to align to (a wall face or centre, grid, reference plane…).";
  }
  protected override reset() {
    this.ref = null;
    super.reset();
  }
  protected busy() {
    return !!this.ref;
  }

  click(ev: PointerEvent): void {
    const { doc } = this.ctx;
    const h = this.hit(ev, (id) => referenceLines(doc, doc.get(id)!).length > 0);
    if (!h) return;
    const line = nearestLine(doc, doc.require(h.id), h.point);
    if (!line) return;
    if (!this.ref) {
      this.ref = line;
      this.show([line]);
      return this.ctx.status("Align: now click the line on the element to move onto it. Esc to start over.");
    }
    const ref = this.ref;
    if (this.run("Align", (tx) => alignElement(tx, doc, ref, h.id, h.point))) {
      this.ctx.setSelection([h.id]);
      this.ctx.status("Aligned. Click another element to align to the same line, or Esc to pick a new one.");
    }
  }
}

/** Offset: click a line; a copy (or the line itself) goes the set distance to the side clicked. */
export class OffsetTool extends LineTool {
  readonly name = "offset";
  private dist = 500;
  private copy = true;

  protected prompt() {
    return `Offset: click a wall or line on the side to offset towards (${this.dist} mm). Set the distance top-left.`;
  }
  protected override options(): ToolOption[] {
    return [
      { kind: "number", label: "Offset (mm)", value: this.dist, min: 1, set: (v) => ((this.dist = v), this.reset()) },
      { kind: "check", label: "Copy", value: this.copy, set: (v) => (this.copy = v) },
    ];
  }
  protected busy() {
    return false;
  }

  pointerMove(ev: PointerEvent): void {
    const h = this.hit(ev, this.linear);
    if (!h) return this.show([]);
    const l = elementLine(this.ctx.doc.require(h.id));
    const n = { x: -l.dir.y, y: l.dir.x };
    const s = (h.point.x - l.point.x) * n.x + (h.point.y - l.point.y) * n.y < 0 ? -1 : 1;
    this.show([{ point: { x: l.point.x + n.x * this.dist * s, y: l.point.y + n.y * this.dist * s }, dir: l.dir }]);
  }

  click(ev: PointerEvent): void {
    const h = this.hit(ev, this.linear);
    if (!h) return;
    const { doc } = this.ctx;
    let out: ElementId[] = [];
    if (this.run("Offset", (tx) => (out = offsetElements(tx, doc, [h.id], this.dist, h.point, this.copy)))) this.ctx.setSelection(out);
  }
}

/** Trim/Extend: to corner (two clicks, on the parts to keep), or each element to a boundary. */
export class TrimTool extends LineTool {
  readonly name = "trim";
  private first: { id: ElementId; point: Vec2 } | null = null;
  private boundary: Line2 | null = null;
  private toBoundary = false;

  protected prompt() {
    return this.toBoundary
      ? "Trim/Extend to boundary: click the boundary line, then each element to trim or extend (click the part to keep)."
      : "Trim/Extend to corner: click the first element on the part to keep, then the second.";
  }
  protected override options(): ToolOption[] {
    return [{ kind: "check", label: "To a boundary (multiple)", value: this.toBoundary, set: (v) => ((this.toBoundary = v), this.reset()) }];
  }
  protected override reset() {
    this.first = null;
    this.boundary = null;
    super.reset();
  }
  protected busy() {
    return !!this.first || !!this.boundary;
  }

  click(ev: PointerEvent): void {
    const { doc } = this.ctx;
    if (this.toBoundary && !this.boundary) {
      const h = this.hit(ev, (id) => referenceLines(doc, doc.get(id)!).length > 0);
      const line = h && nearestLine(doc, doc.require(h.id), h.point);
      if (!line) return;
      this.boundary = line;
      this.show([line]);
      return this.ctx.status("Trim/Extend: click each element to trim or extend to the boundary (on the part to keep). Esc to finish.");
    }
    const h = this.hit(ev, this.linear);
    if (!h) return;
    if (this.boundary) {
      const b = this.boundary;
      this.run("Trim/Extend", (tx) => trimExtend(tx, doc, h.id, h.point, b));
      return;
    }
    if (!this.first) {
      this.first = h;
      this.show([elementLine(doc.require(h.id))]);
      return this.ctx.status("Trim/Extend: now click the second element (on the part to keep).");
    }
    const a = this.first;
    if (this.run("Trim/Extend to corner", (tx) => trimToCorner(tx, doc, a.id, a.point, h.id, h.point))) this.ctx.setSelection([a.id, h.id]);
    this.first = null;
    this.show([]);
  }
}

/** Split: click a wall or line where to cut it. */
export class SplitTool extends LineTool {
  readonly name = "split";
  protected prompt() {
    return "Split: click a wall, beam or line where it should be cut.";
  }
  protected busy() {
    return false;
  }

  pointerMove(ev: PointerEvent): void {
    const h = this.hit(ev, this.linear);
    if (!h) return this.show([]);
    // A short tick across the element at the cut.
    const l = elementLine(this.ctx.doc.require(h.id));
    this.ctx.viewport.setPreviewLines({ segments: new Float32Array([h.point.x - l.dir.y * 400, h.point.y + l.dir.x * 400, 0, h.point.x + l.dir.y * 400, h.point.y - l.dir.x * 400, 0]), labels: [] });
  }

  click(ev: PointerEvent): void {
    const h = this.hit(ev, this.linear);
    if (!h) return;
    const { doc } = this.ctx;
    let second = "";
    if (this.run("Split", (tx) => (second = splitElement(tx, doc, h.id, h.point)))) {
      this.ctx.setSelection([h.id, second]);
      this.ctx.status("Split. Click to split again, or Esc.");
    }
  }
}
