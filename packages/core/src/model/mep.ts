import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId } from "../element.ts";
import { evaluate, type Num, type Values } from "../expr.ts";
import { Cat, type LevelParams } from "./architecture.ts";
import { familyDocument, instanceValues, type FamilyDef, type FamilyInstance, type FamilyInstanceParams } from "./components.ts";

// MEP connectors and systems (Revit: connectors in families, then Duct/Piping/Electrical Systems).
// A connector sits in a family (position and direction in family coordinates, sizes and flow as
// formulas over its parameters). Placed instances expose them in the model; a system groups the
// elements whose connectors share a classification (supply air, cold water, power…), and totals
// their flow or load. Ducts and pipes join systems through the connectors at their ends.

export type ConnectorDomain = "duct" | "pipe" | "electrical";

export type SystemClassification =
  | "supplyAir"
  | "returnAir"
  | "exhaustAir"
  | "outsideAir"
  | "coldWater"
  | "hotWater"
  | "sanitary"
  | "vent"
  | "stormwater"
  | "fireProtection"
  | "gas"
  | "power"
  | "lighting"
  | "data";

export interface ClassificationInfo {
  value: SystemClassification;
  label: string;
  domain: ConnectorDomain;
  /** Display colour, 0xRRGGBB. */
  color: number;
  /** System name prefix ("Supply Air 1"). */
  prefix: string;
}

export const SYSTEM_CLASSIFICATIONS: ClassificationInfo[] = [
  { value: "supplyAir", label: "Supply air", domain: "duct", color: 0x2f6fd6, prefix: "Supply Air" },
  { value: "returnAir", label: "Return air", domain: "duct", color: 0xd64a8a, prefix: "Return Air" },
  { value: "exhaustAir", label: "Exhaust air", domain: "duct", color: 0x8a5a2b, prefix: "Exhaust Air" },
  { value: "outsideAir", label: "Outside air", domain: "duct", color: 0x2fa36b, prefix: "Outside Air" },
  { value: "coldWater", label: "Cold water", domain: "pipe", color: 0x1d8fd1, prefix: "Cold Water" },
  { value: "hotWater", label: "Hot water", domain: "pipe", color: 0xd1361d, prefix: "Hot Water" },
  { value: "sanitary", label: "Sanitary (wastewater)", domain: "pipe", color: 0x6b4f2a, prefix: "Sanitary" },
  { value: "vent", label: "Vent", domain: "pipe", color: 0x7a7f86, prefix: "Vent" },
  { value: "stormwater", label: "Stormwater", domain: "pipe", color: 0x2aa0a0, prefix: "Stormwater" },
  { value: "fireProtection", label: "Fire protection", domain: "pipe", color: 0xc8102e, prefix: "Fire" },
  { value: "gas", label: "Gas", domain: "pipe", color: 0xe0a800, prefix: "Gas" },
  { value: "power", label: "Power", domain: "electrical", color: 0xd17a00, prefix: "Power" },
  { value: "lighting", label: "Lighting", domain: "electrical", color: 0xb8a000, prefix: "Lighting" },
  { value: "data", label: "Data", domain: "electrical", color: 0x5a5ad1, prefix: "Data" },
];

export const classificationInfo = (c: SystemClassification): ClassificationInfo => SYSTEM_CLASSIFICATIONS.find((x) => x.value === c)!;

/** Directions a connector faces, in family coordinates. */
export type ConnectorFacing = "+x" | "-x" | "+y" | "-y" | "+z" | "-z";

export type ConnectorParams = {
  classification: SystemClassification;
  /** Position in family coordinates (mm), each a number or formula. */
  x: Num;
  y: Num;
  z: Num;
  facing: ConnectorFacing;
  shape: "round" | "rectangular";
  /** Round: diameter. Rectangular: width × height. mm (formulas welcome). Electrical: unused. */
  diameter: Num;
  width: Num;
  height: Num;
  /** Air or water flow, L/s (duct/pipe connectors). */
  flow: Num;
  /** Electrical load, W. */
  load: Num;
  /** Plumbing fixtures: discharge units (NZ G13/AS1) or loading units for supply. */
  units?: Num;
  /** Which way the medium goes at this connector. */
  flowDirection: "in" | "out" | "both";
};

registerCategory({ name: Cat.Connector, dependencies: () => [], cascadeDelete: false, isType: false });

export type MEPSystemParams = {
  classification: SystemClassification;
  /** Elements in the system (equipment, terminals, fixtures, ducts, pipes). */
  memberIds: ElementId[];
};
export type MEPSystem = Element<MEPSystemParams>;

// Systems list their members; editing a member refreshes the system's totals.
registerCategory({ name: Cat.MEPSystem, dependencies: () => [], cascadeDelete: false, isType: false });

export function createConnector(tx: Transaction, opts: Partial<ConnectorParams> & { classification: SystemClassification }): Element<ConnectorParams> {
  const domain = classificationInfo(opts.classification).domain;
  return tx.create<ConnectorParams>(Cat.Connector, {
    x: 0,
    y: 0,
    z: 0,
    facing: "+z",
    shape: "round",
    diameter: domain === "pipe" ? 20 : 150,
    width: 300,
    height: 200,
    flow: 0,
    load: 0,
    flowDirection: domain === "electrical" ? "in" : "both",
    ...opts,
  });
}

/** A connector where it is in the model. */
export interface ModelConnector {
  ownerId: ElementId;
  /** Index within its owner (stable while the family is unchanged). */
  index: number;
  classification: SystemClassification;
  domain: ConnectorDomain;
  position: [number, number, number];
  /** Unit vector the connector faces (out of the element). */
  direction: [number, number, number];
  shape: "round" | "rectangular";
  diameter: number;
  width: number;
  height: number;
  flow: number;
  load: number;
  units: number;
  flowDirection: "in" | "out" | "both";
}

const FACING: Record<ConnectorFacing, [number, number, number]> = {
  "+x": [1, 0, 0],
  "-x": [-1, 0, 0],
  "+y": [0, 1, 0],
  "-y": [0, -1, 0],
  "+z": [0, 0, 1],
  "-z": [0, 0, -1],
};

/** Connectors of a family document in family coordinates, evaluated for the given parameter values. */
export function familyConnectors(family: Document, values: Values): Omit<ModelConnector, "ownerId">[] {
  const num = (n: Num, what: string) => {
    try {
      return evaluate(n, values);
    } catch (err) {
      throw new Error(`Connector ${what}: ${(err as Error).message}`);
    }
  };
  return family.byCategory<ConnectorParams>(Cat.Connector).map((c, index) => {
    const p = c.params;
    return {
      index,
      classification: p.classification,
      domain: classificationInfo(p.classification).domain,
      position: [num(p.x, "x"), num(p.y, "y"), num(p.z, "z")],
      direction: FACING[p.facing],
      shape: p.shape,
      diameter: num(p.diameter, "diameter"),
      width: num(p.width, "width"),
      height: num(p.height, "height"),
      flow: num(p.flow, "flow"),
      load: num(p.load, "load"),
      units: p.units === undefined ? 0 : num(p.units, "units"),
      flowDirection: p.flowDirection,
    };
  });
}

/** Connectors on a placed (free-standing) family instance, in model coordinates. */
export function instanceConnectors(doc: Document, inst: FamilyInstance): ModelConnector[] {
  const def = doc.get(inst.params.familyId) as FamilyDef | undefined;
  if (!def) return [];
  const p = inst.params as FamilyInstanceParams;
  const z0 = (doc.get<LevelParams>(p.levelId)?.params.elevation ?? 0) + p.offset;
  const c = Math.cos(p.rotation);
  const s = Math.sin(p.rotation);
  const rot = (v: [number, number, number]): [number, number, number] => [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
  return familyConnectors(familyDocument(def), instanceValues(doc, inst)).map((k) => {
    const r = rot(k.position);
    return { ...k, ownerId: inst.id, position: [p.position.x + r[0], p.position.y + r[1], z0 + r[2]], direction: rot(k.direction) };
  });
}

/** Model connectors of any element (family instances now; ducts and pipes add theirs). */
export type ConnectorSource = (doc: Document, el: Element) => ModelConnector[];
const sources = new Map<string, ConnectorSource>([[Cat.FamilyInstance, (doc, el) => instanceConnectors(doc, el as FamilyInstance)]]);

/** Let another category (ducts, pipes…) report its connectors. */
export function registerConnectorSource(category: string, source: ConnectorSource): void {
  sources.set(category, source);
}

export function elementConnectors(doc: Document, el: Element): ModelConnector[] {
  try {
    return sources.get(el.category)?.(doc, el) ?? [];
  } catch {
    return [];
  }
}

export function mepSystems(doc: Document): MEPSystem[] {
  return doc.byCategory<MEPSystemParams>(Cat.MEPSystem) as MEPSystem[];
}

/** Members that still exist. */
export function systemMembers(doc: Document, s: MEPSystem): Element[] {
  return s.params.memberIds.map((id) => doc.get(id)).filter((e): e is Element => !!e);
}

/** Systems an element belongs to. */
export function systemsOf(doc: Document, id: ElementId): MEPSystem[] {
  return mepSystems(doc).filter((s) => s.params.memberIds.includes(id));
}

/** Classifications an element could join (from its connectors). */
export function connectableClassifications(doc: Document, el: Element): SystemClassification[] {
  return [...new Set(elementConnectors(doc, el).map((c) => c.classification))];
}

function nextSystemName(doc: Document, c: SystemClassification): string {
  const prefix = classificationInfo(c).prefix;
  let i = 1;
  while (mepSystems(doc).some((s) => s.name === `${prefix} ${i}`)) i++;
  return `${prefix} ${i}`;
}

/**
 * Create a system (Revit: Create Duct/Piping/Power System) from elements that have a connector
 * of that classification. An element joins only one system per classification, as in Revit.
 */
export function createSystem(tx: Transaction, doc: Document, classification: SystemClassification, memberIds: ElementId[], name?: string): MEPSystem {
  checkMembers(doc, classification, memberIds);
  return tx.create<MEPSystemParams>(Cat.MEPSystem, { classification, memberIds: [...new Set(memberIds)] }, { name: name ?? nextSystemName(doc, classification) }) as MEPSystem;
}

export function addToSystem(tx: Transaction, doc: Document, systemId: ElementId, ids: ElementId[]): void {
  const s = doc.require<MEPSystemParams>(systemId) as MEPSystem;
  const add = ids.filter((id) => !s.params.memberIds.includes(id));
  checkMembers(doc, s.params.classification, add, systemId);
  tx.update<MEPSystemParams>(systemId, { memberIds: [...s.params.memberIds, ...add] });
}

export function removeFromSystem(tx: Transaction, doc: Document, systemId: ElementId, ids: ElementId[]): void {
  const s = doc.require<MEPSystemParams>(systemId) as MEPSystem;
  tx.update<MEPSystemParams>(systemId, { memberIds: s.params.memberIds.filter((id) => !ids.includes(id)) });
}

function checkMembers(doc: Document, classification: SystemClassification, ids: ElementId[], except?: ElementId): void {
  if (!ids.length && !except) throw new Error("Select the elements to put in the system");
  const label = classificationInfo(classification).label.toLowerCase();
  for (const id of ids) {
    const el = doc.require(id);
    if (!elementConnectors(doc, el).some((c) => c.classification === classification)) {
      throw new Error(`${el.name ?? el.category} has no ${label} connector`);
    }
    const other = mepSystems(doc).find((s) => s.id !== except && s.params.classification === classification && s.params.memberIds.includes(id));
    if (other) throw new Error(`${el.name ?? el.category} is already in ${other.name}`);
  }
}

export interface SystemTotals {
  members: number;
  /** Sum of connector flows of that classification, L/s (terminals and fixtures; "out" ends of equipment are not added twice). */
  flow: number;
  /** Electrical load, W. */
  load: number;
  /** Discharge or loading units. */
  units: number;
}

/**
 * Totals for a system: what its terminals and fixtures draw or discharge. Connectors that supply
 * the system (flowDirection "out" on equipment) aren't counted, so the source isn't added to its load.
 */
export function systemTotals(doc: Document, s: MEPSystem): SystemTotals {
  const out: SystemTotals = { members: 0, flow: 0, load: 0, units: 0 };
  for (const el of systemMembers(doc, s)) {
    out.members++;
    for (const c of elementConnectors(doc, el)) {
      if (c.classification !== s.params.classification) continue;
      if (c.flowDirection === "out" && el.category === Cat.FamilyInstance) continue;
      out.flow += c.flow;
      out.load += c.load;
      out.units += c.units;
    }
  }
  return out;
}
