import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId } from "../element.ts";

// Worksets (Revit: Collaborate → Worksets): named parts of the model. Every model element belongs
// to one (`worksetId`); new elements go into the active workset (each user's own choice); views can
// hide worksets (view `hiddenWorksets`, V/G → Worksets). The project starts with "Workset1" and
// "Shared Levels and Grids" once worksets are enabled.

export const WORKSET = "Workset";

export type WorksetParams = {
  /** Visible in views by default (Revit's "Visible in all views"). */
  visibleByDefault: boolean;
};
export type Workset = Element<WorksetParams>;

registerCategory({ name: WORKSET, dependencies: () => [], cascadeDelete: false, isType: false });

export function worksets(doc: Document): Workset[] {
  return doc.byCategory<WorksetParams>(WORKSET) as Workset[];
}

/** Turn worksets on: "Shared Levels and Grids" (levels, grids, reference planes) and "Workset1" (the rest). */
export function enableWorksets(tx: Transaction, doc: Document): { main: ElementId; datums: ElementId } {
  if (worksets(doc).length) throw new Error("Worksets are already on in this project");
  const datums = tx.create<WorksetParams>(WORKSET, { visibleByDefault: true }, { name: "Shared Levels and Grids" }).id;
  const main = tx.create<WorksetParams>(WORKSET, { visibleByDefault: true }, { name: "Workset1" }).id;
  for (const el of doc.all()) {
    if (!isWorksetElement(el)) continue;
    tx.update(el.id, { worksetId: DATUMS.has(el.category) ? datums : main });
  }
  return { main, datums };
}

const DATUMS = new Set(["Level", "Grid", "ReferencePlane"]);
/** Things that aren't model elements (views, sheets, types, settings…), by category. */
const NOT_MODEL = new Set(["View", "Sheet", "Viewport", "Schedule", "Material", "ProjectSettings", "FamilyDef", "ViewFilter", "ViewTemplate", "Revision", "KeySchedule", "Graph", "ColorScheme", "ProjectParameter", "GlobalParameter", "GroupType", "MEPSystem", WORKSET]);

/** Does this element belong to a workset? Model elements and datums (not views, types or annotation). */
export function isWorksetElement(el: Element): boolean {
  if (NOT_MODEL.has(el.category) || /Type$/.test(el.category)) return false;
  const p = el.params as Record<string, unknown>;
  // View-owned annotation and sheet items have no workset.
  if ("viewId" in p || "sheetId" in p) return false;
  return ["levelId", "baseLevelId", "hostId", "start", "boundary", "position", "path", "runs", "elevation", "wallId", "points"].some((k) => k in p);
}

const active = new WeakMap<Document, ElementId>();

/** The workset new elements go into (this user's choice; the first workset by default). */
export function activeWorkset(doc: Document): ElementId | undefined {
  const id = active.get(doc);
  if (id && doc.get(id)?.category === WORKSET) return id;
  return worksets(doc).find((w) => w.name !== "Shared Levels and Grids")?.id ?? worksets(doc)[0]?.id;
}

export function setActiveWorkset(doc: Document, id: ElementId): void {
  if (doc.get(id)?.category !== WORKSET) throw new Error("Not a workset");
  active.set(doc, id);
}

/** New model elements join the active workset (levels and grids the shared one). Returns a stop function. */
export function enableWorksetAssignment(doc: Document): () => void {
  return doc.addCommitHook((tx) => {
    const ws = worksets(doc);
    if (!ws.length) return;
    const main = activeWorkset(doc);
    const datums = ws.find((w) => w.name === "Shared Levels and Grids")?.id ?? main;
    const hiddenByDefault = ws.filter((w) => !w.params.visibleByDefault).map((w) => w.id);
    for (const id of doc.createdInTransaction()) {
      const el = doc.get(id);
      // New views hide worksets that aren't visible by default.
      if (el?.category === "View" && hiddenByDefault.length && !(el.params as { hiddenWorksets?: unknown }).hiddenWorksets) {
        tx.update(id, { hiddenWorksets: hiddenByDefault });
        continue;
      }
      if (!el || (el.params as { worksetId?: unknown }).worksetId || !isWorksetElement(el)) continue;
      const target = DATUMS.has(el.category) ? datums : main;
      if (target) tx.update(id, { worksetId: target });
    }
  });
}

/** Create a workset (unique name). */
export function createWorkset(tx: Transaction, doc: Document, name: string): Workset {
  const n = name.trim();
  if (!n) throw new Error("A workset needs a name");
  if (worksets(doc).some((w) => w.name === n)) throw new Error(`There's already a workset called "${n}"`);
  return tx.create<WorksetParams>(WORKSET, { visibleByDefault: true }, { name: n }) as Workset;
}

/** Delete a workset, moving its elements to another. */
export function deleteWorkset(tx: Transaction, doc: Document, id: ElementId, moveTo: ElementId): void {
  if (id === moveTo) throw new Error("Move its elements to a different workset");
  if (doc.get(moveTo)?.category !== WORKSET) throw new Error("Pick a workset to move its elements to");
  for (const el of doc.all()) if ((el.params as { worksetId?: unknown }).worksetId === id) tx.update(el.id, { worksetId: moveTo });
  tx.delete(id);
}
