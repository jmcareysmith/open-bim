import { Cat, type ElementId, type FloorParams, type Vec2 } from "@open-bim/core";
import { viewPoint, type Tool, type ToolContext } from "./tools.ts";

// Slope Arrow (Revit: floor sketch → Slope Arrow): click the tail (the high end by default), then
// the head. The floor's top tilts from the tail down to the head; set the heights in Properties.

/** Default fall from tail to head, mm per metre of arrow (1:100, a typical wet-area fall). */
const DEFAULT_FALL = 10;

export class SlopeArrowTool implements Tool {
  readonly name = "slopeArrow";
  floorId: ElementId | null = null;
  private tail: Vec2 | null = null;

  constructor(private ctx: ToolContext) {}

  activate(): void {
    this.tail = null;
    this.ctx.status("Slope Arrow: click the tail (high end), then the head (low end). Esc = cancel");
  }

  deactivate(): void {
    this.tail = null;
    this.ctx.viewport.setPreviewLines(null);
  }

  pointerMove(ev: PointerEvent): void {
    if (!this.tail) return;
    const p = viewPoint(this.ctx, ev, this.tail);
    if (!p) return;
    this.ctx.viewport.setPreviewLines({ segments: new Float32Array([this.tail.x, this.tail.y, 0, p.x, p.y, 0]), labels: [] });
  }

  click(ev: PointerEvent): void {
    const p = viewPoint(this.ctx, ev, this.tail);
    if (!p) return;
    if (!this.tail) {
      this.tail = p;
      this.ctx.status("Slope Arrow: click the head (low end).");
      return;
    }
    const { doc } = this.ctx;
    const id = this.floorId;
    const floor = id ? doc.get<FloorParams>(id) : undefined;
    if (!id || floor?.category !== Cat.Floor) return this.ctx.status("Slope Arrow: select a floor first.");
    const len = Math.hypot(p.x - this.tail.x, p.y - this.tail.y);
    if (len < 100) return this.ctx.status("Slope Arrow: make the arrow longer.");
    const old = floor.params.slope;
    const fall = old ? old.headOffset - old.tailOffset : -Math.round((DEFAULT_FALL * len) / 1000);
    const tail = this.tail;
    try {
      doc.transact("Slope arrow", (tx) => tx.update<FloorParams>(id, { slope: { tail, head: p, tailOffset: old?.tailOffset ?? 0, headOffset: (old?.tailOffset ?? 0) + fall } }));
      this.ctx.setSelection([id]);
      this.ctx.status("Slope arrow set. Change the heights at tail and head in Properties.");
    } catch (e) {
      this.ctx.status(`⚠ ${(e as Error).message}`);
    }
    this.tail = null;
    this.ctx.viewport.setPreviewLines(null);
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key === "Escape" && this.tail) {
      this.activate();
      this.ctx.viewport.setPreviewLines(null);
      return true;
    }
    return false;
  }
}
