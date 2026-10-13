import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId } from "../element.ts";
import { Cat } from "./architecture.ts";
import {
  classificationInfo,
  elementConnectors,
  mepSystems,
  registerConnectorSource,
  systemMembers,
  type MEPSystem,
  type ModelConnector,
  type SystemClassification,
} from "./mep.ts";
import {
  JOIN_TOL,
  dist,
  enableMepFittings,
  fittingsOfRun,
  registerRunKind,
  runEnds,
  runInward,
  runLength,
  splitRun,
  syncFittings,
  type Fitting,
  type FittingParams,
  type P3,
  type Run,
} from "./runs.ts";

// Ducts (Revit: Systems → Duct): round or rectangular by type, sized per instance. Routing and
// automatic fittings are shared with pipes (runs.ts).

export type DuctTypeParams = {
  shape: "round" | "rectangular";
  /** Duct material, for schedules and the friction factor later (e.g. "Galvanised steel"). */
  material: string;
};

export type DuctParams = {
  levelId: ElementId;
  /** Centreline ends; z is the height above the level (Revit's middle elevation). */
  start: P3;
  end: P3;
  /** Round ducts. */
  diameter: number;
  /** Rectangular ducts: width across, height up. */
  width: number;
  height: number;
  classification: SystemClassification;
};
export type Duct = Element<DuctParams>;

export type DuctFittingParams = FittingParams;
export type DuctFitting = Fitting;

registerCategory({ name: Cat.DuctType, dependencies: () => [], cascadeDelete: false, isType: true });
registerCategory({
  name: Cat.Duct,
  dependencies: (el) => [...(el.typeId ? [el.typeId] : []), (el.params as DuctParams).levelId],
  // Fittings at this duct's ends follow it.
  related: (doc, el) => fittingsOf(doc, el.id).map((f) => f.id),
  cascadeDelete: true,
  isType: false,
});
registerCategory({
  name: Cat.DuctFitting,
  // A fitting's shape comes from its ducts.
  dependencies: (el) => (el.params as DuctFittingParams).ends.map((e) => e.ductId),
  cascadeDelete: true,
  isType: false,
});

/** Standard round duct sizes, mm. */
export const ROUND_DUCT_SIZES = [100, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500, 550, 600, 700, 800, 900, 1000, 1200];

export function ductTypes(doc: Document): Element<DuctTypeParams>[] {
  return doc.byCategory<DuctTypeParams>(Cat.DuctType);
}

/** Default duct types (round and rectangular galvanised), if the project has none. */
export function ensureDuctTypes(tx: Transaction, doc: Document): ElementId[] {
  const have = ductTypes(doc);
  if (have.length) return have.map((t) => t.id);
  return [
    tx.create<DuctTypeParams>(Cat.DuctType, { shape: "round", material: "Galvanised steel" }, { name: "Round Duct - Galvanised" }).id,
    tx.create<DuctTypeParams>(Cat.DuctType, { shape: "rectangular", material: "Galvanised steel" }, { name: "Rectangular Duct - Galvanised" }).id,
  ];
}

export function ductShape(doc: Document, duct: Duct): "round" | "rectangular" {
  return (duct.typeId ? doc.get<DuctTypeParams>(duct.typeId)?.params.shape : undefined) ?? "round";
}

/** The duct's size across (round: diameter; rectangular: the larger side), mm. */
export function ductSize(doc: Document, duct: Duct): number {
  return ductShape(doc, duct) === "round" ? duct.params.diameter : Math.max(duct.params.width, duct.params.height);
}

/** Size label: "Ø200" or "400×250". */
export function ductSizeLabel(doc: Document, duct: Duct): string {
  return ductShape(doc, duct) === "round" ? `Ø${Math.round(duct.params.diameter)}` : `${Math.round(duct.params.width)}×${Math.round(duct.params.height)}`;
}

/** Absolute ends of a duct. */
export const ductEnds = (doc: Document, duct: Duct): { start: P3; end: P3 } => runEnds(doc, duct as unknown as Run);

export const ductLength = (duct: Duct): number => runLength(duct as unknown as Run);

export function createDuct(
  tx: Transaction,
  doc: Document,
  typeId: ElementId,
  levelId: ElementId,
  start: P3,
  end: P3,
  opts: Partial<Pick<DuctParams, "diameter" | "width" | "height" | "classification">> = {},
): Duct {
  if (Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z) < 10) throw new Error("A duct needs some length");
  const type = doc.require<DuctTypeParams>(typeId);
  if (type.category !== Cat.DuctType) throw new Error("Not a duct type");
  return tx.create<DuctParams>(
    Cat.Duct,
    {
      levelId,
      start: { ...start },
      end: { ...end },
      diameter: opts.diameter ?? 200,
      width: opts.width ?? 400,
      height: opts.height ?? 250,
      classification: opts.classification ?? "supplyAir",
    },
    { typeId },
  ) as Duct;
}

export const ducts = (doc: Document): Duct[] => doc.byCategory<DuctParams>(Cat.Duct) as Duct[];

/** Fittings at a duct's (or pipe's) ends. */
export function fittingsOf(doc: Document, runId: ElementId): Fitting[] {
  const r = doc.get(runId);
  return r ? fittingsOfRun(doc, r as Run) : [];
}

/** Unit vector from a duct end into the duct. */
export const ductInward = (doc: Document, duct: Duct, end: "start" | "end"): P3 => runInward(doc, duct as unknown as Run, end);

// Each duct end is a connector, facing out of the duct.
registerConnectorSource(Cat.Duct, (doc, el) => {
  const d = el as Duct;
  const shape = ductShape(doc, d);
  const ends = ductEnds(doc, d);
  return (["start", "end"] as const).map((end, index): ModelConnector => {
    const p = ends[end];
    const inward = ductInward(doc, d, end);
    return {
      ownerId: d.id,
      index,
      classification: d.params.classification,
      domain: "duct",
      position: [p.x, p.y, p.z],
      direction: [-inward.x, -inward.y, -inward.z],
      shape,
      diameter: d.params.diameter,
      width: d.params.width,
      height: d.params.height,
      flow: 0,
      load: 0,
      units: 0,
      flowDirection: "both",
    };
  });
});

// ---- automatic fittings -----------------------------------------------------

export const DUCT_RUNS = {
  category: Cat.Duct,
  fittingCategory: Cat.DuctFitting,
  size: (doc: Document, r: Run) => ductSize(doc, r as unknown as Duct),
  sameSection: (doc: Document, a: Run, b: Run) => {
    if (!a || !b) return true;
    const p = (a as unknown as Duct).params;
    const q = (b as unknown as Duct).params;
    return (
      ductShape(doc, a as unknown as Duct) === ductShape(doc, b as unknown as Duct) &&
      Math.abs(p.diameter - q.diameter) < 0.5 &&
      Math.abs(p.width - q.width) < 0.5 &&
      Math.abs(p.height - q.height) < 0.5
    );
  },
};
registerRunKind(DUCT_RUNS);

/** Bring duct fittings in line with the ducts (see runs.ts). */
export const syncDuctFittings = (tx: Transaction, doc: Document): void => syncFittings(tx, doc, DUCT_RUNS);

/** Split a duct `along` mm from its start (for a tee); returns the new second piece. */
export const splitDuct = (tx: Transaction, _doc: Document, duct: Duct, along: number): Duct => splitRun(tx, duct as unknown as Run, along) as unknown as Duct;

/** Keep duct (and pipe) fittings up to date after every edit. */
export const enableDuctFittings = enableMepFittings;

// ---- network, flow and sizing ----------------------------------------------

/** Connectors joined to each other (within 2 mm and both duct domain), as an adjacency list. */
function ductGraph(doc: Document, sys: MEPSystem): { nodes: ModelConnector[]; links: Map<number, number[]> } {
  const members = systemMembers(doc, sys);
  const nodes: ModelConnector[] = [];
  for (const el of [...members, ...ducts(doc).filter((d) => d.params.classification === sys.params.classification)]) {
    for (const c of elementConnectors(doc, el)) if (c.classification === sys.params.classification) nodes.push(c);
  }
  const links = new Map<number, number[]>(nodes.map((_, i) => [i, []]));
  const link = (a: number, b: number) => {
    links.get(a)!.push(b);
    links.get(b)!.push(a);
  };
  const at = (c: ModelConnector) => ({ x: c.position[0], y: c.position[1], z: c.position[2] });
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      // The two ends of one duct are linked through it; coincident connectors are joined.
      if (a.ownerId === b.ownerId ? doc.get(a.ownerId)?.category === Cat.Duct : dist(at(a), at(b)) <= JOIN_TOL) link(i, j);
    }
  }
  return { nodes, links };
}

/**
 * Air flow each duct carries (L/s): the terminals downstream of the system's equipment, found by
 * walking the duct network out from it. Ducts not reached aren't in the map.
 */
export function ductFlows(doc: Document, sys: MEPSystem): Map<ElementId, number> {
  const { nodes, links } = ductGraph(doc, sys);
  const isEquipment = (c: ModelConnector) => {
    const el = doc.get(c.ownerId);
    return el?.category === Cat.FamilyInstance && c.flowDirection === (sys.params.classification === "supplyAir" || sys.params.classification === "outsideAir" ? "out" : "in");
  };
  let source = nodes.findIndex(isEquipment);
  if (source < 0) source = nodes.findIndex((c) => doc.get(c.ownerId)?.category === Cat.FamilyInstance);
  const out = new Map<ElementId, number>();
  if (source < 0) return out;
  // Depth-first: each node's subtree total of terminal flows.
  const seen = new Set<number>([source]);
  const visit = (i: number): number => {
    let total = 0;
    const own = nodes[i]!;
    const el = doc.get(own.ownerId);
    if (el?.category === Cat.FamilyInstance && i !== source) total += own.flow;
    for (const j of links.get(i)!) {
      if (seen.has(j)) continue;
      seen.add(j);
      const f = visit(j);
      // Flow along a duct: what lies beyond its far end.
      const a = nodes[i]!;
      const b = nodes[j]!;
      if (a.ownerId === b.ownerId && doc.get(a.ownerId)?.category === Cat.Duct) out.set(a.ownerId, Math.max(out.get(a.ownerId) ?? 0, f));
      total += f;
    }
    return total;
  };
  visit(source);
  return out;
}

/**
 * Size the ducts of a system from the air they carry (Revit: Duct Sizing, velocity method): round
 * ducts to the next standard diameter, rectangular ones keep their height and take the width.
 */
export function sizeDucts(tx: Transaction, doc: Document, systemId: ElementId, opts: { velocity?: number } = {}): number {
  const sys = doc.require(systemId) as MEPSystem;
  if (classificationInfo(sys.params.classification).domain !== "duct") throw new Error("Only duct systems are sized here");
  const v = opts.velocity ?? 5; // m/s
  const flows = ductFlows(doc, sys);
  if (!flows.size) throw new Error("No ducts reach the system's equipment: connect the ducts to it first");
  let n = 0;
  for (const [id, q] of flows) {
    const d = doc.get(id) as Duct | undefined;
    if (!d || q <= 0) continue;
    const area = q / 1000 / v; // m²
    if (ductShape(doc, d) === "round") {
      const need = Math.sqrt((4 * area) / Math.PI) * 1000;
      const diameter = ROUND_DUCT_SIZES.find((s) => s >= need) ?? Math.ceil(need / 50) * 50;
      if (diameter !== d.params.diameter) tx.update<DuctParams>(id, { diameter });
    } else {
      const width = Math.max(100, Math.ceil((area * 1e6) / d.params.height / 50) * 50);
      if (width !== d.params.width) tx.update<DuctParams>(id, { width });
    }
    n++;
  }
  return n;
}

/** Duct systems that ducts of this classification could be part of (for the duct tool). */
export function ductSystems(doc: Document): MEPSystem[] {
  return mepSystems(doc).filter((s) => classificationInfo(s.params.classification).domain === "duct");
}
