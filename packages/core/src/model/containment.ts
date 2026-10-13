import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId } from "../element.ts";
import { Cat } from "./architecture.ts";
import { fittingsOfRun, registerRunKind, runLength, type P3, type Run } from "./runs.ts";

// Cable containment (Revit: Systems → Cable Tray / Conduit): runs like ducts and pipes, with the
// same automatic fittings (bends, tees, crosses, reducers). Trays are rectangular (width × depth);
// conduit is round by nominal size.

export type CableTrayTypeParams = { style: "ladder" | "perforated" | "solid"; material: string };
export type ConduitTypeParams = { material: string };

export type CableTrayParams = { levelId: ElementId; start: P3; end: P3; width: number; height: number };
export type ConduitParams = { levelId: ElementId; start: P3; end: P3; diameter: number };
export type CableTray = Element<CableTrayParams>;
export type Conduit = Element<ConduitParams>;

/** Nominal conduit sizes, mm. */
export const CONDUIT_SIZES = [16, 20, 25, 32, 40, 50, 63];

registerCategory({ name: Cat.CableTrayType, dependencies: () => [], cascadeDelete: false, isType: true });
registerCategory({ name: Cat.ConduitType, dependencies: () => [], cascadeDelete: false, isType: true });
for (const [cat, fit] of [
  [Cat.CableTray, Cat.CableTrayFitting],
  [Cat.Conduit, Cat.ConduitFitting],
] as const) {
  registerCategory({
    name: cat,
    dependencies: (el) => [...(el.typeId ? [el.typeId] : []), (el.params as { levelId: ElementId }).levelId],
    related: (doc, el) => fittingsOfRun(doc, el as unknown as Run).map((f) => f.id),
    cascadeDelete: true,
    isType: false,
  });
  registerCategory({ name: fit, dependencies: (el) => (el.params as { ends: { ductId: ElementId }[] }).ends.map((e) => e.ductId), cascadeDelete: true, isType: false });
}

registerRunKind({
  category: Cat.CableTray,
  fittingCategory: Cat.CableTrayFitting,
  size: (_d, r) => Math.max((r as unknown as CableTray).params.width, (r as unknown as CableTray).params.height),
  sameSection: (_d, a, b) => {
    if (!a || !b) return true;
    const p = (a as unknown as CableTray).params;
    const q = (b as unknown as CableTray).params;
    return Math.abs(p.width - q.width) < 0.5 && Math.abs(p.height - q.height) < 0.5;
  },
});
registerRunKind({
  category: Cat.Conduit,
  fittingCategory: Cat.ConduitFitting,
  size: (_d, r) => (r as unknown as Conduit).params.diameter,
  sameSection: (_d, a, b) => !a || !b || Math.abs((a as unknown as Conduit).params.diameter - (b as unknown as Conduit).params.diameter) < 0.5,
});

/** Default tray and conduit types, if the project has none. */
export function ensureContainmentTypes(tx: Transaction, doc: Document): { tray: ElementId; conduit: ElementId } {
  const tray =
    doc.byCategory(Cat.CableTrayType)[0]?.id ??
    tx.create<CableTrayTypeParams>(Cat.CableTrayType, { style: "ladder", material: "Galvanised steel" }, { name: "Cable Ladder - Galvanised" }).id;
  const conduit = doc.byCategory(Cat.ConduitType)[0]?.id ?? tx.create<ConduitTypeParams>(Cat.ConduitType, { material: "PVC" }, { name: "Conduit - PVC" }).id;
  return { tray, conduit };
}

export function createCableTray(tx: Transaction, doc: Document, typeId: ElementId, levelId: ElementId, start: P3, end: P3, opts: { width?: number; height?: number } = {}): CableTray {
  if (Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z) < 10) throw new Error("A cable tray needs some length");
  if (doc.require(typeId).category !== Cat.CableTrayType) throw new Error("Not a cable tray type");
  return tx.create<CableTrayParams>(Cat.CableTray, { levelId, start: { ...start }, end: { ...end }, width: opts.width ?? 300, height: opts.height ?? 100 }, { typeId }) as CableTray;
}

export function createConduit(tx: Transaction, doc: Document, typeId: ElementId, levelId: ElementId, start: P3, end: P3, opts: { diameter?: number } = {}): Conduit {
  if (Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z) < 5) throw new Error("A conduit needs some length");
  if (doc.require(typeId).category !== Cat.ConduitType) throw new Error("Not a conduit type");
  return tx.create<ConduitParams>(Cat.Conduit, { levelId, start: { ...start }, end: { ...end }, diameter: opts.diameter ?? 25 }, { typeId }) as Conduit;
}

export const containmentLength = (r: CableTray | Conduit): number => runLength(r as unknown as Run);
