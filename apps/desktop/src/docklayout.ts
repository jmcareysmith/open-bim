// Dockable panel layout (Revit-style): the Project Browser and Properties dock on the left or
// right of the view, stacked or as tabs, or float as windows. Pure state; `docking.ts` draws it.

export type Side = "left" | "right";
export interface Dock {
  /** Panels top to bottom (or tab order). */
  panels: string[];
  tabbed: boolean;
  /** Tab shown when tabbed. */
  active: string | null;
  width: number;
}
export interface Float {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Layout {
  left: Dock;
  right: Dock;
  floats: Record<string, Float>;
  collapsed: string[];
}

export type Target = { kind: "dock"; side: Side; index?: number } | { kind: "tab"; with: string } | { kind: "float"; at: Float };

export const DEFAULT_LAYOUT: Layout = {
  left: { panels: ["browser"], tabbed: false, active: "browser", width: 220 },
  right: { panels: ["properties"], tabbed: false, active: "properties", width: 270 },
  floats: {},
  collapsed: [],
};

const MIN_WIDTH = 160;
const MAX_WIDTH = 700;

const clone = (l: Layout): Layout => structuredClone(l);

/** Where a panel is. */
export function placeOf(l: Layout, id: string): Side | "float" | null {
  if (l.left.panels.includes(id)) return "left";
  if (l.right.panels.includes(id)) return "right";
  return l.floats[id] ? "float" : null;
}

function remove(l: Layout, id: string): void {
  for (const side of ["left", "right"] as const) {
    const d = l[side];
    d.panels = d.panels.filter((p) => p !== id);
    if (d.active === id) d.active = d.panels[0] ?? null;
    if (d.panels.length < 2) d.tabbed = false;
  }
  delete l.floats[id];
}

/** Move a panel to a dock side, into tabs with another panel, or out to float. */
export function movePanel(layout: Layout, id: string, to: Target): Layout {
  const l = clone(layout);
  if (to.kind === "tab" && to.with === id) return l;
  remove(l, id);
  if (to.kind === "float") {
    l.floats[id] = { ...to.at };
  } else if (to.kind === "dock") {
    const d = l[to.side];
    const i = Math.max(0, Math.min(to.index ?? d.panels.length, d.panels.length));
    d.panels.splice(i, 0, id);
    if (d.tabbed) d.active = id;
  } else {
    const side = placeOf(l, to.with);
    if (side === "left" || side === "right") {
      const d = l[side];
      d.panels.splice(d.panels.indexOf(to.with) + 1, 0, id);
      d.tabbed = true;
      d.active = id;
    } else {
      // Tabbing onto a floating panel docks both on the right as tabs.
      remove(l, to.with);
      l.right.panels.push(to.with, id);
      l.right.tabbed = true;
      l.right.active = id;
    }
  }
  l.collapsed = l.collapsed.filter((c) => c !== id);
  return l;
}

export function setActiveTab(layout: Layout, id: string): Layout {
  const l = clone(layout);
  for (const side of ["left", "right"] as const) if (l[side].panels.includes(id)) l[side].active = id;
  return l;
}

/** Split tabs back into a stack. */
export function untab(layout: Layout, side: Side): Layout {
  const l = clone(layout);
  l[side].tabbed = false;
  return l;
}

export function toggleCollapsed(layout: Layout, id: string): Layout {
  const l = clone(layout);
  l.collapsed = l.collapsed.includes(id) ? l.collapsed.filter((c) => c !== id) : [...l.collapsed, id];
  return l;
}

export function setDockWidth(layout: Layout, side: Side, width: number): Layout {
  const l = clone(layout);
  l[side].width = Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width)));
  return l;
}

/** A saved layout, checked: unknown panels dropped, missing ones put back where they belong. */
export function restoreLayout(saved: unknown, panels: string[]): Layout {
  const ok = (v: unknown): v is Layout => {
    const l = v as Layout;
    return !!l && Array.isArray(l.left?.panels) && Array.isArray(l.right?.panels) && typeof l.floats === "object" && Array.isArray(l.collapsed);
  };
  let l = ok(saved) ? clone(saved) : clone(DEFAULT_LAYOUT);
  const known = new Set(panels);
  for (const side of ["left", "right"] as const) {
    const d = l[side];
    d.panels = [...new Set(d.panels.filter((p) => known.has(p)))];
    if (!d.panels.includes(d.active ?? "")) d.active = d.panels[0] ?? null;
    if (d.panels.length < 2) d.tabbed = false;
    d.width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Number(d.width) || DEFAULT_LAYOUT[side].width));
  }
  for (const id of Object.keys(l.floats)) if (!known.has(id) || l.left.panels.includes(id) || l.right.panels.includes(id)) delete l.floats[id];
  l.collapsed = l.collapsed.filter((c) => known.has(c));
  for (const id of panels) {
    if (placeOf(l, id)) continue;
    const home: Side = DEFAULT_LAYOUT.left.panels.includes(id) ? "left" : "right";
    l = movePanel(l, id, { kind: "dock", side: home });
  }
  return l;
}
