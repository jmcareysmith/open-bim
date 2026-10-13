import { Cat, type Document, type Element, type ElementId, type ViewParams } from "@open-bim/core";
import type { Viewport } from "./viewport.ts";

// View windows inside the main window (Revit: View → Windows → Tile / Cascade / Tab Views).
// Every open view gets a live window: drag its title bar to move it, its edges to resize (they
// snap to the work area and to each other), double-click the title to maximise. Tile and Cascade
// arrange them; Tab Views goes back to one view at a time. The active window holds the
// interactive viewport (tools, grips, overlays); the others are their own viewports kept in step
// with the model. Click a window to work in it.

export type PaneLayout = "tab" | "tile" | "cascade";

export interface PaneHost {
  readonly doc: Document;
  /** The interactive viewport's element (moves into the active window). */
  mainHost: HTMLElement;
  activeViewId(): ElementId | undefined;
  /** Open views in tab order. */
  openViews(): ElementId[];
  activate(id: ElementId): void;
  closeView(id: ElementId): void;
  makeViewport(container: HTMLElement): Viewport;
  configure(vp: Viewport, target: Element): void;
  renderSchedule(container: HTMLElement, schedule: Element): void;
}

/** Window position and size as fractions of the work area (so they follow window resizes). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Pane {
  id: ElementId;
  slot: HTMLElement;
  body: HTMLElement;
  vp: Viewport | null;
  doc: Document;
  fitted: boolean;
}

/** At most this many windows (each is a full viewport). */
const MAX_PANES = 9;
const CASCADE_STEP = 28;
/** Edges this close (px) snap together. */
const SNAP = 10;
/** Smallest window, px. */
const MIN_W = 160;
const MIN_H = 110;

/** Tile `n` windows: as square a grid as fits, the last row's windows widened to fill it. */
export function tileRects(n: number): Rect[] {
  if (n <= 0) return [];
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const out: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    const inRow = r === rows - 1 ? n - cols * (rows - 1) : cols;
    for (let c = 0; c < inRow; c++) out.push({ x: c / inRow, y: r / rows, w: 1 / inRow, h: 1 / rows });
  }
  return out;
}

/** Cascade `n` windows down and right from the top left, in an area of `width` × `height` px. */
export function cascadeRects(n: number, width: number, height: number): Rect[] {
  const dx = CASCADE_STEP / Math.max(1, width);
  const dy = CASCADE_STEP / Math.max(1, height);
  const w = Math.max(0.4, 1 - (n - 1) * dx);
  const h = Math.max(0.4, 1 - (n - 1) * dy);
  return Array.from({ length: n }, (_, i) => ({ x: Math.min(i * dx, 1 - w), y: Math.min(i * dy, 1 - h), w, h }));
}

/** Snap a value to the nearest of `targets` within `tol`, else leave it. */
export function snap(v: number, targets: number[], tol: number): number {
  let best = v;
  let d = tol;
  for (const t of targets) {
    if (Math.abs(t - v) < d) {
      d = Math.abs(t - v);
      best = t;
    }
  }
  return best;
}

type Edges = { l?: boolean; r?: boolean; t?: boolean; b?: boolean };

export class Panes {
  layout: "tab" | "windows" = "tab";
  private panes = new Map<ElementId, Pane>();
  private rects = new Map<ElementId, Rect>();
  /** Stacking order, bottom first. */
  private order: ElementId[] = [];
  private maximised = new Map<ElementId, Rect>();
  private activeSlot: HTMLElement;
  private activeBody: HTMLElement;
  /** The view in the active window last time we laid out. */
  private shownActive: ElementId | undefined;
  /** Views given windows (Tile 2/3/4 picks the most recent); null = every open view. */
  private shown: ElementId[] | null = null;
  /** Views by when they were last active, latest first. */
  private recent: ElementId[] = [];

  constructor(
    private area: HTMLElement,
    private host: PaneHost,
  ) {
    const { slot, body } = this.frame();
    this.activeSlot = slot;
    this.activeBody = body;
    slot.classList.add("active");
    body.append(host.mainHost);
    this.area.append(slot);
  }

  /** Tab Views, or Tile / Cascade every open view, or just the `count` most recently used. */
  setLayout(layout: PaneLayout, count?: number): void {
    if (layout === "tab") {
      this.layout = "tab";
      return this.refresh();
    }
    this.shown = null;
    if (count) {
      const open = this.ids();
      this.shown = [...this.recent.filter((id) => open.includes(id)), ...open.filter((id) => !this.recent.includes(id))].slice(0, count);
    }
    const ids = this.ids();
    const box = this.area.getBoundingClientRect();
    const rects = layout === "tile" ? tileRects(ids.length) : cascadeRects(ids.length, box.width, box.height);
    // Cascade: the active view on top, in front.
    const ordered = layout === "cascade" ? [...ids.filter((id) => id !== this.host.activeViewId()), ...ids.filter((id) => id === this.host.activeViewId())] : ids;
    ordered.forEach((id, i) => this.rects.set(id, rects[i]!));
    this.order = ordered;
    this.maximised.clear();
    this.layout = "windows";
    this.refresh();
  }

  private ids(): ElementId[] {
    const { doc } = this.host;
    const active = this.host.activeViewId();
    const ids = this.host
      .openViews()
      .filter((id) => doc.has(id))
      .slice(0, MAX_PANES);
    if (active && doc.has(active) && !ids.includes(active)) ids.unshift(active);
    if (!this.shown) return ids;
    // Opening another view while tiling a few gives it a window too.
    if (active && !this.shown.includes(active)) this.shown.push(active);
    return ids.filter((id) => this.shown!.includes(id));
  }

  /** Lay the windows out again and bring each in step with its view. */
  refresh(): void {
    const { doc } = this.host;
    const active = this.host.activeViewId();
    if (active) this.recent = [active, ...this.recent.filter((id) => id !== active && doc.has(id))];
    const ids = this.ids();
    const windowed = this.layout === "windows" && ids.length > 1;
    this.area.className = `panes ${windowed ? "windows" : "tab"}`;
    const others = windowed ? ids.filter((id) => id !== active) : [];

    // Drop windows no longer shown (or built on a document that's gone, e.g. after the family editor).
    for (const [id, p] of this.panes) {
      if (others.includes(id) && p.doc === doc) continue;
      p.vp?.dispose();
      p.slot.remove();
      this.panes.delete(id);
    }
    for (const id of others) if (!this.panes.has(id)) this.panes.set(id, this.makePane(id));

    // New views get a window offset from the last one; the active view comes to the front.
    for (const id of ids) {
      if (!this.rects.has(id)) {
        const last = this.order.length ? this.rects.get(this.order.at(-1)!) : undefined;
        const box = this.area.getBoundingClientRect();
        const dx = CASCADE_STEP / Math.max(1, box.width);
        const dy = CASCADE_STEP / Math.max(1, box.height);
        this.rects.set(id, last ? { x: Math.min(last.x + dx, 1 - last.w), y: Math.min(last.y + dy, 1 - last.h), w: last.w, h: last.h } : { x: 0, y: 0, w: 0.6, h: 0.6 });
      }
    }
    this.order = [...this.order.filter((id) => ids.includes(id) && id !== active), ...ids.filter((id) => !this.order.includes(id) && id !== active), ...(active ? [active] : [])];
    this.shownActive = active;

    const slots = windowed ? ids.map((id) => (id === active ? this.activeSlot : this.panes.get(id)!.slot)) : [this.activeSlot];
    this.area.replaceChildren(...slots);
    this.activeSlot.classList.toggle("windowed", windowed);
    this.place();
    this.label(this.activeSlot, windowed ? active : undefined);

    for (const p of this.panes.values()) {
      const target = doc.get(p.id);
      if (!target) continue;
      this.label(p.slot, p.id);
      if (target.category === Cat.Schedule) {
        this.host.renderSchedule(p.body, target);
        continue;
      }
      if (!p.vp) continue;
      try {
        this.host.configure(p.vp, target);
        if (!p.fitted) {
          p.fitted = true;
          const cam = target.category === Cat.View ? (target.params as ViewParams).camera : null;
          if (cam) p.vp.setCamera3d(cam);
          else requestAnimationFrame(() => p.vp?.zoomToFit());
        }
      } catch (err) {
        console.warn("Could not show view window", err);
      }
    }
  }

  /** Position each window from its rect, stacked in order. */
  private place(): void {
    const windowed = this.area.classList.contains("windows");
    const slotOf = (id: ElementId) => (id === this.shownActive ? this.activeSlot : this.panes.get(id)?.slot);
    if (!windowed) {
      Object.assign(this.activeSlot.style, { left: "", top: "", width: "", height: "", zIndex: "" });
      return;
    }
    this.order.forEach((id, i) => {
      const slot = slotOf(id);
      const r = this.rects.get(id);
      if (!slot || !r) return;
      Object.assign(slot.style, { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, zIndex: String(i + 1) });
    });
  }

  /** A window frame: title bar (drag to move, double-click to maximise), body, resize edges. */
  private frame(): { slot: HTMLElement; body: HTMLElement } {
    const slot = document.createElement("div");
    slot.className = "pane-slot";
    const bar = document.createElement("div");
    bar.className = "pane-bar";
    const title = document.createElement("span");
    title.className = "pane-title";
    const max = Object.assign(document.createElement("button"), { className: "pane-btn", textContent: "□", title: "Maximise / restore" });
    const close = Object.assign(document.createElement("button"), { className: "pane-btn", textContent: "×", title: "Close this view" });
    bar.append(title, max, close);
    const body = document.createElement("div");
    body.className = "pane-body";
    slot.append(bar, body);
    for (const e of ["l", "r", "t", "b", "tl", "tr", "bl", "br"]) {
      const h = document.createElement("div");
      h.className = `pane-edge e-${e}`;
      h.addEventListener("pointerdown", (ev) => this.startDrag(ev, slot, { l: e.includes("l"), r: e.includes("r"), t: e.includes("t"), b: e.includes("b") }));
      slot.append(h);
    }
    bar.addEventListener("pointerdown", (ev) => {
      if ((ev.target as HTMLElement).closest("button")) return;
      this.startDrag(ev, slot, null);
    });
    bar.addEventListener("dblclick", (ev) => {
      if ((ev.target as HTMLElement).closest("button")) return;
      this.toggleMax(this.idOf(slot));
    });
    max.onclick = () => this.toggleMax(this.idOf(slot));
    close.onclick = () => {
      const id = this.idOf(slot);
      if (id) this.host.closeView(id);
    };
    return { slot, body };
  }

  private idOf(slot: HTMLElement): ElementId | undefined {
    if (slot === this.activeSlot) return this.shownActive;
    for (const p of this.panes.values()) if (p.slot === slot) return p.id;
    return undefined;
  }

  private toggleMax(id: ElementId | undefined): void {
    if (!id) return;
    const prev = this.maximised.get(id);
    if (prev) {
      this.rects.set(id, prev);
      this.maximised.delete(id);
    } else {
      this.maximised.set(id, this.rects.get(id) ?? { x: 0, y: 0, w: 0.6, h: 0.6 });
      this.rects.set(id, { x: 0, y: 0, w: 1, h: 1 });
    }
    if (id !== this.host.activeViewId()) this.host.activate(id);
    else this.place();
  }

  /** Move (edges null) or resize a window by dragging, snapping to the area and other windows. */
  private startDrag(ev: PointerEvent, slot: HTMLElement, edges: Edges | null): void {
    if (ev.button !== 0) return;
    const id = this.idOf(slot);
    if (!id) return;
    ev.preventDefault();
    ev.stopPropagation();
    const box = this.area.getBoundingClientRect();
    const start = { ...(this.rects.get(id) ?? { x: 0, y: 0, w: 1, h: 1 }) };
    this.maximised.delete(id);
    const x0 = ev.clientX;
    const y0 = ev.clientY;
    // Edges to snap to (px): the area and every other window.
    const xs = [0, box.width];
    const ys = [0, box.height];
    for (const [other, r] of this.rects) {
      if (other === id || !this.order.includes(other)) continue;
      xs.push(r.x * box.width, (r.x + r.w) * box.width);
      ys.push(r.y * box.height, (r.y + r.h) * box.height);
    }
    document.body.classList.add("pane-dragging");
    const move = (e: PointerEvent) => {
      const dx = e.clientX - x0;
      const dy = e.clientY - y0;
      let l = start.x * box.width;
      let t = start.y * box.height;
      let r = (start.x + start.w) * box.width;
      let b = (start.y + start.h) * box.height;
      if (!edges) {
        const w = r - l;
        const h = b - t;
        l = Math.max(0, Math.min(box.width - w, l + dx));
        t = Math.max(0, Math.min(box.height - h, t + dy));
        // Snap whichever edge is closer.
        const sl = snap(l, xs, SNAP);
        const sr = snap(l + w, xs, SNAP);
        l = sl !== l ? sl : sr !== l + w ? sr - w : l;
        const st = snap(t, ys, SNAP);
        const sb = snap(t + h, ys, SNAP);
        t = st !== t ? st : sb !== t + h ? sb - h : t;
        r = l + w;
        b = t + h;
      } else {
        if (edges.l) l = Math.max(0, Math.min(r - MIN_W, snap(l + dx, xs, SNAP)));
        if (edges.r) r = Math.min(box.width, Math.max(l + MIN_W, snap(r + dx, xs, SNAP)));
        if (edges.t) t = Math.max(0, Math.min(b - MIN_H, snap(t + dy, ys, SNAP)));
        if (edges.b) b = Math.min(box.height, Math.max(t + MIN_H, snap(b + dy, ys, SNAP)));
      }
      this.rects.set(id, { x: l / box.width, y: t / box.height, w: (r - l) / box.width, h: (b - t) / box.height });
      this.place();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("pane-dragging");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    // Grabbing another window makes it the active one (and brings it to the front).
    if (id !== this.host.activeViewId()) setTimeout(() => this.host.activate(id));
  }

  private makePane(id: ElementId): Pane {
    const { doc } = this.host;
    const { slot, body } = this.frame();
    const target = doc.get(id);
    const vp = target && target.category !== Cat.Schedule ? this.host.makeViewport(body) : null;
    // Clicking a window's view makes it the active one. (The click goes no further: this window's
    // viewport is about to show another view.)
    body.addEventListener(
      "pointerdown",
      (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        setTimeout(() => this.host.activate(id));
      },
      { capture: true },
    );
    return { id, slot, body, vp, doc, fitted: false };
  }

  private label(slot: HTMLElement, id: ElementId | undefined): void {
    const tag = slot.querySelector<HTMLElement>(":scope > .pane-bar > .pane-title");
    if (!tag) return;
    const el = id ? this.host.doc.get(id) : undefined;
    tag.textContent = !el ? "" : el.category === Cat.Sheet ? `Sheet: ${(el.params as { number?: string }).number ?? ""} - ${el.name ?? ""}` : (el.name ?? "");
  }
}
