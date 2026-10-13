import { Cat, type Document, type Element, type ElementId, type ViewParams } from "@open-bim/core";
import type { Viewport } from "./viewport.ts";

// Tiled and cascaded views (Revit: View → Windows → Tile / Cascade / Tab Views). Every open view
// gets a live pane; the active one holds the interactive viewport (tools, grips, overlays) and the
// others are their own viewports kept in step with the model. Click a pane to work in it.

export type PaneLayout = "tab" | "tile" | "cascade";

export interface PaneHost {
  readonly doc: Document;
  /** The interactive viewport's element (moves into the active pane). */
  mainHost: HTMLElement;
  activeViewId(): ElementId | undefined;
  /** Open views in tab order. */
  openViews(): ElementId[];
  activate(id: ElementId): void;
  makeViewport(container: HTMLElement): Viewport;
  configure(vp: Viewport, target: Element): void;
  renderSchedule(container: HTMLElement, schedule: Element): void;
}

interface Pane {
  id: ElementId;
  slot: HTMLElement;
  body: HTMLElement;
  vp: Viewport | null;
  doc: Document;
  fitted: boolean;
}

/** At most this many panes (each is a full viewport). */
const MAX_PANES = 9;
const CASCADE_STEP = 28;

export class Panes {
  layout: PaneLayout = "tab";
  private panes = new Map<ElementId, Pane>();
  private activeSlot: HTMLElement;

  constructor(
    private area: HTMLElement,
    private host: PaneHost,
  ) {
    this.activeSlot = document.createElement("div");
    this.activeSlot.className = "pane-slot active";
    this.area.append(this.activeSlot);
    this.activeSlot.append(host.mainHost);
  }

  setLayout(layout: PaneLayout): void {
    this.layout = layout;
    this.refresh();
  }

  /** Lay the panes out again and bring each in step with its view. */
  refresh(): void {
    const { doc } = this.host;
    const active = this.host.activeViewId();
    const ids = this.host
      .openViews()
      .filter((id) => doc.has(id))
      .slice(0, MAX_PANES);
    if (active && !ids.includes(active)) ids.unshift(active);
    const tiled = this.layout !== "tab" && ids.length > 1;
    this.area.className = `panes ${tiled ? this.layout : "tab"}`;
    const others = tiled ? ids.filter((id) => id !== active) : [];

    // Drop panes no longer shown (or built on a document that's gone, e.g. after the family editor).
    for (const [id, p] of this.panes) {
      if (others.includes(id) && p.doc === doc) continue;
      p.vp?.dispose();
      p.slot.remove();
      this.panes.delete(id);
    }
    for (const id of others) if (!this.panes.has(id)) this.panes.set(id, this.makePane(id));

    // Order the slots as the tabs are, the active one among them.
    const slots = tiled ? ids.map((id) => (id === active ? this.activeSlot : this.panes.get(id)!.slot)) : [this.activeSlot];
    this.area.replaceChildren(...slots);
    this.activeSlot.classList.toggle("tiled", tiled);
    this.label(this.activeSlot, tiled ? active : undefined);
    const n = slots.length;
    if (this.layout === "tile" && tiled) {
      const cols = Math.ceil(Math.sqrt(n));
      this.area.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      this.area.style.gridTemplateRows = `repeat(${Math.ceil(n / cols)}, 1fr)`;
    } else {
      this.area.style.gridTemplateColumns = "";
      this.area.style.gridTemplateRows = "";
    }
    slots.forEach((slot, i) => {
      const cascade = this.layout === "cascade" && tiled;
      slot.style.left = cascade ? `${i * CASCADE_STEP}px` : "";
      slot.style.top = cascade ? `${i * CASCADE_STEP}px` : "";
      slot.style.width = cascade ? `calc(100% - ${(n - 1) * CASCADE_STEP}px)` : "";
      slot.style.height = cascade ? `calc(100% - ${(n - 1) * CASCADE_STEP}px)` : "";
      slot.style.zIndex = cascade ? String(slot === this.activeSlot ? n + 1 : i + 1) : "";
    });

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
        console.warn("Could not show pane", err);
      }
    }
  }

  private makePane(id: ElementId): Pane {
    const { doc } = this.host;
    const slot = document.createElement("div");
    slot.className = "pane-slot tiled";
    const body = document.createElement("div");
    body.className = "pane-body";
    slot.append(body);
    const target = doc.get(id);
    const vp = target && target.category !== Cat.Schedule ? this.host.makeViewport(body) : null;
    // Clicking a pane makes it the active view (its tools and properties).
    // (The click goes no further: this pane's viewport is about to show another view.)
    slot.addEventListener(
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
    let tag = slot.querySelector<HTMLElement>(":scope > .pane-title");
    if (!id) return tag?.remove();
    if (!tag) {
      tag = document.createElement("div");
      tag.className = "pane-title";
      slot.append(tag);
    }
    const el = this.host.doc.get(id);
    tag.textContent = el?.category === Cat.Sheet ? `${(el.params as { number?: string }).number ?? ""} - ${el.name ?? ""}` : (el?.name ?? "");
  }
}
