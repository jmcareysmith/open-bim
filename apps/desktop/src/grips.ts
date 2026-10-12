import { dragGrip, elementGrips, lineLength, setLineLength, type Element, type ElementId, type Grip, type Vec2 } from "@open-bim/core";
import { viewPoint, type ToolContext } from "./tools.ts";

// Grips and temporary dimensions over the viewport (Revit's drag controls). Shown for the
// selection while the Select tool is active, in plans (model elements and the plan's annotations)
// and in sections/sheets (that view's annotations and viewports). Drag a grip to reshape; click a
// wall's or line's length to type a new one.

/** More selected than this and grips are left off (as Revit does for big selections). */
const MAX_ELEMENTS = 30;

interface Placed {
  el: HTMLDivElement;
  at: () => Vec2;
}

export class GripLayer {
  private root: HTMLDivElement;
  private placed: Placed[] = [];
  private enabled = true;
  private dragging = false;

  constructor(
    private ctx: ToolContext,
    host: HTMLElement,
  ) {
    this.root = document.createElement("div");
    this.root.className = "grip-layer";
    host.append(this.root);
    ctx.viewport.onFrame(() => this.position());
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.refresh();
  }

  /** Elements whose grips this view can show. */
  private editable(el: Element): boolean {
    const mode = this.ctx.viewport.viewMode;
    const p = el.params as { viewId?: unknown; sheetId?: unknown };
    const view = this.ctx.activeViewId();
    if (mode === "3d") return false;
    if (mode === "drawing") return p.viewId === view || p.sheetId === view;
    return p.viewId === undefined || p.viewId === view;
  }

  /** Rebuild for the current selection (after selection or model changes). */
  refresh(): void {
    if (this.dragging) return;
    this.root.replaceChildren();
    this.placed = [];
    if (!this.enabled) return;
    const { doc } = this.ctx;
    const sel = this.ctx.selection().map((id) => doc.get(id)).filter((e): e is Element => !!e && this.editable(e));
    if (!sel.length || sel.length > MAX_ELEMENTS) return;
    for (const el of sel) {
      for (const g of elementGrips(doc, el)) this.addGrip(el.id, g);
    }
    if (sel.length === 1) this.addLength(sel[0]!);
    this.position();
  }

  private position(): void {
    for (const p of this.placed) {
      const s = this.ctx.viewport.toScreen(p.at());
      const r = this.root.getBoundingClientRect();
      p.el.style.left = `${s.x - r.left}px`;
      p.el.style.top = `${s.y - r.top}px`;
    }
  }

  private addGrip(id: ElementId, g: Grip): void {
    const el = document.createElement("div");
    el.className = `grip grip-${g.kind}`;
    el.title = g.kind === "move" ? "Drag to move" : "Drag to reshape";
    let at = g.point;
    el.onpointerdown = (ev) => {
      if (ev.button !== 0) return;
      ev.stopPropagation();
      ev.preventDefault();
      el.setPointerCapture(ev.pointerId);
      this.dragging = true;
      const from = g.point;
      el.onpointermove = (mv) => {
        const p = viewPoint(this.ctx, mv, null);
        if (!p) return;
        at = p;
        this.position();
        this.ctx.viewport.setPreviewLines({ segments: new Float32Array([from.x, from.y, 0, p.x, p.y, 0]), labels: [] });
        this.ctx.status(`Drag: ${Math.round(Math.hypot(p.x - from.x, p.y - from.y))} mm`);
      };
      el.onpointerup = () => {
        el.onpointermove = null;
        el.onpointerup = null;
        this.dragging = false;
        this.ctx.viewport.setPreviewLines(null);
        const to = at;
        at = g.point;
        if (Math.hypot(to.x - from.x, to.y - from.y) < 0.5) return this.refresh();
        try {
          this.ctx.doc.transact("Drag", (tx) => dragGrip(tx, this.ctx.doc, id, g.key, to));
          this.ctx.status("Dragged. Ctrl+Z to undo.");
        } catch (e) {
          this.ctx.status(`⚠ ${(e as Error).message}`);
        }
        this.refresh();
      };
    };
    this.root.append(el);
    this.placed.push({ el, at: () => at });
  }

  /** Temporary dimension: the length at the line's midpoint; click to type a new length. */
  private addLength(el: Element): void {
    const len = lineLength(el);
    if (len === null) return;
    const { start, end } = el.params as unknown as { start: Vec2; end: Vec2 };
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const label = document.createElement("div");
    label.className = "temp-dim";
    label.textContent = `${Math.round(len)}`;
    label.title = "Click to type a new length (the start stays put)";
    label.onpointerdown = (ev) => ev.stopPropagation();
    label.onclick = () => {
      const input = document.createElement("input");
      input.type = "number";
      input.value = String(Math.round(len));
      label.replaceChildren(input);
      input.focus();
      input.select();
      input.onkeydown = (ev) => {
        ev.stopPropagation();
        if (ev.key === "Escape") return this.refresh();
        if (ev.key !== "Enter") return;
        try {
          this.ctx.doc.transact("Change length", (tx) => setLineLength(tx, this.ctx.doc, el.id, Number(input.value)));
        } catch (e) {
          this.ctx.status(`⚠ ${(e as Error).message}`);
        }
        this.refresh();
      };
      input.onblur = () => this.refresh();
    };
    this.root.append(label);
    this.placed.push({ el: label, at: () => mid });
  }
}
