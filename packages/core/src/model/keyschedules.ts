import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, ParamValue } from "../element.ts";
import { Cat } from "./architecture.ts";
import { createProjectParameter, projectParameters } from "./parameters.ts";

// Key schedules (Revit: View → Schedules → Schedule Keys). A key schedule for a category is a
// table of named keys (e.g. Room Style: "Office", "Wet area"), each giving values to some project
// parameters (finishes, ceiling type…). Elements pick a key through the key parameter (a text
// project parameter named after the key, created with the schedule); the keyed parameters then
// read from the key's row instead of the element (`customValue` in parameters.ts looks them up).

export type KeyScheduleParams = {
  category: string;
  /** Name of the key parameter (e.g. "Room Style"). */
  keyName: string;
  /** Project parameters the keys set. */
  fields: string[];
  rows: { key: string; values: Record<string, ParamValue> }[];
};
export type KeySchedule = Element<KeyScheduleParams>;

registerCategory({ name: Cat.KeySchedule, dependencies: () => [], cascadeDelete: false, isType: false });

export function keySchedules(doc: Document, category?: string): KeySchedule[] {
  return doc.byCategory<KeyScheduleParams>(Cat.KeySchedule).filter((k) => !category || k.params.category === category) as KeySchedule[];
}

/** A key schedule for a category, with its key parameter (created when missing). */
export function createKeySchedule(tx: Transaction, doc: Document, category: string, keyName: string): KeySchedule {
  const name = keyName.trim();
  if (!name) throw new Error("Key schedules need a key name");
  if (keySchedules(doc).some((k) => k.params.keyName === name)) throw new Error(`There is already a "${name}" key schedule`);
  const existing = projectParameters(doc).find((p) => p.name === name);
  if (existing) {
    if (existing.params.dataType !== "text" || existing.params.binding !== "instance") throw new Error(`"${name}" is already a parameter of another kind`);
    if (!existing.params.categories.includes(category)) tx.update(existing.id, { categories: [...existing.params.categories, category] });
  } else createProjectParameter(tx, doc, name, { dataType: "text", categories: [category], binding: "instance", group: "Identity Data" });
  return tx.create<KeyScheduleParams>(Cat.KeySchedule, { category, keyName: name, fields: [], rows: [] }, { name: `${name} Schedule` }) as KeySchedule;
}

/** Is this parameter set by a key on this element (so read-only there)? */
export function keyedBy(doc: Document, el: Element, name: string): KeySchedule | undefined {
  return keySchedules(doc, el.category).find((ks) => ks.params.fields.includes(name));
}

/** Elements using a key. */
export function keyUsers(doc: Document, ks: KeySchedule, key: string): ElementId[] {
  return doc
    .byCategory(ks.params.category)
    .filter((e) => ((e.params as { custom?: Record<string, unknown> }).custom ?? {})[ks.params.keyName] === key)
    .map((e) => e.id);
}
