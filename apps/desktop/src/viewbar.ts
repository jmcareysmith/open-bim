import {
  Cat,
  VISUAL_STYLES,
  effectiveGraphics,
  type DetailLevel,
  type Document,
  type ElementId,
  type View,
  type ViewParams,
  type VisualStyle,
} from "@open-bim/core";
import { showContextMenu } from "./dialog.ts";
import { openMaterialBrowser } from "./materialbrowser.ts";
import { openShadowSettings, openSunSettings } from "./sundialogs.ts";
import type { Viewport } from "./viewport.ts";

// Under the model window, Revit-style: tabs for the open views/sheets/schedules, then the view
// control bar (scale, detail level, visual style, temporary hide/isolate, reveal hidden).

export interface ViewBarHost {
  doc: Document;
  viewport: Viewport;
  activeViewId(): ElementId | undefined;
  setActiveView(id: ElementId): void;
  run(command: string): void;
  status(text: string): void;
}

const SCALES = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
const DETAIL: { value: DetailLevel; label: string; title: string }[] = [
  { value: "coarse", label: "C", title: "Coarse" },
  { value: "medium", label: "M", title: "Medium" },
  { value: "fine", label: "F", title: "Fine" },
];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

function selectEl(title: string, disabled: boolean): HTMLSelectElement {
  const s = document.createElement("select");
  s.title = title;
  s.disabled = disabled;
  return s;
}

export class ViewBar {
  /** Open views in tab order. */
  private open: ElementId[] = [];

  constructor(
    private host: ViewBarHost,
    private tabs: HTMLElement,
    private bar: HTMLElement,
  ) {}

  /** Open views and sheets in tab order (for tiling). */
  openViews(): ElementId[] {
    return [...this.open];
  }

  /** Forget the open tabs (new or opened project). */
  reset(): void {
    this.open = [];
  }

  render(): void {
    const { doc } = this.host;
    const active = this.host.activeViewId();
    this.open = this.open.filter((id) => doc.has(id));
    if (active && doc.has(active) && !this.open.includes(active)) this.open.push(active);
    this.renderTabs(active);
    this.renderBar(active);
  }

  close(id: ElementId): void {
    if (this.open.length < 2) return this.host.status("The last open view stays open.");
    const i = this.open.indexOf(id);
    this.open.splice(i, 1);
    if (id === this.host.activeViewId()) this.host.setActiveView(this.open[Math.min(i, this.open.length - 1)]!);
    else this.render();
  }

  private renderTabs(active: ElementId | undefined): void {
    const { doc } = this.host;
    this.tabs.replaceChildren(
      ...this.open.map((id) => {
        const v = doc.get(id)!;
        const kind = v.category === Cat.Sheet ? "Sheet" : v.category === Cat.Schedule ? "Schedule" : KIND[(v.params as ViewParams).kind] ?? "View";
        const label = v.category === Cat.Sheet ? `${(v.params as { number?: string }).number ?? ""} - ${v.name ?? ""}` : (v.name ?? id);
        const x = el("button", { className: "tab-close", title: "Close", textContent: "×" });
        x.onclick = (ev) => {
          ev.stopPropagation();
          this.close(id);
        };
        const tab = el("div", { className: `view-tab${id === active ? " active" : ""}`, title: `${kind}: ${label}` }, el("span", { className: "tab-kind", textContent: kind }), el("span", { textContent: label }), x);
        tab.onclick = () => id !== active && this.host.setActiveView(id);
        // Middle-click closes, as in browsers.
        tab.onauxclick = (ev) => ev.button === 1 && this.close(id);
        tab.oncontextmenu = (ev) => {
          ev.preventDefault();
          showContextMenu(ev.clientX, ev.clientY, [
            { label: "Close", action: () => this.close(id) },
            {
              label: "Close Others",
              action: () => {
                this.open = [id];
                if (id !== active) this.host.setActiveView(id);
                else this.render();
              },
            },
          ]);
        };
        return tab;
      }),
    );
    // Window arrangements (Revit's Tile / Cascade / Tab Views), at the end of the tabs.
    const n = this.open.length;
    const arrange = el("button", { className: "tab-arrange", title: "Arrange view windows: tile all, 2, 3 or 4, cascade, or back to tabs", textContent: "\u25a6 \u25be" });
    arrange.onclick = () => {
      const r = arrange.getBoundingClientRect();
      const tiles = [2, 3, 4].filter((k) => k < n).map((k) => ({ label: `Tile ${k} (most recent)`, action: () => this.host.run(`tile${k}`) }));
      showContextMenu(r.left, r.top - 4, [
        { heading: n > 1 ? `${n} open views` : "Open another view to tile" },
        { label: "Tile all", hint: "WT", action: () => this.host.run("tileViews") },
        ...tiles,
        { label: "Cascade", hint: "WC", action: () => this.host.run("cascadeViews") },
        { label: "Tab Views", hint: "TW", action: () => this.host.run("tabViews") },
      ]);
    };
    this.tabs.append(arrange);
  }

  private renderBar(active: ElementId | undefined): void {
    const { doc, viewport } = this.host;
    const v = active ? doc.get(active) : undefined;
    this.bar.replaceChildren();
    if (!v || v.category !== Cat.View) {
      this.bar.append(el("span", { className: "muted", textContent: v?.category === Cat.Sheet ? "Sheet" : v ? "Schedule" : "" }));
      return;
    }
    const view = v as View;
    const p = view.params;
    const templated = !!p.templateId && doc.has(p.templateId);
    const g = effectiveGraphics(doc, view);
    const set = (name: string, patch: Partial<ViewParams>) => {
      try {
        doc.transact(name, (tx) => tx.update<ViewParams>(view.id, patch));
      } catch (e) {
        this.host.status(`⚠ ${(e as Error).message}`);
      }
    };
    const lockNote = templated ? " (set by the view template)" : "";

    if (p.kind !== "3d" && p.kind !== "legend") {
      const scale = selectEl(`View scale${lockNote}`, templated);
      const list = SCALES.includes(g.scale) ? SCALES : [...SCALES, g.scale].sort((a, b) => a - b);
      for (const s of list) scale.append(new Option(`1 : ${s}`, String(s), false, s === g.scale));
      scale.onchange = () => set("View scale", { scale: Number(scale.value) });
      this.bar.append(scale);
    }

    const detail = el("span", { className: "bar-group", title: `Detail level${lockNote}` });
    for (const d of DETAIL) {
      const b = el("button", { textContent: d.label, title: `Detail level: ${d.title}${lockNote}`, disabled: templated });
      b.classList.toggle("active", g.detailLevel === d.value);
      b.onclick = () => set("Detail level", { detailLevel: d.value });
      detail.append(b);
    }
    this.bar.append(detail);

    const planLike = p.kind === "floorPlan" || p.kind === "callout" || p.kind === "areaPlan";
    // Every model view (plans, callouts, sections, elevations, details, 3D) has visual styles,
    // sun, shadows and lighting; legends draw no model.
    const modelView = p.kind !== "legend";
    if (modelView) {
      const style = selectEl("Visual style", false);
      const current = p.visualStyle ?? (p.kind === "3d" ? "shaded" : "hiddenLine");
      // The path-traced Rendered style is a 3D view thing.
      for (const s of VISUAL_STYLES.filter((x) => p.kind === "3d" || x.value !== "rendered")) style.append(new Option(s.label, s.value, false, s.value === current));
      style.onchange = () => {
        const value = style.value as VisualStyle;
        set("Visual style", { visualStyle: value });
        // Rendered = the path tracer.
        if (value === "rendered") this.host.run("render");
      };
      this.bar.append(style);
    }

    if (modelView) {
      // Sun Settings and Shadows (Revit's view control bar).
      const sunBtn = el("button", { textContent: "\u2600 Sun", title: "Sun Settings: solar study (still, single-day, multi-day) or set sun angles; sun brightness" });
      sunBtn.onclick = () => openSunSettings(this.host, view);
      const shadows = el("button", { textContent: "\u25d0 Shadows", title: "Shadows on/off" });
      shadows.classList.toggle("active", !!p.shadows);
      shadows.onclick = () => set(p.shadows ? "Shadows off" : "Shadows on", { shadows: !p.shadows });
      const shadowOpts = el("button", { textContent: "\u25be", title: "Graphic Display Options: style, edges, transparency, silhouettes, shadows, lighting, depth cueing" });
      shadowOpts.onclick = () => openShadowSettings(this.host, view);
      this.bar.append(sunBtn, shadows, shadowOpts);
    }
    const mats = el("button", { textContent: "\u25a6 Materials", title: "Material Browser: colours, patterns and render appearance" });
    mats.onclick = () => openMaterialBrowser(doc, (t) => this.host.status(t));
    this.bar.append(mats);

    const temp = el("button", { textContent: "🕶 Hide/Isolate", title: "Temporary Hide/Isolate" });
    temp.classList.toggle("active", viewport.visibility.active);
    temp.onclick = () => {
      const r = temp.getBoundingClientRect();
      showContextMenu(r.left, r.top - 4, [
        { heading: "Temporary Hide/Isolate" },
        { label: "Isolate Category", hint: "⇧I", action: () => this.host.run("isolateCategory") },
        { label: "Hide Category", hint: "⇧H", action: () => this.host.run("hideCategory") },
        { label: "Isolate Element", hint: "I", action: () => this.host.run("isolate") },
        { label: "Hide Element", hint: "H", action: () => this.host.run("hide") },
        "-",
        { label: "Reset Temporary Hide/Isolate", hint: "U", disabled: !viewport.visibility.active, action: () => this.host.run("resetVisibility") },
      ]);
    };
    const reveal = el("button", { textContent: "💡 Reveal Hidden", title: "Reveal hidden elements (shown in magenta)" });
    reveal.classList.toggle("active", viewport.revealing);
    reveal.onclick = () => {
      viewport.setRevealHidden(!viewport.revealing);
      this.render();
      this.host.status(viewport.revealing ? "Revealing hidden elements: they show in magenta." : "Hidden elements hidden again.");
    };
    this.bar.append(temp, reveal);
  }
}

const KIND: Record<string, string> = {
  floorPlan: "Floor Plan",
  "3d": "3D View",
  section: "Section",
  elevation: "Elevation",
  callout: "Callout",
  areaPlan: "Area Plan",
  legend: "Legend",
};
