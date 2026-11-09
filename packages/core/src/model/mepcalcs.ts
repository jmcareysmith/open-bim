import type { Document } from "../document.ts";
import type { ElementId } from "../element.ts";
import { Cat } from "./architecture.ts";
import { ductShape, type Duct } from "./ducts.ts";
import { classificationInfo, elementConnectors, systemMembers, type MEPSystem, type ModelConnector } from "./mep.ts";
import type { Pipe } from "./pipes.ts";

// Pressure loss in duct and pipe systems (Revit: System Inspector / pressure loss reports).
// From the system's source (equipment) out to every terminal: friction in each run by
// Darcy–Weisbach with the Swamee–Jain friction factor, plus a loss coefficient K at each joint
// (elbow by its angle, tee 0.2 through / 0.6 to a branch, size change 0.1) on the downstream
// run's velocity pressure. The critical path is the terminal with the highest total.
//
// PROVISIONAL figures: air 1.2 kg/m³, ν 1.5e-5 m²/s, galvanised duct roughness 0.09 mm; water
// 998 kg/m³, ν 1.0e-6 m²/s, plastic/copper roughness 0.007 mm; pipe DN taken as the bore.

const JOIN_TOL = 2;

export interface RunLoss {
  id: ElementId;
  /** L/s */
  flow: number;
  /** m/s */
  velocity: number;
  /** Pa/m */
  friction: number;
  /** m */
  length: number;
  /** Friction plus the joint into it, Pa. */
  loss: number;
}

export interface PressureReport {
  domain: "duct" | "pipe";
  runs: RunLoss[];
  /** Worst path from the source: total Pa, the runs along it, and the terminal it ends at. */
  critical: { loss: number; path: ElementId[]; terminal: ElementId | null };
  notes: string[];
}

interface Fluid {
  rho: number;
  nu: number;
  eps: number;
}
const AIR: Fluid = { rho: 1.2, nu: 1.5e-5, eps: 0.00009 };
const WATER: Fluid = { rho: 998, nu: 1.0e-6, eps: 0.000007 };

/** Darcy friction factor: laminar 64/Re, else Swamee–Jain. */
export function frictionFactor(re: number, relRough: number): number {
  if (re <= 0) return 0;
  if (re < 2300) return 64 / re;
  const l = Math.log10(relRough / 3.7 + 5.74 / re ** 0.9);
  return 0.25 / (l * l);
}

/** Section of a run: area m², hydraulic (equivalent) diameter m. */
function section(doc: Document, el: { category: string; params: unknown }): { area: number; dh: number } {
  if (el.category === Cat.Pipe) {
    const d = (el as Pipe).params.diameter / 1000;
    return { area: (Math.PI * d * d) / 4, dh: d };
  }
  const p = (el as Duct).params;
  if (ductShape(doc, el as Duct) === "round") {
    const d = p.diameter / 1000;
    return { area: (Math.PI * d * d) / 4, dh: d };
  }
  const a = p.width / 1000;
  const b = p.height / 1000;
  // Huebscher's equivalent diameter for rectangular ducts.
  return { area: a * b, dh: (1.3 * (a * b) ** 0.625) / (a + b) ** 0.25 };
}

export function systemPressure(doc: Document, sys: MEPSystem): PressureReport {
  const domain = classificationInfo(sys.params.classification).domain;
  const notes: string[] = [];
  if (domain !== "duct" && domain !== "pipe") throw new Error("Pressure loss is for duct and pipe systems");
  const fluid = domain === "duct" ? AIR : WATER;
  const runCat = domain === "duct" ? Cat.Duct : Cat.Pipe;
  const report: PressureReport = { domain, runs: [], critical: { loss: 0, path: [], terminal: null }, notes };
  if (sys.params.classification === "sanitary" || sys.params.classification === "stormwater") {
    notes.push("Gravity drainage: see NZ Checks → G13 drainage for capacities and falls.");
    return report;
  }

  // The network: connectors of the members and of matching runs; a run's two ends link through it.
  const runs = doc.byCategory(runCat).filter((r) => (r.params as { classification?: string }).classification === sys.params.classification);
  const nodes: ModelConnector[] = [];
  for (const el of [...systemMembers(doc, sys), ...runs]) for (const c of elementConnectors(doc, el)) if (c.classification === sys.params.classification) nodes.push(c);
  const links = new Map<number, number[]>(nodes.map((_, i) => [i, []]));
  const d3 = (a: ModelConnector, b: ModelConnector) => Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2]);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      if (a.ownerId === b.ownerId ? doc.get(a.ownerId)?.category === runCat : d3(a, b) <= JOIN_TOL) {
        links.get(i)!.push(j);
        links.get(j)!.push(i);
      }
    }
  }
  const isInstance = (c: ModelConnector) => doc.get(c.ownerId)?.category === Cat.FamilyInstance;
  let source = nodes.findIndex((c) => isInstance(c) && c.flowDirection === "out");
  if (source < 0) source = nodes.findIndex(isInstance);
  if (source < 0) {
    notes.push("No equipment in the system to start from.");
    return report;
  }

  // Flows: each run carries the terminal flows beyond it.
  const flows = new Map<ElementId, number>();
  {
    const seen = new Set<number>([source]);
    const visit = (i: number): number => {
      let total = isInstance(nodes[i]!) && i !== source ? nodes[i]!.flow : 0;
      for (const j of links.get(i)!) {
        if (seen.has(j)) continue;
        seen.add(j);
        const f = visit(j);
        if (nodes[i]!.ownerId === nodes[j]!.ownerId) flows.set(nodes[i]!.ownerId, Math.max(flows.get(nodes[i]!.ownerId) ?? 0, f));
        total += f;
      }
      return total;
    };
    visit(source);
  }

  // Per run: velocity, friction.
  const byId = new Map<ElementId, RunLoss>();
  for (const [id, q] of flows) {
    const el = doc.get(id);
    if (!el) continue;
    const { area, dh } = section(doc, el);
    const v = area > 0 ? q / 1000 / area : 0;
    const f = frictionFactor((v * dh) / fluid.nu, fluid.eps / dh);
    const friction = dh > 0 ? ((f / dh) * fluid.rho * v * v) / 2 : 0;
    const ends = elementConnectors(doc, el);
    const length = ends.length >= 2 ? d3(ends[0]!, ends[1]!) / 1000 : 0;
    const r: RunLoss = { id, flow: q, velocity: v, friction, length, loss: friction * length };
    byId.set(id, r);
    report.runs.push(r);
  }

  // Joint losses and the worst path.
  const dirOf = (c: ModelConnector) => c.direction;
  const seen = new Set<number>([source]);
  // After crossing a joint, carry on along the run entered (connectors at a joint all link to
  // each other, so hopping again would jump between the pieces meeting there).
  const walk = (i: number, total: number, path: ElementId[], viaJoint = false) => {
    const here = nodes[i]!;
    if (isInstance(here) && i !== source) {
      if (total > report.critical.loss || !report.critical.terminal) report.critical = { loss: total, path, terminal: here.ownerId };
      return;
    }
    for (const j of links.get(i)!) {
      if (seen.has(j)) continue;
      const next = nodes[j]!;
      if (viaJoint && here.ownerId !== next.ownerId) continue;
      seen.add(j);
      if (here.ownerId === next.ownerId) {
        // Along a run.
        const r = byId.get(here.ownerId);
        walk(j, total + (r ? r.friction * r.length : 0), r ? [...path, r.id] : path);
      } else {
        // A joint: K on the downstream run's velocity pressure.
        const down = byId.get(next.ownerId);
        let k = 0;
        if (down && doc.get(here.ownerId)?.category === runCat) {
          const meeting = links.get(i)!.filter((x) => nodes[x]!.ownerId !== here.ownerId).length + 1;
          const a = dirOf(here);
          const b = dirOf(next);
          // Facing connectors point opposite when the run goes straight on.
          const cos = -(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
          const angle = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
          if (meeting >= 3) k += angle < 30 ? 0.2 : 0.6;
          else if (angle > 15) k += 0.3 * Math.min(1, angle / 90);
          const up = byId.get(here.ownerId);
          if (up && Math.abs(up.velocity - down.velocity) > 0.05 * Math.max(up.velocity, down.velocity)) k += 0.1;
          const dp = (k * fluid.rho * down.velocity * down.velocity) / 2;
          down.loss += dp;
          walk(j, total + dp, path, true);
        } else walk(j, total, path, true);
      }
    }
  };
  walk(source, 0, []);
  if (!report.runs.length) notes.push("No runs connect to the system's equipment.");
  notes.push("Provisional: Darcy–Weisbach with typical roughness and fitting K values; confirm for design.");
  return report;
}
