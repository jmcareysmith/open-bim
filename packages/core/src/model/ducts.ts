import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId } from "../element.ts";
import { Cat, type LevelParams } from "./architecture.ts";
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

// Ducts (Revit: Systems → Duct). A duct is a straight run between two 3D points (heights above its
// level), round or rectangular by type, sized per instance. Fittings are kept automatically, as
// Revit's routing preferences do: two duct ends meeting make an elbow (or a transition when they
// run straight on at different sizes), a duct ending on the side of another splits it and makes a
// tee, and four ends make a cross. Fittings are elements (they schedule and select) maintained by
// a commit hook (`enableDuctFittings`), so every edit leaves the network consistent.

export type P3 = { x: number; y: number; z: number };

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

export type FittingKind = "elbow" | "transition" | "tee" | "cross";

export type DuctFittingParams = {
  kind: FittingKind;
  /** The joint, absolute model coordinates. */
  point: P3;
  /** The ducts joined here, by end: a tee lists the two main pieces first, then the branch. */
  ends: { ductId: ElementId; end: "start" | "end" }[];
};
export type DuctFitting = Element<DuctFittingParams>;

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

/** Ends this close (mm) meet. */
const JOIN_TOL = 2;
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
export function ductEnds(doc: Document, duct: Duct): { start: P3; end: P3 } {
  const z0 = doc.get<LevelParams>(duct.params.levelId)?.params.elevation ?? 0;
  const { start, end } = duct.params;
  return { start: { x: start.x, y: start.y, z: start.z + z0 }, end: { x: end.x, y: end.y, z: end.z + z0 } };
}

export function ductLength(duct: Duct): number {
  const { start: a, end: b } = duct.params;
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

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

export function fittingsOf(doc: Document, ductId: ElementId): DuctFitting[] {
  return (doc.byCategory<DuctFittingParams>(Cat.DuctFitting) as DuctFitting[]).filter((f) => f.params.ends.some((e) => e.ductId === ductId));
}

const sub = (a: P3, b: P3): P3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: P3, b: P3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: P3) => Math.hypot(a.x, a.y, a.z);
const dist = (a: P3, b: P3) => len(sub(a, b));
const unit = (a: P3): P3 => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/** Unit vector from a duct end into the duct. */
export function ductInward(doc: Document, duct: Duct, end: "start" | "end"): P3 {
  const { start, end: e } = ductEnds(doc, duct);
  return end === "start" ? unit(sub(e, start)) : unit(sub(start, e));
}

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

interface End {
  duct: Duct;
  end: "start" | "end";
  p: P3;
}

/** Where `p` lies inside duct `d` (clear of its ends), the distance along it; else null. */
function onSide(doc: Document, d: Duct, p: P3): number | null {
  const { start, end } = ductEnds(doc, d);
  const ax = sub(end, start);
  const L = len(ax);
  const t = dot(sub(p, start), ax) / (L * L);
  const along = t * L;
  if (along <= ductSize(doc, d) / 2 + 10 || along >= L - ductSize(doc, d) / 2 - 10) return null;
  const foot = { x: start.x + ax.x * t, y: start.y + ax.y * t, z: start.z + ax.z * t };
  return dist(foot, p) <= JOIN_TOL ? along : null;
}

/**
 * Bring fittings in line with the ducts: split ducts where another ends on their side, then make
 * an elbow, transition, tee or cross wherever duct ends meet; remove fittings that no longer join
 * anything. Changes nothing when the network is already consistent.
 */
export function syncDuctFittings(tx: Transaction, doc: Document): void {
  // Tees: a duct end on the side of another splits that duct there.
  for (let guard = 0; guard < 100; guard++) {
    const all = ducts(doc);
    let split = false;
    outer: for (const d of all) {
      for (const end of ["start", "end"] as const) {
        const p = ductEnds(doc, d)[end];
        for (const o of all) {
          if (o.id === d.id) continue;
          const along = onSide(doc, o, p);
          if (along === null) continue;
          splitDuct(tx, doc, o, along);
          split = true;
          break outer;
        }
      }
    }
    if (!split) break;
  }

  // Group duct ends meeting at a point.
  const ends: End[] = ducts(doc).flatMap((d) => {
    const e = ductEnds(doc, d);
    return [
      { duct: d, end: "start" as const, p: e.start },
      { duct: d, end: "end" as const, p: e.end },
    ];
  });
  const groups: End[][] = [];
  for (const e of ends) {
    const g = groups.find((x) => dist(x[0]!.p, e.p) <= JOIN_TOL);
    if (g) g.push(e);
    else groups.push([e]);
  }
  const wanted = groups
    .filter((g) => g.length >= 2 && g.length <= 4)
    .map((g): DuctFittingParams => {
      const kind: FittingKind = g.length === 4 ? "cross" : g.length === 3 ? "tee" : collinear(doc, g[0]!, g[1]!) ? "transition" : "elbow";
      let list = g;
      if (kind === "tee") {
        // Main first: the two ends that run straight through each other.
        const pairs: [number, number][] = [[0, 1], [0, 2], [1, 2]];
        const [i, j] = pairs.find(([a, b]) => collinear(doc, g[a]!, g[b]!)) ?? [0, 1];
        const k = [0, 1, 2].find((x) => x !== i && x !== j)!;
        list = [g[i]!, g[j]!, g[k]!];
      }
      return { kind, point: { ...g[0]!.p }, ends: list.map((e) => ({ ductId: e.duct.id, end: e.end })) };
    })
    // A transition between equal sizes is just a straight run: no fitting.
    .filter((f) => !(f.kind === "transition" && sameSize(doc, f)));

  const key = (f: DuctFittingParams) =>
    f.ends
      .map((e) => `${e.ductId}:${e.end}`)
      .sort()
      .join("|");
  const existing = doc.byCategory<DuctFittingParams>(Cat.DuctFitting) as DuctFitting[];
  const byKey = new Map(existing.map((f) => [key(f.params), f]));
  const keep = new Set<ElementId>();
  for (const w of wanted) {
    const f = byKey.get(key(w));
    if (f) {
      keep.add(f.id);
      const same = f.params.kind === w.kind && dist(f.params.point, w.point) < 0.01 && JSON.stringify(f.params.ends) === JSON.stringify(w.ends);
      if (!same) tx.update<DuctFittingParams>(f.id, w);
    } else {
      keep.add(tx.create<DuctFittingParams>(Cat.DuctFitting, w).id);
    }
  }
  for (const f of existing) if (!keep.has(f.id) && doc.has(f.id)) tx.delete(f.id);
}

function collinear(doc: Document, a: End, b: End): boolean {
  const u = ductInward(doc, a.duct, a.end);
  const v = ductInward(doc, b.duct, b.end);
  return dot(u, v) < -0.999;
}

function sameSize(doc: Document, f: DuctFittingParams): boolean {
  const [a, b] = f.ends.map((e) => doc.get(e.ductId) as Duct);
  if (!a || !b) return true;
  const p = a.params;
  const q = b.params;
  return ductShape(doc, a) === ductShape(doc, b) && Math.abs(p.diameter - q.diameter) < 0.5 && Math.abs(p.width - q.width) < 0.5 && Math.abs(p.height - q.height) < 0.5;
}

/** Split a duct `along` mm from its start (for a tee); returns the new second piece. */
export function splitDuct(tx: Transaction, doc: Document, duct: Duct, along: number): Duct {
  const { start, end } = duct.params;
  const L = ductLength(duct);
  const t = along / L;
  const cut = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t, z: start.z + (end.z - start.z) * t };
  const second = tx.create<DuctParams>(Cat.Duct, { ...structuredClone(duct.params), start: cut, end: { ...end } }, duct.typeId ? { typeId: duct.typeId } : {});
  tx.update<DuctParams>(duct.id, { end: cut });
  return second as Duct;
}

/** Keep duct fittings up to date after every edit. */
export function enableDuctFittings(doc: Document): () => void {
  return doc.addCommitHook((tx) => {
    if (doc.byCategory(Cat.Duct).length || doc.byCategory(Cat.DuctFitting).length) syncDuctFittings(tx, doc);
  });
}

/** How far a fitting takes back each duct end it joins (so the fitting fills the gap), mm. */
export function fittingTrim(doc: Document, f: DuctFitting, ductId: ElementId): number {
  const sizes = f.params.ends.map((e) => {
    const d = doc.get(e.ductId) as Duct | undefined;
    return d ? ductSize(doc, d) : 0;
  });
  const i = f.params.ends.findIndex((e) => e.ductId === ductId);
  const own = sizes[i] ?? 0;
  const max = Math.max(...sizes);
  switch (f.params.kind) {
    case "elbow":
      return own; // centreline radius ≈ the duct size
    case "transition":
      return Math.max(75, Math.abs(sizes[0]! - sizes[1]!)); // ~30° taper each side
    case "tee":
    case "cross":
      return i < 2 || f.params.kind === "cross" ? max / 2 + 50 : max / 2 + 25;
  }
}

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
