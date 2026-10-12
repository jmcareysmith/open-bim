import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat } from "./architecture.ts";
import { projectSettings } from "./settings.ts";
import type { ViewParams } from "./viewdefs.ts";

// Annotation symbols (Revit: Annotate → Symbol): built-in north arrow, graphic scale bar and break
// line. A symbol belongs to a view or sheet, sits at a point in its 2D space and is sized on paper,
// so it reads the same at any view scale. A north arrow can follow true north (from the project's
// shared coordinates) instead of the drawing's up direction.

export type SymbolKind = "northArrow" | "scaleBar" | "breakLine";

export const SYMBOL_KINDS: { value: SymbolKind; label: string }[] = [
  { value: "northArrow", label: "North Arrow" },
  { value: "scaleBar", label: "Scale Bar" },
  { value: "breakLine", label: "Break Line" },
];

export type SymbolParams = {
  viewId: ElementId;
  kind: SymbolKind;
  position: Vec2;
  /** Radians anticlockwise. North arrows that follow true north ignore it. */
  rotation: number;
  /** Overall size on paper, mm (north arrow height, scale bar length, break line length). */
  size: number;
  /** North arrows: point to true north (shared coordinates) rather than straight up. */
  trueNorth?: boolean;
};
export type AnnotationSymbol = Element<SymbolParams>;

export const DEFAULT_SYMBOL_SIZE: Record<SymbolKind, number> = { northArrow: 15, scaleBar: 50, breakLine: 20 };

registerCategory({
  name: Cat.Symbol,
  dependencies: (el) => [(el.params as SymbolParams).viewId],
  cascadeDelete: true,
  isType: false,
});

export function createSymbol(
  tx: Transaction,
  doc: Document,
  viewId: ElementId,
  kind: SymbolKind,
  position: Vec2,
  opts: { rotation?: number; size?: number; trueNorth?: boolean } = {},
): AnnotationSymbol {
  const owner = doc.require(viewId);
  if (owner.category !== Cat.View && owner.category !== Cat.Sheet) throw new Error("Symbols go in a view or on a sheet");
  if (owner.category === Cat.View && (owner.params as ViewParams).kind === "3d") throw new Error("Symbols go in plans, sections, elevations or sheets, not 3D views");
  const size = opts.size ?? DEFAULT_SYMBOL_SIZE[kind];
  if (!(size > 0)) throw new Error("Symbol size must be positive");
  return tx.create<SymbolParams>(Cat.Symbol, {
    viewId,
    kind,
    position: { ...position },
    rotation: opts.rotation ?? 0,
    size,
    ...(kind === "northArrow" ? { trueNorth: opts.trueNorth ?? false } : {}),
  }) as AnnotationSymbol;
}

/**
 * Direction a symbol points, radians anticlockwise from the drawing's +X: north arrows point up
 * (+90°) plus their rotation, or to true north. Project Y is project north; the site location's
 * rotation turns project X away from grid east, so true north sits that far clockwise of +Y.
 */
export function symbolAngle(doc: Document, s: AnnotationSymbol): number {
  if (s.params.kind === "northArrow") {
    if (s.params.trueNorth) return Math.PI / 2 - (projectSettings(doc)?.params.location?.rotation ?? 0);
    return Math.PI / 2 + s.params.rotation;
  }
  return s.params.rotation;
}

/** Paper-to-model factor for a symbol's owner: the view scale, or 1 on sheets. */
export function symbolScale(doc: Document, s: AnnotationSymbol): number {
  const owner = doc.get(s.params.viewId);
  return owner?.category === Cat.View ? ((owner.params as ViewParams).scale ?? 100) : 1;
}

/** A tidy scale bar: the largest 1/2/5 × 10ⁿ model length that fits `maxModel` mm, split in 4 or 5. */
export function scaleBarLayout(maxModel: number): { length: number; divisions: number } {
  if (!(maxModel > 0)) return { length: 0, divisions: 1 };
  const pow = 10 ** Math.floor(Math.log10(maxModel));
  const step = [5, 2, 1].map((m) => m * pow).find((v) => v <= maxModel) ?? pow;
  return { length: step, divisions: step / pow === 2 ? 4 : 5 };
}
