import {
  movePanel,
  placeOf,
  restoreLayout,
  setActiveTab,
  setDockWidth,
  toggleCollapsed,
  untab,
  type Layout,
  type Side,
  type Target,
} from "./docklayout.ts";

// Dockable panels: drag a panel by its title to dock it left/right (stacked), onto another
// panel's title to tab them together, or anywhere else to float it. Floating panels resize from
// their corner. The layout is remembered in this browser.

const KEY = "open-bim.dock-layout";
/** How close to the view's edge a drop docks there, px. */
const EDGE = 90;

export interface PanelSpec {
  id: string;
  title: string;
  el: HTMLElement;
}

export class Docking {
  private layout: Layout;
  private docks: Record<Side, HTMLElement>;
  private hint: HTMLDivElement;

  constructor(
    private panels: PanelSpec[],
    private main: HTMLElement,
  ) {
    let saved: unknown = null;
    try {
      saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    } catch {
      saved = null;
    }
    this.layout = restoreLayout(saved, panels.map((p) => p.id));
    this.docks = { left: this.makeDock("left"), right: this.makeDock("right") };
    main.prepend(this.docks.left);
    main.append(this.docks.right);
    this.hint = document.createElement("div");
    this.hint.className = "dock-hint";
    this.hint.hidden = true;
    document.body.append(this.hint);
    for (const p of panels) this.decorate(p);
    this.render();
  }

  private makeDock(side: Side): HTMLElement {
    const d = document.createElement("div");
    d.className = `dock dock-${side}`;
    return d;
  }

  private set(l: Layout): void {
    this.layout = l;
    try {
      localStorage.setItem(KEY, JSON.stringify(l));
    } catch {
      // Storage unavailable: the layout just isn't remembered.
    }
    this.render();
  }

  /** Reset to the default layout (browser left, properties right). */
  reset(): void {
    this.set(restoreLayout(null, this.panels.map((p) => p.id)));
  }

  /** Title bar with collapse and float/dock buttons; dragging it moves the panel. */
  private decorate(p: PanelSpec): void {
    p.el.classList.add("panel");
    let h = p.el.querySelector("h2");
    if (!h) {
      h = document.createElement("h2");
      p.el.prepend(h);
    }
    h.classList.add("panel-head");
    h.replaceChildren(Object.assign(document.createElement("span"), { textContent: p.title }));
    const tools = document.createElement("span");
    tools.className = "panel-tools";
    const collapse = document.createElement("button");
    collapse.className = "panel-btn";
    collapse.title = "Collapse / expand";
    collapse.onclick = () => this.set(toggleCollapsed(this.layout, p.id));
    const float = document.createElement("button");
    float.className = "panel-btn";
    float.onclick = () => {
      if (placeOf(this.layout, p.id) === "float") {
        this.set(movePanel(this.layout, p.id, { kind: "dock", side: p.id === "browser" ? "left" : "right" }));
      } else {
        const r = p.el.getBoundingClientRect();
        this.set(movePanel(this.layout, p.id, { kind: "float", at: { x: r.left + 40, y: r.top + 40, w: Math.max(240, r.width), h: Math.min(500, r.height) } }));
      }
    };
    tools.append(collapse, float);
    h.append(tools);
    h.onpointerdown = (ev) => {
      if (ev.button !== 0 || (ev.target as HTMLElement).closest("button")) return;
      this.drag(p, ev);
    };
    // Floating panels remember their size after a corner resize.
    new ResizeObserver(() => {
      const f = this.layout.floats[p.id];
      if (!f || !p.el.isConnected || !p.el.offsetWidth || !p.el.offsetHeight || p.el.classList.contains("collapsed")) return;
      const w = Math.round(p.el.offsetWidth);
      const hgt = Math.round(p.el.offsetHeight);
      if (Math.abs(w - f.w) > 2 || Math.abs(hgt - f.h) > 2) {
        this.layout = { ...this.layout, floats: { ...this.layout.floats, [p.id]: { ...f, w, h: hgt } } };
        try {
          localStorage.setItem(KEY, JSON.stringify(this.layout));
        } catch {
          // ignore
        }
      }
    }).observe(p.el);
  }

  private spec(id: string): PanelSpec {
    return this.panels.find((p) => p.id === id)!;
  }

  private render(): void {
    const l = this.layout;
    for (const side of ["left", "right"] as const) {
      const d = l[side];
      const dock = this.docks[side];
      dock.replaceChildren();
      dock.hidden = !d.panels.length;
      // Every panel collapsed: the dock shrinks to a thin strip of titles (click one to expand).
      const strip = !d.tabbed && d.panels.length > 0 && d.panels.every((id) => l.collapsed.includes(id));
      dock.classList.toggle("all-collapsed", strip);
      dock.style.width = strip ? "" : `${d.width}px`;
      if (d.tabbed) {
        const strip = document.createElement("div");
        strip.className = "dock-tabs";
        for (const id of d.panels) {
          const t = document.createElement("button");
          t.textContent = this.spec(id).title;
          t.classList.toggle("active", id === d.active);
          t.title = "Click to show; drag to move or detach";
          t.onclick = () => this.set(setActiveTab(this.layout, id));
          t.onpointerdown = (ev) => {
            if (ev.button === 0) this.drag(this.spec(id), ev);
          };
          strip.append(t);
        }
        const split = document.createElement("button");
        split.className = "panel-btn";
        split.textContent = "☰";
        split.title = "Show stacked instead of as tabs";
        split.onclick = () => this.set(untab(this.layout, side));
        strip.append(split);
        dock.append(strip);
      }
      for (const id of d.panels) {
        const p = this.spec(id);
        p.el.classList.remove("floating");
        Object.assign(p.el.style, { left: "", top: "", width: "", height: "" });
        p.el.hidden = d.tabbed && id !== d.active;
        p.el.classList.toggle("in-tabs", d.tabbed);
        dock.append(p.el);
      }
      const grip = document.createElement("div");
      grip.className = "dock-resizer";
      grip.title = "Drag to resize";
      grip.onpointerdown = (ev) => this.resizeDock(side, ev);
      if (!strip) dock.append(grip);
    }
    for (const [id, f] of Object.entries(l.floats)) {
      const p = this.spec(id);
      p.el.hidden = false;
      p.el.classList.add("floating");
      p.el.classList.remove("in-tabs");
      const x = Math.max(0, Math.min(f.x, window.innerWidth - 120));
      const y = Math.max(0, Math.min(f.y, window.innerHeight - 40));
      Object.assign(p.el.style, { left: `${x}px`, top: `${y}px`, width: `${Math.max(200, f.w)}px`, height: `${Math.max(120, f.h)}px` });
      document.body.append(p.el);
    }
    for (const p of this.panels) {
      const collapsed = l.collapsed.includes(p.id);
      p.el.classList.toggle("collapsed", collapsed);
      const [collapse, float] = p.el.querySelectorAll<HTMLButtonElement>(".panel-tools .panel-btn");
      collapse!.textContent = collapsed ? "▸" : "▾";
      const floating = placeOf(l, p.id) === "float";
      float!.textContent = floating ? "↩" : "⧉";
      float!.title = floating ? "Dock" : "Float (detach)";
    }
  }

  private resizeDock(side: Side, ev: PointerEvent): void {
    ev.preventDefault();
    const el = ev.target as HTMLElement;
    el.setPointerCapture(ev.pointerId);
    const x0 = ev.clientX;
    const w0 = this.layout[side].width;
    el.onpointermove = (mv) => {
      const dx = mv.clientX - x0;
      this.docks[side].style.width = `${Math.max(160, Math.min(700, w0 + (side === "left" ? dx : -dx)))}px`;
    };
    el.onpointerup = (up) => {
      el.onpointermove = el.onpointerup = null;
      const dx = up.clientX - x0;
      this.set(setDockWidth(this.layout, side, w0 + (side === "left" ? dx : -dx)));
    };
  }

  /** Where a drop at (x, y) would put panel `id`, and the rectangle to highlight. */
  private targetAt(id: string, x: number, y: number, grab: { dx: number; dy: number; w: number; h: number }): { target: Target; rect: DOMRect } {
    // Onto another panel's title (or the tab strip): tab together.
    for (const p of this.panels) {
      if (p.id === id || p.el.hidden) continue;
      const head = (p.el.classList.contains("in-tabs") ? p.el.parentElement?.querySelector(".dock-tabs") : p.el.querySelector("h2")) as HTMLElement | null;
      const r = head?.getBoundingClientRect();
      if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { target: { kind: "tab", with: p.id }, rect: p.el.getBoundingClientRect() };
    }
    const m = this.main.getBoundingClientRect();
    if (y >= m.top && y <= m.bottom) {
      for (const side of ["left", "right"] as const) {
        const dock = this.docks[side];
        const near = side === "left" ? x - m.left < EDGE : m.right - x < EDGE;
        const over = !dock.hidden && (() => {
          const r = dock.getBoundingClientRect();
          return x >= r.left && x <= r.right;
        })();
        if (!near && !over) continue;
        // Stack position: above the first panel whose middle is below the pointer.
        const others = this.layout[side].panels.filter((p) => p !== id);
        let index = others.length;
        for (const [i, p] of others.entries()) {
          const r = this.spec(p).el.getBoundingClientRect();
          if (y < r.top + r.height / 2) {
            index = i;
            break;
          }
        }
        const w = this.layout[side].width;
        const rect = new DOMRect(side === "left" ? m.left : m.right - w, m.top, w, m.height);
        return { target: { kind: "dock", side, index }, rect };
      }
    }
    const at = { x: x - grab.dx, y: y - grab.dy, w: grab.w, h: grab.h };
    return { target: { kind: "float", at }, rect: new DOMRect(at.x, at.y, at.w, at.h) };
  }

  /**
   * Drag a panel by its title (or tab): it lifts out and follows the pointer at once; drop it at a
   * side to dock, on another title to tab, or anywhere else to leave it floating. A click without
   * dragging expands a collapsed panel.
   */
  private drag(p: PanelSpec, ev: PointerEvent): void {
    ev.preventDefault();
    const r = p.el.getBoundingClientRect();
    const wasFloating = placeOf(this.layout, p.id) === "float";
    const collapsed = this.layout.collapsed.includes(p.id);
    const saved = this.layout.floats[p.id];
    // Docked panels lift out at a window size; hidden tabs and collapsed panels have no size of their own.
    const w = wasFloating && r.width ? r.width : Math.max(260, Math.min(360, r.width || 280));
    const h = wasFloating && !collapsed && r.height ? r.height : (saved?.h ?? Math.max(240, Math.min(520, collapsed ? 480 : r.height || 480)));
    const grab = { dx: r.width ? Math.min(ev.clientX - r.left, w - 40) : 40, dy: r.height ? Math.min(ev.clientY - r.top, 20) : 12, w, h };
    const x0 = ev.clientX;
    const y0 = ev.clientY;
    let moved = false;
    let lifted = wasFloating;
    let target: Target | null = null;
    const move = (mv: PointerEvent) => {
      if (!moved && Math.hypot(mv.clientX - x0, mv.clientY - y0) < 6) return;
      moved = true;
      const at = { x: mv.clientX - grab.dx, y: mv.clientY - grab.dy, w: grab.w, h: grab.h };
      if (!lifted) {
        // Undock now, so the panel itself follows the pointer.
        lifted = true;
        this.layout = movePanel(this.layout, p.id, { kind: "float", at });
        this.render();
      }
      Object.assign(p.el.style, { left: `${at.x}px`, top: `${at.y}px` });
      const t = this.targetAt(p.id, mv.clientX, mv.clientY, grab);
      target = t.target;
      this.hint.hidden = t.target.kind === "float";
      if (!this.hint.hidden) Object.assign(this.hint.style, { left: `${t.rect.x}px`, top: `${t.rect.y}px`, width: `${t.rect.width}px`, height: `${t.rect.height}px` });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this.hint.hidden = true;
      if (!moved) {
        if (collapsed) this.set(toggleCollapsed(this.layout, p.id));
        return;
      }
      this.set(target ? movePanel(this.layout, p.id, target) : this.layout);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
}
