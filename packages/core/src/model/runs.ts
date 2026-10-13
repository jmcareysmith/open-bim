import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId } from "../element.ts";
import { Cat, type LevelParams } from "./architecture.ts";

// MEP runs: ducts and pipes are straight runs between two 3D points (heights above their level).
// Fittings are kept automatically, as Revit's routing preferences do: two ends meeting make an
// elbow (or a transition when they run straight on at different sizes), a run ending on the side
// of another splits it and makes a tee, and four ends make a cross. Fittings are elements (they
// schedule and select) maintained by a commit hook (`enableMepFittings`), so every edit leaves the
// network consistent.

export type P3 = { x: number; y: number; z: number };

export type FittingKind = "elbow" | "transition" | "tee" | "cross";

export type FittingParams = {
  kind: FittingKind;
  /** The joint, absolute model coordinates. */
  point: P3;
  /** The runs joined here, by end: a tee lists the two main pieces first, then the branch. */
  ends: { ductId: ElementId; end: "start" | "end" }[];
};
export type Fitting = Element<FittingParams>;

/** What every run has: a level and two ends (z above the level). */
export type RunParams = { levelId: ElementId; start: P3; end: P3 };
export type Run = Element<RunParams>;

/** A kind of run (ducts, pipes): its categories and how big a run is. */
export interface RunKind {
  category: string;
  fittingCategory: string;
  /** Size across (mm): fittings scale with it. */
  size(doc: Document, run: Run): number;
  /** Same section (no transition needed between them). */
  sameSection(doc: Document, a: Run, b: Run): boolean;
}

const kinds = new Map<string, RunKind>();

export function registerRunKind(kind: RunKind): void {
  kinds.set(kind.category, kind);
}

export function runKind(category: string): RunKind | undefined {
  return kinds.get(category) ?? [...kinds.values()].find((k) => k.fittingCategory === category);
}

/** Ends this close (mm) meet. */
export const JOIN_TOL = 2;

export const sub = (a: P3, b: P3): P3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const dot = (a: P3, b: P3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: P3) => Math.hypot(a.x, a.y, a.z);
export const dist = (a: P3, b: P3) => len(sub(a, b));
const unit = (a: P3): P3 => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/** Absolute ends of a run. */
export function runEnds(doc: Document, run: Run): { start: P3; end: P3 } {
  const z0 = doc.get<LevelParams>(run.params.levelId)?.params.elevation ?? 0;
  const { start, end } = run.params;
  return { start: { x: start.x, y: start.y, z: start.z + z0 }, end: { x: end.x, y: end.y, z: end.z + z0 } };
}

export function runLength(run: Run): number {
  const { start: a, end: b } = run.params;
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/** Unit vector from a run's end into the run. */
export function runInward(doc: Document, run: Run, end: "start" | "end"): P3 {
  const { start, end: e } = runEnds(doc, run);
  return end === "start" ? unit(sub(e, start)) : unit(sub(start, e));
}

export function runsOf(doc: Document, kind: RunKind): Run[] {
  return doc.byCategory<RunParams>(kind.category) as Run[];
}

export function fittingsOfRun(doc: Document, run: Run): Fitting[] {
  const kind = runKind(run.category);
  if (!kind) return [];
  return (doc.byCategory<FittingParams>(kind.fittingCategory) as Fitting[]).filter((f) => f.params.ends.some((e) => e.ductId === run.id));
}

interface End {
  run: Run;
  end: "start" | "end";
  p: P3;
}

/** Where `p` lies inside run `r` (clear of its ends), the distance along it; else null. */
function onSide(doc: Document, kind: RunKind, r: Run, p: P3): number | null {
  const { start, end } = runEnds(doc, r);
  const ax = sub(end, start);
  const L = len(ax);
  const t = dot(sub(p, start), ax) / (L * L);
  const along = t * L;
  const clear = kind.size(doc, r) / 2 + 10;
  if (along <= clear || along >= L - clear) return null;
  const foot = { x: start.x + ax.x * t, y: start.y + ax.y * t, z: start.z + ax.z * t };
  return dist(foot, p) <= JOIN_TOL ? along : null;
}

/** Split a run `along` mm from its start (for a tee); returns the new second piece. */
export function splitRun(tx: Transaction, run: Run, along: number): Run {
  const { start, end } = run.params;
  const t = along / runLength(run);
  const cut = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t, z: start.z + (end.z - start.z) * t };
  const second = tx.create<RunParams>(run.category, { ...structuredClone(run.params), start: cut, end: { ...end } }, run.typeId ? { typeId: run.typeId } : {});
  tx.update<RunParams>(run.id, { end: cut });
  return second as Run;
}

/**
 * Bring a kind's fittings in line with its runs: split runs where another ends on their side, then
 * make an elbow, transition, tee or cross wherever ends meet; remove fittings that no longer join
 * anything. Changes nothing when the network is already consistent.
 */
export function syncFittings(tx: Transaction, doc: Document, kind: RunKind): void {
  for (let guard = 0; guard < 100; guard++) {
    const all = runsOf(doc, kind);
    let split = false;
    outer: for (const d of all) {
      for (const end of ["start", "end"] as const) {
        const p = runEnds(doc, d)[end];
        for (const o of all) {
          if (o.id === d.id) continue;
          const along = onSide(doc, kind, o, p);
          if (along === null) continue;
          splitRun(tx, o, along);
          split = true;
          break outer;
        }
      }
    }
    if (!split) break;
  }

  const ends: End[] = runsOf(doc, kind).flatMap((d) => {
    const e = runEnds(doc, d);
    return [
      { run: d, end: "start" as const, p: e.start },
      { run: d, end: "end" as const, p: e.end },
    ];
  });
  const groups: End[][] = [];
  for (const e of ends) {
    const g = groups.find((x) => dist(x[0]!.p, e.p) <= JOIN_TOL);
    if (g) g.push(e);
    else groups.push([e]);
  }
  const straight = (a: End, b: End) => dot(runInward(doc, a.run, a.end), runInward(doc, b.run, b.end)) < -0.999;
  const wanted = groups
    .filter((g) => g.length >= 2 && g.length <= 4)
    .map((g): FittingParams => {
      const fk: FittingKind = g.length === 4 ? "cross" : g.length === 3 ? "tee" : straight(g[0]!, g[1]!) ? "transition" : "elbow";
      let list = g;
      if (fk === "tee") {
        // Main first: the two ends that run straight through each other.
        const pairs: [number, number][] = [
          [0, 1],
          [0, 2],
          [1, 2],
        ];
        const [i, j] = pairs.find(([a, b]) => straight(g[a]!, g[b]!)) ?? [0, 1];
        const k = [0, 1, 2].find((x) => x !== i && x !== j)!;
        list = [g[i]!, g[j]!, g[k]!];
      }
      return { kind: fk, point: { ...g[0]!.p }, ends: list.map((e) => ({ ductId: e.run.id, end: e.end })) };
    })
    // A transition between equal sections is just a straight run: no fitting.
    .filter((f) => !(f.kind === "transition" && kind.sameSection(doc, doc.get(f.ends[0]!.ductId) as Run, doc.get(f.ends[1]!.ductId) as Run)));

  const key = (f: FittingParams) =>
    f.ends
      .map((e) => `${e.ductId}:${e.end}`)
      .sort()
      .join("|");
  const existing = doc.byCategory<FittingParams>(kind.fittingCategory) as Fitting[];
  const byKey = new Map(existing.map((f) => [key(f.params), f]));
  const keep = new Set<ElementId>();
  for (const w of wanted) {
    const f = byKey.get(key(w));
    if (f) {
      keep.add(f.id);
      const same = f.params.kind === w.kind && dist(f.params.point, w.point) < 0.01 && JSON.stringify(f.params.ends) === JSON.stringify(w.ends);
      if (!same) tx.update<FittingParams>(f.id, w);
    } else {
      keep.add(tx.create<FittingParams>(kind.fittingCategory, w).id);
    }
  }
  for (const f of existing) if (!keep.has(f.id) && doc.has(f.id)) tx.delete(f.id);
}

/** Keep duct and pipe fittings up to date after every edit. */
export function enableMepFittings(doc: Document): () => void {
  return doc.addCommitHook((tx) => {
    for (const kind of kinds.values()) if (doc.byCategory(kind.category).length || doc.byCategory(kind.fittingCategory).length) syncFittings(tx, doc, kind);
  });
}

/** How far a fitting takes back each run end it joins (so the fitting fills the gap), mm. */
export function fittingTrim(doc: Document, f: Fitting, runId: ElementId): number {
  const kind = runKind(f.category);
  const sizes = f.params.ends.map((e) => {
    const d = doc.get(e.ductId) as Run | undefined;
    return d && kind ? kind.size(doc, d) : 0;
  });
  const i = f.params.ends.findIndex((e) => e.ductId === runId);
  const own = sizes[i] ?? 0;
  const max = Math.max(...sizes);
  switch (f.params.kind) {
    case "elbow":
      return own; // centreline radius ≈ the size
    case "transition":
      return Math.max(kind?.category === Cat.Pipe ? 25 : 75, Math.abs(sizes[0]! - sizes[1]!)); // ~30° taper each side
    case "tee":
    case "cross":
      return i < 2 || f.params.kind === "cross" ? max / 2 + Math.min(50, max / 2) : max / 2 + Math.min(25, max / 4);
  }
}
