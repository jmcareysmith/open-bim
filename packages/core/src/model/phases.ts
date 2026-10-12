import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId } from "../element.ts";
import { Cat } from "./architecture.ts";
import { ensureProjectSettings, projectSettings, type ProjectSettingsParams } from "./settings.ts";

// Phasing (Revit: Phases + Phase Filters). The project has ordered phases; model elements record
// the phase they're created in and (optionally) demolished in. A view shows one phase through a
// phase filter, which hides or overrides elements by their status in that phase.

export type Phase = { id: string; name: string };
export type PhaseFilter = "all" | "complete" | "new" | "previous" | "none";
export type PhaseStatus = "existing" | "demolished" | "new" | "future" | "gone";

export const DEFAULT_PHASES: Phase[] = [
  { id: "existing", name: "Existing" },
  { id: "new", name: "New Construction" },
];

export const PHASE_FILTERS: { value: PhaseFilter; label: string }[] = [
  { value: "all", label: "Show All" },
  { value: "complete", label: "Show Complete" },
  { value: "new", label: "Show New" },
  { value: "previous", label: "Show Previous + Demo" },
  { value: "none", label: "None" },
];

/** Categories that take part in phasing (model elements; datums, views and annotation don't). */
export const PHASED = new Set<string>([
  Cat.Wall,
  Cat.Floor,
  Cat.Ceiling,
  Cat.Roof,
  Cat.Door,
  Cat.Window,
  Cat.WallOpening,
  Cat.FamilyInstance,
  Cat.Stair,
  Cat.Railing,
  Cat.Ramp,
  Cat.Column,
  Cat.Beam,
  Cat.PadFooting,
  Cat.StripFooting,
  Cat.DirectShape,
]);

/** Demolished elements' colour (Revit's demolished lines; here a red override). */
export const DEMOLISHED_COLOUR = 0xb0352f;

export function phases(doc: Document): Phase[] {
  return projectSettings(doc)?.params.phases ?? DEFAULT_PHASES;
}

export function setPhases(tx: Transaction, doc: Document, list: Phase[]): void {
  if (!list.length) throw new Error("A project needs at least one phase");
  if (new Set(list.map((p) => p.id)).size !== list.length) throw new Error("Phase ids must be unique");
  const s = ensureProjectSettings(tx, doc);
  tx.update<ProjectSettingsParams>(s.id, { phases: list.map((p) => ({ ...p })) });
}

/** The phase a view shows: its own, else the last (current) phase. */
export function viewPhase(doc: Document, phaseId: string | null | undefined): string {
  const list = phases(doc);
  return list.some((p) => p.id === phaseId) ? phaseId! : list.at(-1)!.id;
}

/** An element's status in a phase. Elements without a created phase belong to the last phase. */
export function phaseStatus(doc: Document, el: Element, phaseId: string): PhaseStatus {
  const list = phases(doc);
  const idx = (id: unknown) => {
    const i = list.findIndex((p) => p.id === id);
    return i < 0 ? undefined : i;
  };
  const p = el.params as { phaseCreated?: unknown; phaseDemolished?: unknown };
  const v = idx(phaseId) ?? list.length - 1;
  const created = idx(p.phaseCreated) ?? list.length - 1;
  const demolished = idx(p.phaseDemolished);
  if (created > v) return "future";
  if (demolished !== undefined && demolished < v) return "gone";
  if (demolished === v) return "demolished";
  return created === v ? "new" : "existing";
}

/** How a phase filter shows an element of a status: hidden, or with halftone / colour. */
export function phaseGraphics(filter: PhaseFilter, status: PhaseStatus): { visible: boolean; halftone?: boolean; color?: number } {
  if (status === "future" || status === "gone") return { visible: false };
  switch (filter) {
    case "all":
      return status === "existing" ? { visible: true, halftone: true } : status === "demolished" ? { visible: true, color: DEMOLISHED_COLOUR } : { visible: true };
    case "complete":
      return { visible: status !== "demolished" };
    case "new":
      return { visible: status === "new" };
    case "previous":
      return status === "new" ? { visible: false } : status === "demolished" ? { visible: true, color: DEMOLISHED_COLOUR } : { visible: true, halftone: true };
    default:
      return { visible: true };
  }
}

/** Demolish an element in a phase (it must exist by then). */
export function demolish(tx: Transaction, doc: Document, id: ElementId, phaseId: string): void {
  const el = doc.require(id);
  if (!PHASED.has(el.category)) throw new Error(`${el.category} elements aren't phased`);
  const s = phaseStatus(doc, el, phaseId);
  if (s === "future") throw new Error("That element is created in a later phase");
  tx.update(id, { phaseDemolished: phaseId });
}
