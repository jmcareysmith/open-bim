import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat } from "./architecture.ts";
import type { ViewParams } from "./viewdefs.ts";

// Sheets and viewports (Revit "Sheets"): a sheet is a paper layout with a title block; viewports
// place views on it at their own scale. Sheet coordinates are paper mm from the bottom-left corner.

export const PAPER_SIZES = {
  A0: { width: 1189, height: 841 },
  A1: { width: 841, height: 594 },
  A2: { width: 594, height: 420 },
  A3: { width: 420, height: 297 },
  A4: { width: 297, height: 210 },
} as const;
export type PaperSize = keyof typeof PAPER_SIZES;

export type SheetParams = {
  /** Sheet number, e.g. "A101". Unique. */
  number: string;
  size: PaperSize;
  /** Who drew/checked it and the issue date, shown in the title block. */
  drawnBy: string;
  checkedBy: string;
  issueDate: string;
};
export type Sheet = Element<SheetParams>;

export type ViewportParams = {
  sheetId: ElementId;
  viewId: ElementId;
  /** Where the view's crop centre sits on the sheet, paper mm. */
  centre: Vec2;
};
export type Viewport = Element<ViewportParams>;

registerCategory({ name: Cat.Sheet, dependencies: () => [], cascadeDelete: false, isType: false });
registerCategory({
  name: Cat.Viewport,
  // Deleting the sheet or the view removes the viewport.
  dependencies: (el) => {
    const p = el.params as ViewportParams;
    return [p.sheetId, p.viewId];
  },
  cascadeDelete: true,
  isType: false,
});

export function sheets(doc: Document): Sheet[] {
  return doc.byCategory<SheetParams>(Cat.Sheet).sort((a, b) => a.params.number.localeCompare(b.params.number, undefined, { numeric: true }));
}

/** Next sheet number in the A1xx series: A101, A102, … */
export function nextSheetNumber(doc: Document): string {
  const used = new Set(doc.byCategory<SheetParams>(Cat.Sheet).map((s) => s.params.number));
  let n = 101;
  while (used.has(`A${n}`)) n++;
  return `A${n}`;
}

export function createSheet(
  tx: Transaction,
  doc: Document,
  opts: { number?: string; name?: string; size?: PaperSize; drawnBy?: string; checkedBy?: string; issueDate?: string } = {},
): Sheet {
  const number = opts.number ?? nextSheetNumber(doc);
  if (!number.trim()) throw new Error("Sheets need a number");
  if (doc.byCategory<SheetParams>(Cat.Sheet).some((s) => s.params.number === number)) throw new Error(`Sheet ${number} already exists`);
  return tx.create<SheetParams>(
    Cat.Sheet,
    {
      number,
      size: opts.size ?? "A3",
      drawnBy: opts.drawnBy ?? "",
      checkedBy: opts.checkedBy ?? "",
      issueDate: opts.issueDate ?? new Date().toISOString().slice(0, 10),
    },
    { name: opts.name ?? "Unnamed" },
  );
}

export function viewportsOn(doc: Document, sheetId: ElementId): Viewport[] {
  return doc.byCategory<ViewportParams>(Cat.Viewport).filter((v) => v.params.sheetId === sheetId);
}

/** The sheet a view is placed on, if any. */
export function sheetOfView(doc: Document, viewId: ElementId): Sheet | undefined {
  const vp = doc.byCategory<ViewportParams>(Cat.Viewport).find((v) => v.params.viewId === viewId);
  return vp ? doc.get<SheetParams>(vp.params.sheetId) : undefined;
}

/** Place a view on a sheet. Like Revit, a view can be on one sheet only (3D views included). */
export function placeView(tx: Transaction, doc: Document, sheetId: ElementId, viewId: ElementId, centre?: Vec2): Viewport {
  const sheet = doc.require<SheetParams>(sheetId);
  if (sheet.category !== Cat.Sheet) throw new Error("Viewports go on sheets");
  const view = doc.require<ViewParams>(viewId);
  if (view.category !== Cat.View) throw new Error("Only views can be placed on sheets");
  if (view.params.kind === "3d") throw new Error("3D views can't be placed on sheets yet");
  const other = sheetOfView(doc, viewId);
  if (other) throw new Error(`"${view.name}" is already on sheet ${other.params.number}`);
  const paper = PAPER_SIZES[sheet.params.size];
  return tx.create<ViewportParams>(Cat.Viewport, { sheetId, viewId, centre: centre ?? { x: paper.width / 2 - 40, y: paper.height / 2 } });
}
