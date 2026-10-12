import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId } from "../element.ts";
import { ensureProjectSettings, projectSettings, type ProjectSettingsParams } from "./settings.ts";

// Design options (Revit: Design Options). Option sets hold alternative options, one primary.
// Elements in an option carry `designOption`; elements without one are the main model. A view shows
// each set's primary option unless it picks another. "Accept primary" folds the primary into the
// main model and deletes the other options' elements.

export type DesignOption = { id: string; name: string };
export type OptionSet = { id: string; name: string; options: DesignOption[]; primary: string };

export function optionSets(doc: Document): OptionSet[] {
  return projectSettings(doc)?.params.designOptions ?? [];
}

function save(tx: Transaction, doc: Document, sets: OptionSet[]): void {
  const s = ensureProjectSettings(tx, doc);
  tx.update<ProjectSettingsParams>(s.id, { designOptions: sets.map((x) => ({ ...x, options: x.options.map((o) => ({ ...o })) })) });
}

const uid = (prefix: string, taken: Set<string>) => {
  let i = 1;
  while (taken.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
};

function allIds(sets: OptionSet[]): Set<string> {
  return new Set(sets.flatMap((s) => [s.id, ...s.options.map((o) => o.id)]));
}

/** New option set with a primary option and one alternative. */
export function createOptionSet(tx: Transaction, doc: Document, name: string): OptionSet {
  const sets = optionSets(doc);
  const taken = allIds(sets);
  const id = uid("set", taken);
  taken.add(id);
  const a = uid("opt", taken);
  taken.add(a);
  const b = uid("opt", taken);
  const set: OptionSet = { id, name, options: [{ id: a, name: "Option 1" }, { id: b, name: "Option 2" }], primary: a };
  save(tx, doc, [...sets, set]);
  return set;
}

export function addOption(tx: Transaction, doc: Document, setId: string, name?: string): DesignOption {
  const sets = optionSets(doc);
  const set = sets.find((s) => s.id === setId);
  if (!set) throw new Error("No such option set");
  const opt = { id: uid("opt", allIds(sets)), name: name ?? `Option ${set.options.length + 1}` };
  save(tx, doc, sets.map((s) => (s.id === setId ? { ...s, options: [...s.options, opt] } : s)));
  return opt;
}

export function makePrimary(tx: Transaction, doc: Document, optionId: string): void {
  const sets = optionSets(doc);
  if (!sets.some((s) => s.options.some((o) => o.id === optionId))) throw new Error("No such design option");
  save(tx, doc, sets.map((s) => (s.options.some((o) => o.id === optionId) ? { ...s, primary: optionId } : s)));
}

/** The set an option belongs to. */
export function optionSetOf(doc: Document, optionId: string): OptionSet | undefined {
  return optionSets(doc).find((s) => s.options.some((o) => o.id === optionId));
}

export function elementOption(el: Element): string | undefined {
  const o = (el.params as { designOption?: unknown }).designOption;
  return typeof o === "string" && o ? o : undefined;
}

/** Put elements in an option (or back into the main model with null). */
export function setDesignOption(tx: Transaction, doc: Document, ids: ElementId[], optionId: string | null): void {
  if (optionId && !optionSetOf(doc, optionId)) throw new Error("No such design option");
  for (const id of ids) tx.update(id, { designOption: optionId ?? undefined });
}

/** Whether an element shows in a view with the given option choices (default: each set's primary). */
export function optionVisible(doc: Document, el: Element, choices?: Record<string, string> | null): boolean {
  const o = elementOption(el);
  if (!o) return true;
  const set = optionSetOf(doc, o);
  if (!set) return true;
  return (choices?.[set.id] ?? set.primary) === o;
}

/** Accept the primary: its elements join the main model; the other options' elements are deleted. */
export function acceptPrimary(tx: Transaction, doc: Document, setId: string): void {
  const sets = optionSets(doc);
  const set = sets.find((s) => s.id === setId);
  if (!set) throw new Error("No such option set");
  const ids = new Set(set.options.map((o) => o.id));
  for (const el of doc.all()) {
    const o = elementOption(el);
    if (!o || !ids.has(o)) continue;
    if (o === set.primary) tx.update(el.id, { designOption: undefined });
    else if (doc.has(el.id)) tx.delete(el.id);
  }
  save(tx, doc, sets.filter((s) => s.id !== setId));
}
