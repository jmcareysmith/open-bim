import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId } from "../element.ts";
import { Cat } from "./architecture.ts";
import { createSystem, elementConnectors, mepSystems, systemTotals, type MEPSystem, type MEPSystemParams, type SystemClassification } from "./mep.ts";

// Electrical circuits (Revit: select fixtures → Create Power Circuit → pick the panel). A circuit
// is a power or lighting system fed from a switchboard: it has a number on the board and a
// breaker rating, and its load is the sum of its fixtures' loads. The switchboard schedule lists
// a board's circuits with their load and current, and the board's connected load.

/** Single-phase NZ supply, volts. */
export const SUPPLY_VOLTAGE = 230;

/** Default breaker ratings (A): lighting 10, power 20 (typical NZ residential practice). */
export const DEFAULT_BREAKER: Record<string, number> = { lighting: 10, power: 20, data: 10 };

export type CircuitParams = MEPSystemParams & {
  /** The switchboard (an Electrical Equipment family instance) the circuit is fed from. */
  panelId?: ElementId | null;
  circuitNumber?: number;
  /** Breaker rating, A. */
  breaker?: number;
};
export type Circuit = Element<CircuitParams>;

/** Electrical equipment that can feed circuits (family instances of Electrical Equipment). */
export function isPanel(doc: Document, el: Element): boolean {
  if (el.category !== Cat.FamilyInstance) return false;
  const def = doc.get((el.params as { familyId?: ElementId }).familyId ?? "");
  return (def?.params as { category?: string } | undefined)?.category === "ElectricalEquipment";
}

export function panels(doc: Document): Element[] {
  return doc.byCategory(Cat.FamilyInstance).filter((e) => isPanel(doc, e));
}

export function circuitsOf(doc: Document, panelId: ElementId): Circuit[] {
  return (mepSystems(doc) as unknown as Circuit[]).filter((s) => s.params.panelId === panelId).sort((a, b) => (a.params.circuitNumber ?? 0) - (b.params.circuitNumber ?? 0));
}

/**
 * A circuit on `panelId` for fixtures with a power (or lighting) connector. It takes the next free
 * number on the board and the default breaker for its kind.
 */
export function createCircuit(tx: Transaction, doc: Document, panelId: ElementId, fixtureIds: ElementId[], classification: SystemClassification = "power"): Circuit {
  const panel = doc.require(panelId);
  if (!isPanel(doc, panel)) throw new Error("Circuits are fed from a switchboard (Electrical Equipment)");
  const ids = fixtureIds.filter((id) => id !== panelId);
  if (!ids.length) throw new Error("Select the fixtures to put on the circuit");
  for (const id of ids) {
    const el = doc.require(id);
    if (!elementConnectors(doc, el).some((c) => c.classification === classification)) throw new Error(`${el.name ?? el.category} has no ${classification} connector`);
  }
  const used = new Set(circuitsOf(doc, panelId).map((c) => c.params.circuitNumber));
  let n = 1;
  while (used.has(n)) n++;
  const panelName = panel.name ?? (doc.get((panel.params as { familyId?: ElementId }).familyId ?? "")?.name ?? "Board");
  // The board is a member too, so the system shows from it; its own connector isn't load.
  const sys = createSystem(tx, doc, classification, ids, `${panelName} / ${n}`);
  tx.update<CircuitParams>(sys.id, { panelId, circuitNumber: n, breaker: DEFAULT_BREAKER[classification] ?? 16 });
  return doc.require(sys.id) as Circuit;
}

export interface PanelRow {
  circuitId: ElementId;
  number: number;
  name: string;
  classification: SystemClassification;
  fixtures: number;
  /** W */
  load: number;
  /** A, at the supply voltage */
  current: number;
  breaker: number;
  ok: boolean;
}

/** A switchboard's schedule: its circuits with load and current, and the board's connected load. */
export function panelSchedule(doc: Document, panelId: ElementId): { rows: PanelRow[]; load: number; current: number } {
  const rows = circuitsOf(doc, panelId).map((c): PanelRow => {
    const t = systemTotals(doc, c as unknown as MEPSystem);
    const current = t.load / SUPPLY_VOLTAGE;
    const breaker = c.params.breaker ?? DEFAULT_BREAKER[c.params.classification] ?? 16;
    return { circuitId: c.id, number: c.params.circuitNumber ?? 0, name: c.name ?? "", classification: c.params.classification, fixtures: t.members, load: t.load, current, breaker, ok: current <= breaker + 1e-9 };
  });
  const load = rows.reduce((s, r) => s + r.load, 0);
  return { rows, load, current: load / SUPPLY_VOLTAGE };
}
