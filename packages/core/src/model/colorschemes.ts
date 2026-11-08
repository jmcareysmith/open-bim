import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat } from "./architecture.ts";
import type { RoomParams } from "./rooms.ts";
import type { ViewParams } from "./viewdefs.ts";

// Colour schemes (Revit: Edit Color Scheme) colour rooms (or areas) in a plan by a value — name,
// department, occupancy, number, or area in ranges. A plan picks one scheme; values without a
// stored entry get a stable colour of their own. A Color Fill Legend in the view lists them.

export type ColorSchemeBy = "name" | "department" | "occupancy" | "number" | "area";

export type ColorSchemeEntry = { value: string; color: number; visible?: boolean };

export type ColorSchemeParams = {
  /** What it colours: rooms, or areas in area plans. */
  category: "Room" | "Area";
  /** Heading on the legend. */
  title: string;
  by: ColorSchemeBy;
  /** "area": range size, m² (default 10). */
  rangeStep?: number;
  entries: ColorSchemeEntry[];
};
export type ColorScheme = Element<ColorSchemeParams>;

export type ColorFillLegendParams = { viewId: ElementId; position: Vec2; size: number };
export type ColorFillLegend = Element<ColorFillLegendParams>;

registerCategory({ name: Cat.ColorScheme, dependencies: () => [], cascadeDelete: false, isType: false });
registerCategory({
  name: Cat.ColorFillLegend,
  // The view (and through it the scheme): the legend's contents follow them.
  dependencies: (el) => [(el.params as ColorFillLegendParams).viewId],
  cascadeDelete: true,
  isType: false,
});

/** Soft, distinct fills (Revit-like pastel defaults). */
export const SCHEME_PALETTE = [0xf4b6b6, 0xb6d7f4, 0xc6e8b8, 0xf7dca4, 0xd9c2ee, 0xa9e3dd, 0xf5c6e0, 0xe0e0a8, 0xbfc8f0, 0xf2c9a8, 0xbde5f0, 0xd6e6c3];

export const COLOR_SCHEME_BY: { value: ColorSchemeBy; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "department", label: "Department" },
  { value: "occupancy", label: "Occupancy" },
  { value: "number", label: "Number" },
  { value: "area", label: "Area (ranges)" },
];

export function colorSchemes(doc: Document, category?: "Room" | "Area"): ColorScheme[] {
  return (doc.byCategory<ColorSchemeParams>(Cat.ColorScheme) as ColorScheme[]).filter((s) => !category || s.params.category === category);
}

export function createColorScheme(tx: Transaction, name: string, p: Partial<ColorSchemeParams> = {}): ColorScheme {
  const by = p.by ?? "name";
  return tx.create<ColorSchemeParams>(
    Cat.ColorScheme,
    {
      category: p.category ?? "Room",
      title: p.title ?? `${COLOR_SCHEME_BY.find((b) => b.value === by)!.label.replace(" (ranges)", "")} Legend`,
      by,
      rangeStep: p.rangeStep ?? 10,
      entries: p.entries ?? [],
    },
    { name },
  ) as ColorScheme;
}

/**
 * The value a room or area has for a scheme ("" = none). Area schemes need the area (m²), which the
 * caller finds from the boundary (geometry).
 */
export function schemeValue(scheme: ColorScheme, el: Element, areaM2: number | null = null): string {
  const p = el.params as Partial<RoomParams> & { number?: string };
  switch (scheme.params.by) {
    case "name":
      return el.name ?? "";
    case "department":
      return p.department ?? "";
    case "occupancy":
      return p.occupancy ?? "";
    case "number":
      return p.number ?? "";
    case "area": {
      if (areaM2 === null) return "";
      const step = scheme.params.rangeStep && scheme.params.rangeStep > 0 ? scheme.params.rangeStep : 10;
      const lo = Math.floor(areaM2 / step) * step;
      return `${lo}–${lo + step} m²`;
    }
  }
}

/** A stable colour for a value with no entry (the same value always gets the same colour). */
export function autoSchemeColor(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return SCHEME_PALETTE[h % SCHEME_PALETTE.length]!;
}

/** The fill for a value: its entry's colour (null when hidden), else its automatic colour; none for "". */
export function schemeColor(scheme: ColorScheme, value: string): number | null {
  if (!value) return null;
  const e = scheme.params.entries.find((x) => x.value === value);
  if (e) return e.visible === false ? null : e.color;
  return autoSchemeColor(value);
}

/** Entries for the values in use, in legend order: stored ones first (their order), then new ones sorted. */
export function schemeLegend(scheme: ColorScheme, values: string[]): ColorSchemeEntry[] {
  const used = new Set(values.filter(Boolean));
  const stored = scheme.params.entries.filter((e) => used.has(e.value));
  const known = new Set(stored.map((e) => e.value));
  const fresh = [...used].filter((v) => !known.has(v)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const all: ColorSchemeEntry[] = [...stored, ...fresh.map((value) => ({ value, color: autoSchemeColor(value) }))];
  return all.filter((e) => e.visible !== false);
}

/** Set (or add) one value's entry: its colour or whether it shows. */
export function setColorSchemeEntry(tx: Transaction, doc: Document, schemeId: ElementId, value: string, patch: Partial<ColorSchemeEntry>): void {
  const s = doc.require<ColorSchemeParams>(schemeId);
  if (s.category !== Cat.ColorScheme) throw new Error("Not a colour scheme");
  const entries = [...s.params.entries];
  const i = entries.findIndex((e) => e.value === value);
  const cur = i >= 0 ? entries[i]! : { value, color: autoSchemeColor(value) };
  const next = { ...cur, ...patch };
  if (i >= 0) entries[i] = next;
  else entries.push(next);
  tx.update<ColorSchemeParams>(schemeId, { entries });
}

export function createColorFillLegend(tx: Transaction, doc: Document, viewId: ElementId, position: Vec2, size = 2.5): ColorFillLegend {
  const v = doc.require<ViewParams>(viewId);
  if (v.category !== Cat.View || !["floorPlan", "callout", "areaPlan"].includes(v.params.kind)) throw new Error("Colour fill legends go in plans");
  if (!v.params.colorScheme) throw new Error("Pick a colour scheme for this view first (view Properties)");
  return tx.create<ColorFillLegendParams>(Cat.ColorFillLegend, { viewId, position: { ...position }, size }) as ColorFillLegend;
}
