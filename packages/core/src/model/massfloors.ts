import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId } from "../element.ts";
import { Cat, levels } from "./architecture.ts";

// Mass floors (Revit: select a mass → Mass Floors): a mass sliced at chosen levels. Each slice's
// floor area and perimeter come from the mass's shape (geometry/massfloors.ts); together they give
// the mass's gross floor area, and a Mass Floors schedule lists them by level.

export type MassFloorParams = { massId: ElementId; levelId: ElementId };
export type MassFloor = Element<MassFloorParams>;

registerCategory({
  name: Cat.MassFloor,
  // A mass floor follows its mass and level; deleting either removes it.
  dependencies: (el) => [(el.params as MassFloorParams).massId, (el.params as MassFloorParams).levelId],
  cascadeDelete: true,
  isType: false,
});

export function massFloors(doc: Document, massId?: ElementId): MassFloor[] {
  const all = doc.byCategory<MassFloorParams>(Cat.MassFloor) as MassFloor[];
  return massId ? all.filter((f) => f.params.massId === massId) : all;
}

/** True for family instances of Mass families. */
export function isMass(doc: Document, el: Element): boolean {
  if (el.category !== Cat.FamilyInstance) return false;
  const def = doc.get((el.params as { familyId?: ElementId }).familyId ?? "");
  return (def?.params as { category?: string } | undefined)?.category === "Mass";
}

/** Make the mass's floors exactly these levels (creating and removing mass floors as needed). */
export function setMassFloors(tx: Transaction, doc: Document, massId: ElementId, levelIds: ElementId[]): void {
  const mass = doc.require(massId);
  if (!isMass(doc, mass)) throw new Error("Mass floors are for conceptual masses");
  const want = new Set(levelIds.filter((id) => levels(doc).some((l) => l.id === id)));
  const have = massFloors(doc, massId);
  for (const f of have) if (!want.has(f.params.levelId)) tx.delete(f.id);
  for (const id of want) if (!have.some((f) => f.params.levelId === id)) tx.create<MassFloorParams>(Cat.MassFloor, { massId, levelId: id });
}
