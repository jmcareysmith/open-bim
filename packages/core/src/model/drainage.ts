import type { Document } from "../document.ts";
import type { ElementId } from "../element.ts";
import { Cat } from "./architecture.ts";
import { elementConnectors, type ModelConnector } from "./mep.ts";
import { fallLabel, pipeFall, pipeFallChecks, pipes, type Pipe } from "./pipes.ts";

// Drainage checks after NZBC G13/AS1 (foul water): fixtures carry discharge units on their
// sanitary connectors; each drain carries the units of everything upstream of it, found by walking
// the pipe network out from its outlet (the lowest open pipe end). Drains are checked for
// capacity at their size and fall, for being at least the fixture's outlet size, for not getting
// smaller in the direction of flow, and for fall. The capacities below are provisional figures in
// the spirit of G13/AS1 and AS/NZS 3500.2 (Jeremy's go-ahead to use our own) — check against the
// current documents before relying on them.

/** Typical discharge units per fixture (provisional), as the library families carry them. */
export const DISCHARGE_UNITS: Record<string, number> = { WC: 4, Basin: 1, Shower: 2, Bath: 4, "Kitchen sink": 3, "Laundry tub": 3, Dishwasher: 2, "Washing machine": 3 };

/** Discharge units a graded drain of nominal size `dn` can take at `fall` (rise over run). */
export function drainCapacity(dn: number, fall: number): number {
  const table: [number, number, number, number][] = [
    // DN, at 1:40, at 1:60, at 1:100
    [40, 3, 2, 1],
    [50, 8, 6, 4],
    [65, 25, 20, 15],
    [80, 60, 50, 40],
    [100, 216, 160, 125],
    [125, 400, 330, 260],
    [150, 800, 650, 500],
    [225, 2500, 2000, 1600],
  ];
  const row = [...table].reverse().find((r) => r[0] <= dn) ?? null;
  if (!row) return 0;
  const f = Math.abs(fall);
  if (f >= 1 / 40 - 1e-9) return row[1];
  if (f >= 1 / 60 - 1e-9) return row[2];
  if (f >= 1 / 100 - 1e-9) return row[3];
  return Math.floor(row[3] * 0.6);
}

/** A vertical stack takes more than a graded drain of its size (provisional: twice the 1:40 figure). */
const stackCapacity = (dn: number) => drainCapacity(dn, 1 / 40) * 2;

export interface DrainPipe {
  pipeId: ElementId;
  dn: number;
  fall: number;
  vertical: boolean;
  /** Discharge units from everything upstream. */
  units: number;
  capacity: number;
}

export interface DrainIssue {
  ids: ElementId[];
  message: string;
}

export interface DrainageResult {
  pipes: DrainPipe[];
  issues: DrainIssue[];
}

const TOL = 2;
/** A fixture's name for messages: its own, else its family's. */
const label = (doc: Document, id: ElementId) => {
  const el = doc.get(id);
  return el?.name ?? doc.get((el?.params as { familyId?: ElementId } | undefined)?.familyId ?? "")?.name ?? "Fixture";
};
const at = (c: ModelConnector) => c.position;
const near = (a: ModelConnector, b: ModelConnector) => Math.hypot(at(a)[0] - at(b)[0], at(a)[1] - at(b)[1], at(a)[2] - at(b)[2]) <= TOL;

/** Walk every sanitary pipe network from its outlet and check it. */
export function drainageCheck(doc: Document): DrainageResult {
  const nodes: ModelConnector[] = [];
  const drains = pipes(doc).filter((p) => p.params.classification === "sanitary");
  for (const p of drains) nodes.push(...elementConnectors(doc, p));
  for (const f of doc.byCategory(Cat.FamilyInstance)) for (const c of elementConnectors(doc, f)) if (c.classification === "sanitary") nodes.push(c);
  const links = nodes.map(() => [] as number[]);
  const isPipe = (c: ModelConnector) => doc.get(c.ownerId)?.category === Cat.Pipe;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      if ((a.ownerId === b.ownerId && isPipe(a)) || (a.ownerId !== b.ownerId && near(a, b))) {
        links[i]!.push(j);
        links[j]!.push(i);
      }
    }
  }
  const pipeInfo = new Map<ElementId, DrainPipe>();
  const issues: DrainIssue[] = [];
  const seen = new Set<number>();
  for (let start = 0; start < nodes.length; start++) {
    if (seen.has(start)) continue;
    // This network's nodes.
    const comp: number[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const i = queue.pop()!;
      comp.push(i);
      for (const j of links[i]!) if (!seen.has(j)) (seen.add(j), queue.push(j));
    }
    // Outlet: the lowest pipe end joined to nothing else (where it leaves for the main drain).
    const open = comp.filter((i) => isPipe(nodes[i]!) && links[i]!.every((j) => nodes[j]!.ownerId === nodes[i]!.ownerId));
    const candidates = open.length ? open : comp.filter((i) => isPipe(nodes[i]!));
    if (!candidates.length) {
      for (const i of comp) {
        const c = nodes[i]!;
        issues.push({ ids: [c.ownerId], message: `${label(doc, c.ownerId)}: its waste outlet isn't connected to a drain` });
      }
      continue;
    }
    const outlet = candidates.reduce((a, b) => (at(nodes[a]!)[2] <= at(nodes[b]!)[2] ? a : b));
    const visited = new Set<number>([outlet]);
    // Depth-first: units upstream of each node; `down` is the pipe the flow leaves through.
    const walk = (i: number, down: Pipe | null): number => {
      const c = nodes[i]!;
      let units = 0;
      const el = doc.get(c.ownerId);
      if (el?.category === Cat.FamilyInstance) {
        units += c.units;
        // The drain it discharges into must be at least its outlet size.
        if (down && c.diameter > down.params.diameter + 0.5) {
          issues.push({ ids: [c.ownerId, down.id], message: `${label(doc, c.ownerId)} needs at least DN${Math.round(c.diameter)}; its drain is DN${down.params.diameter}` });
        }
      }
      for (const j of links[i]!) {
        if (visited.has(j)) continue;
        visited.add(j);
        const n = nodes[j]!;
        const sameOwner = n.ownerId === c.ownerId;
        const upPipe = sameOwner && isPipe(c) ? (doc.get(c.ownerId) as Pipe) : down;
        const u = walk(j, upPipe);
        if (sameOwner && isPipe(c)) {
          const p = doc.get(c.ownerId) as Pipe;
          const { start, end } = p.params;
          const vertical = Math.hypot(end.x - start.x, end.y - start.y) < 1;
          const fall = pipeFall(p);
          pipeInfo.set(p.id, { pipeId: p.id, dn: p.params.diameter, fall, vertical, units: u, capacity: vertical ? stackCapacity(p.params.diameter) : drainCapacity(p.params.diameter, fall) });
          if (down && down.id !== p.id && p.params.diameter > down.params.diameter + 0.5) {
            issues.push({ ids: [p.id, down.id], message: `Drain gets smaller downstream: DN${p.params.diameter} into DN${down.params.diameter}` });
          }
        }
        units += u;
      }
      return units;
    };
    walk(outlet, null);
  }
  for (const d of pipeInfo.values()) {
    if (d.units > d.capacity) {
      issues.push({
        ids: [d.pipeId],
        message: `DN${d.dn} ${d.vertical ? "stack" : `drain at ${fallLabel(d.fall)}`} carries ${d.units} discharge units; it takes ${d.capacity} (provisional)`,
      });
    }
  }
  for (const f of pipeFallChecks(doc)) if (f.minimum > 0) issues.push({ ids: [f.pipeId], message: f.message });
  return { pipes: [...pipeInfo.values()], issues };
}

