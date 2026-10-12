import { showContextMenu, type MenuItem } from "./dialog.ts";
import { icon } from "./icons.ts";

// The ribbon (Revit-style): a File menu and Quick Access Toolbar, then tabs whose panels hold
// large and small buttons and split buttons with dropdowns. A contextual "Modify | <category>"
// label follows the selection. Tools and commands are the app's existing ones, by name.

export interface RibbonItem {
  label: string;
  icon?: string;
  title?: string;
  /** Large (icon over label); otherwise small, stacked three high. */
  large?: boolean;
  tool?: string;
  cmd?: string;
  /** Dropdown: alone it opens the menu; with a tool/cmd it's a split button (arrow opens it). */
  menu?: () => MenuItem[];
  /** Not available yet: shown disabled with this explanation. */
  soon?: string;
  /** Custom control (e.g. the family editor's Void checkbox). */
  html?: () => HTMLElement;
}
export interface RibbonPanel {
  title: string;
  items: RibbonItem[];
}
export interface RibbonTab {
  id: string;
  label: string;
  mode: "project" | "family" | "both";
  panels: RibbonPanel[];
}

export interface RibbonHost {
  tool(name: string): void;
  cmd(name: string): void;
  activeTool(): string;
  fileMenu(): MenuItem[];
}

const KEY = "open-bim.ribbon-tab";

export class Ribbon {
  private active: string;
  private family = false;
  private tabBar: HTMLElement;
  private body: HTMLElement;
  private contextLabel: HTMLElement;

  constructor(
    root: HTMLElement,
    private tabs: RibbonTab[],
    private host: RibbonHost,
    qat: RibbonItem[],
  ) {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      saved = null;
    }
    const usable = tabs.filter((t) => this.visible(t));
    this.active = usable.some((t) => t.id === saved) ? saved! : usable[0]!.id;
    const top = document.createElement("div");
    top.className = "ribbon-top";
    const file = document.createElement("button");
    file.className = "file-tab";
    file.textContent = "File";
    file.onclick = () => {
      const r = file.getBoundingClientRect();
      showContextMenu(r.left, r.bottom, host.fileMenu());
    };
    const quick = document.createElement("div");
    quick.className = "qat";
    for (const q of qat) quick.append(this.button(q, "qat-btn"));
    this.tabBar = document.createElement("div");
    this.tabBar.className = "ribbon-tabs";
    this.contextLabel = document.createElement("span");
    this.contextLabel.className = "ribbon-context";
    top.append(Object.assign(document.createElement("span"), { className: "brand", textContent: "Open-BIM" }), quick, file, this.tabBar, this.contextLabel);
    this.body = document.createElement("div");
    this.body.className = "ribbon-body";
    root.replaceChildren(top, this.body);
    this.render();
  }

  /** Family editor or project: shows that mode's tabs. */
  setMode(family: boolean): void {
    if (family === this.family) return;
    this.family = family;
    if (!this.visible(this.tab(this.active))) this.active = this.tabs.find((t) => this.visible(t))!.id;
    this.render();
  }

  /** Revit's contextual tab label, e.g. "Modify | Walls" (null when nothing is selected). */
  setContext(label: string | null): void {
    this.contextLabel.textContent = label ? `Modify | ${label}` : "";
    this.contextLabel.hidden = !label;
  }

  /** Re-mark the active tool's button. */
  markTool(): void {
    const t = this.host.activeTool();
    for (const b of this.body.querySelectorAll<HTMLElement>("[data-tool]")) b.classList.toggle("active", b.dataset.tool === t);
  }

  private tab(id: string): RibbonTab {
    return this.tabs.find((t) => t.id === id)!;
  }

  private visible(t: RibbonTab): boolean {
    return t.mode === "both" || (t.mode === "family") === this.family;
  }

  private render(): void {
    this.tabBar.replaceChildren(
      ...this.tabs
        .filter((t) => this.visible(t))
        .map((t) => {
          const b = document.createElement("button");
          b.className = `ribbon-tab${t.id === this.active ? " active" : ""}`;
          b.textContent = t.label;
          b.onclick = () => {
            this.active = t.id;
            try {
              localStorage.setItem(KEY, t.id);
            } catch {
              // not remembered
            }
            this.render();
          };
          return b;
        }),
    );
    const tab = this.tab(this.active);
    this.body.replaceChildren(
      ...tab.panels.map((p) => {
        const panel = document.createElement("div");
        panel.className = "rb-panel";
        const items = document.createElement("div");
        items.className = "rb-items";
        // Small buttons stack in columns of three.
        let column: HTMLElement | null = null;
        for (const it of p.items) {
          if (it.large || it.html) {
            column = null;
            items.append(it.html ? it.html() : this.button(it, "rb-large"));
            continue;
          }
          if (!column || column.childElementCount >= 3) {
            column = document.createElement("div");
            column.className = "rb-column";
            items.append(column);
          }
          column.append(this.button(it, "rb-small"));
        }
        panel.append(items, Object.assign(document.createElement("div"), { className: "rb-title", textContent: p.title }));
        return panel;
      }),
    );
    this.markTool();
  }

  private button(it: RibbonItem, cls: string): HTMLElement {
    const run = () => {
      if (it.tool) this.host.tool(it.tool);
      else if (it.cmd) this.host.cmd(it.cmd);
    };
    const b = document.createElement("button");
    b.className = cls;
    b.title = it.soon ? `${it.label} — ${it.soon}` : (it.title ?? it.label);
    b.disabled = !!it.soon;
    if (it.tool) b.dataset.tool = it.tool;
    if (it.cmd) b.dataset.cmd = it.cmd;
    const size = cls === "rb-large" ? 30 : cls === "qat-btn" ? 18 : 18;
    b.append(icon(it.icon, size));
    if (cls !== "qat-btn") b.append(Object.assign(document.createElement("span"), { textContent: it.label }));
    const openMenu = (from: HTMLElement) => {
      const r = from.getBoundingClientRect();
      showContextMenu(r.left, r.bottom + 2, it.menu!());
    };
    if (!it.menu) {
      b.onclick = run;
      return b;
    }
    if (!it.tool && !it.cmd) {
      b.append(Object.assign(document.createElement("span"), { className: "rb-caret", textContent: "▾" }));
      b.onclick = () => openMenu(b);
      return b;
    }
    // Split button: main part runs, the arrow opens the dropdown.
    b.onclick = run;
    const wrap = document.createElement("span");
    wrap.className = `rb-split ${cls}-split`;
    const arrow = document.createElement("button");
    arrow.className = "rb-arrow";
    arrow.textContent = "▾";
    arrow.title = `${it.label} options`;
    arrow.onclick = () => openMenu(wrap);
    wrap.append(b, arrow);
    return wrap;
  }
}
