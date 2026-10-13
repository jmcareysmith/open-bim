import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId } from "../element.ts";
import { Cat } from "./architecture.ts";
import type { LinePattern } from "./graphics.ts";

// Object Styles (Revit: Manage → Object Styles) and Line Weights (Manage → Additional Settings →
// Line Weights). Every category has a pen for its projection and cut lines (and optionally a
// colour and pattern); views start from these and V/G overrides lay on top. Pens 1–16 are paper
// widths that depend on the view scale, as in Revit's model line weights table.

export type StyleLine = { weight: number; color?: number | null; pattern?: LinePattern | null };
export type ObjectStyle = { projection: StyleLine; cut?: StyleLine };
export type ObjectStylesParams = { styles: Record<string, Partial<ObjectStyle>> };

registerCategory({ name: Cat.ObjectStyles, dependencies: () => [], cascadeDelete: false, isType: false });

/** Revit-like defaults for an architectural template (pen numbers). */
export const DEFAULT_OBJECT_STYLES: Record<string, ObjectStyle> = {
  [Cat.Wall]: { projection: { weight: 2 }, cut: { weight: 5 } },
  [Cat.Floor]: { projection: { weight: 1 }, cut: { weight: 3 } },
  [Cat.Ceiling]: { projection: { weight: 1 }, cut: { weight: 3 } },
  [Cat.Roof]: { projection: { weight: 2 }, cut: { weight: 4 } },
  [Cat.Door]: { projection: { weight: 1 }, cut: { weight: 3 } },
  [Cat.Window]: { projection: { weight: 1 }, cut: { weight: 3 } },
  [Cat.Stair]: { projection: { weight: 1 }, cut: { weight: 3 } },
  [Cat.Railing]: { projection: { weight: 1 }, cut: { weight: 2 } },
  [Cat.Ramp]: { projection: { weight: 1 }, cut: { weight: 3 } },
  [Cat.Column]: { projection: { weight: 2 }, cut: { weight: 5 } },
  [Cat.Beam]: { projection: { weight: 2 }, cut: { weight: 4 } },
  [Cat.PadFooting]: { projection: { weight: 1 }, cut: { weight: 4 } },
  [Cat.StripFooting]: { projection: { weight: 1 }, cut: { weight: 4 } },
  [Cat.Toposolid]: { projection: { weight: 1 }, cut: { weight: 3 } },
  [Cat.BuildingPad]: { projection: { weight: 1 }, cut: { weight: 3 } },
  [Cat.Duct]: { projection: { weight: 1 }, cut: { weight: 2 } },
  [Cat.Pipe]: { projection: { weight: 1 }, cut: { weight: 2 } },
  Furniture: { projection: { weight: 1 }, cut: { weight: 2 } },
  Casework: { projection: { weight: 1 }, cut: { weight: 2 } },
  GenericModel: { projection: { weight: 1 }, cut: { weight: 2 } },
  Mass: { projection: { weight: 1 }, cut: { weight: 1 } },
};

/** Pen for anything not in the table. */
const FALLBACK: ObjectStyle = { projection: { weight: 1 }, cut: { weight: 2 } };

/** Scales the line weights table has columns for (1:n). */
export const WEIGHT_SCALES = [10, 20, 50, 100, 200, 500];

/**
 * Paper widths (mm) per pen at each scale, after Revit's default model line weights: pens get
 * finer as the scale gets smaller.
 */
export const LINE_WEIGHTS: number[][] = [
  /* 1 */ [0.18, 0.18, 0.18, 0.1, 0.1, 0.1],
  /* 2 */ [0.25, 0.25, 0.25, 0.18, 0.18, 0.1],
  /* 3 */ [0.35, 0.35, 0.35, 0.25, 0.18, 0.18],
  /* 4 */ [0.5, 0.5, 0.5, 0.35, 0.25, 0.18],
  /* 5 */ [0.7, 0.7, 0.7, 0.5, 0.35, 0.25],
  /* 6 */ [1, 1, 1, 0.7, 0.5, 0.35],
  /* 7 */ [1.4, 1.4, 1.4, 1, 0.7, 0.5],
  /* 8 */ [2, 2, 2, 1.4, 1, 0.7],
  /* 9 */ [2.8, 2.8, 2.8, 2, 1.4, 1],
  /* 10 */ [4, 4, 4, 2.8, 2, 1.4],
  /* 11 */ [5, 5, 5, 4, 2.8, 2],
  /* 12 */ [6, 6, 6, 5, 4, 2.8],
  /* 13 */ [7, 7, 7, 6, 5, 4],
  /* 14 */ [8, 8, 8, 7, 6, 5],
  /* 15 */ [9, 9, 9, 8, 7, 6],
  /* 16 */ [10, 10, 10, 9, 8, 7],
];

/** Paper width (mm) of pen `pen` in a view at 1:`scale` (the nearest column at or finer). */
export function penWidth(pen: number, scale: number): number {
  const row = LINE_WEIGHTS[Math.max(1, Math.min(16, Math.round(pen))) - 1]!;
  let col = WEIGHT_SCALES.findIndex((s) => s >= scale);
  if (col < 0) col = WEIGHT_SCALES.length - 1;
  return row[col]!;
}

export function objectStylesElement(doc: Document): Element<ObjectStylesParams> | undefined {
  return doc.byCategory<ObjectStylesParams>(Cat.ObjectStyles)[0];
}

/** The category Object Styles use for an element: a family instance takes its family's category. */
export function styleCategory(doc: Document, el: Element): string {
  if (el.category === Cat.FamilyInstance) {
    const def = doc.get((el.params as { familyId?: ElementId }).familyId ?? "");
    const c = (def?.params as { category?: string } | undefined)?.category;
    if (c) return c;
  }
  return el.category;
}

/** The object style for a category: the project's, else the default. */
export function objectStyle(doc: Document, category: string): ObjectStyle {
  const base = DEFAULT_OBJECT_STYLES[category] ?? FALLBACK;
  const own = objectStylesElement(doc)?.params.styles[category];
  if (!own) return base;
  return { projection: { ...base.projection, ...own.projection }, cut: { ...(base.cut ?? base.projection), ...own.cut } };
}

/** Set part of a category's object style (creates the Object Styles element on first use). */
export function setObjectStyle(tx: Transaction, doc: Document, category: string, patch: { projection?: Partial<StyleLine>; cut?: Partial<StyleLine> }): void {
  const el = objectStylesElement(doc) ?? (tx.create<ObjectStylesParams>(Cat.ObjectStyles, { styles: {} }, { name: "Object Styles" }) as Element<ObjectStylesParams>);
  const cur = el.params.styles[category] ?? {};
  const next: Partial<ObjectStyle> = {
    ...cur,
    ...(patch.projection ? { projection: { ...(cur.projection ?? objectStyle(doc, category).projection), ...patch.projection } as StyleLine } : {}),
    ...(patch.cut ? { cut: { ...(cur.cut ?? objectStyle(doc, category).cut ?? { weight: 2 }), ...patch.cut } as StyleLine } : {}),
  };
  tx.update<ObjectStylesParams>(el.id, { styles: { ...el.params.styles, [category]: next } });
}
