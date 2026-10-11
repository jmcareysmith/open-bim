import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat } from "./architecture.ts";
import { viewportsOn, type Sheet, type SheetParams } from "./sheets.ts";
import type { ViewParams } from "./viewdefs.ts";

// Revisions (Revit: Sheet Issues/Revisions). Revisions are numbered in sequence (numeric or
// alphabetic, as NZ practice uses letters for preliminary issues and numbers for construction).
// Revision clouds in a view mark changes for a revision; a sheet shows the revisions clouded on
// it or in its views, plus any added by hand, and its current revision is the latest of those.

export type RevisionNumbering = "numeric" | "alpha";

export type RevisionParams = {
  sequence: number;
  numbering: RevisionNumbering;
  date: string;
  description: string;
  issuedTo: string;
  issuedBy: string;
  /** Issued revisions are locked: no new clouds. */
  issued: boolean;
};
export type Revision = Element<RevisionParams>;

export type RevisionCloudParams = { viewId: ElementId; revisionId: ElementId; boundary: Vec2[] };
export type RevisionCloud = Element<RevisionCloudParams>;

registerCategory({
  name: Cat.Revision,
  dependencies: () => [],
  // Sheets list revisions in their title blocks; clouds show their revision's number.
  related: (doc) => [...doc.byCategory(Cat.Sheet), ...doc.byCategory(Cat.RevisionCloud)].map((e) => e.id),
  cascadeDelete: false,
  isType: false,
});
registerCategory({
  name: Cat.RevisionCloud,
  dependencies: (el) => [(el.params as RevisionCloudParams).viewId, (el.params as RevisionCloudParams).revisionId],
  // A cloud changes which revisions its view's sheets list.
  related: (doc) => doc.byCategory(Cat.Sheet).map((s) => s.id),
  cascadeDelete: true,
  isType: false,
});

export function revisions(doc: Document): Revision[] {
  return (doc.byCategory<RevisionParams>(Cat.Revision) as Revision[]).sort((a, b) => a.params.sequence - b.params.sequence);
}

/** Revision number from its place in the sequence among revisions with the same numbering. */
export function revisionNumber(doc: Document, rev: Revision): string {
  const same = revisions(doc).filter((r) => r.params.numbering === rev.params.numbering);
  const n = same.findIndex((r) => r.id === rev.id) + 1;
  if (rev.params.numbering === "numeric") return String(n);
  let s = "";
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}

export function createRevision(
  tx: Transaction,
  doc: Document,
  opts: Partial<Omit<RevisionParams, "sequence">> = {},
): Revision {
  const seq = Math.max(0, ...revisions(doc).map((r) => r.params.sequence)) + 1;
  return tx.create<RevisionParams>(Cat.Revision, {
    sequence: seq,
    numbering: opts.numbering ?? "alpha",
    date: opts.date ?? "",
    description: opts.description ?? "",
    issuedTo: opts.issuedTo ?? "",
    issuedBy: opts.issuedBy ?? "",
    issued: opts.issued ?? false,
  }) as Revision;
}

/** Move a revision one place earlier (-1) or later (+1) in the sequence. */
export function moveRevision(tx: Transaction, doc: Document, id: ElementId, dir: -1 | 1): void {
  const list = revisions(doc);
  const i = list.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  const a = list[i]!;
  const b = list[j]!;
  const [sa, sb] = [a.params.sequence, b.params.sequence];
  tx.update<RevisionParams>(a.id, { sequence: sb });
  tx.update<RevisionParams>(b.id, { sequence: sa });
}

export function createRevisionCloud(tx: Transaction, doc: Document, viewId: ElementId, revisionId: ElementId, boundary: Vec2[]): RevisionCloud {
  const v = doc.get<ViewParams>(viewId);
  if (!v || (v.category !== Cat.View && v.category !== Cat.Sheet) || (v.category === Cat.View && v.params.kind === "3d")) {
    throw new Error("Revision clouds go in plans, sections, elevations, legends or sheets");
  }
  const rev = doc.get<RevisionParams>(revisionId);
  if (!rev || rev.category !== Cat.Revision) throw new Error("Pick a revision for the cloud");
  if (rev.params.issued) throw new Error("That revision has been issued; clouds can't be added to it");
  if (boundary.length < 3) throw new Error("A revision cloud needs at least three points");
  return tx.create<RevisionCloudParams>(Cat.RevisionCloud, { viewId, revisionId, boundary: boundary.map((p) => ({ ...p })) }) as RevisionCloud;
}

/** Revisions shown on a sheet: added by hand, clouded on the sheet, or clouded in its views. */
export function sheetRevisions(doc: Document, sheet: Sheet): Revision[] {
  const ids = new Set<ElementId>(sheet.params.revisionIds ?? []);
  const views = new Set<ElementId>([sheet.id, ...viewportsOn(doc, sheet.id).map((vp) => vp.params.viewId)]);
  for (const c of doc.byCategory<RevisionCloudParams>(Cat.RevisionCloud)) if (views.has(c.params.viewId)) ids.add(c.params.revisionId);
  return revisions(doc).filter((r) => ids.has(r.id));
}

/** The sheet's current revision number (its latest revision), or "" if none. */
export function currentRevision(doc: Document, sheet: Sheet): string {
  const r = sheetRevisions(doc, sheet).at(-1);
  return r ? revisionNumber(doc, r) : "";
}

export function setSheetRevisions(tx: Transaction, sheet: Sheet, revisionIds: ElementId[]): void {
  tx.update<SheetParams>(sheet.id, { revisionIds });
}
