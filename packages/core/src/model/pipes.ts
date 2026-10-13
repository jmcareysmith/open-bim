import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId } from "../element.ts";
import { Cat } from "./architecture.ts";
import { classificationInfo, registerConnectorSource, type ModelConnector, type SystemClassification } from "./mep.ts";
import { fittingsOfRun, registerRunKind, runEnds, runInward, runLength, type Fitting, type P3, type Run } from "./runs.ts";

// Pipes (Revit: Systems → Pipe): round runs by nominal diameter, of a material by type (PE-X or
// copper for water, uPVC for drainage). Fittings are automatic, as for ducts (runs.ts). Sanitary
// and stormwater pipes fall: the pipe tool drops each run by its fall, and `pipeFallChecks` lists
// runs flatter than the minimum for their size.

export type PipeTypeParams = {
  material: string;
  /** Systems this type is meant for (the pipe tool picks the type to match), e.g. ["coldWater", "hotWater"]. */
  use: SystemClassification[];
};

export type PipeParams = {
  levelId: ElementId;
  start: P3;
  end: P3;
  /** Nominal diameter (DN), mm. */
  diameter: number;
  classification: SystemClassification;
};
export type Pipe = Element<PipeParams>;
export type PipeFitting = Fitting;

/** Nominal pipe sizes (DN), mm. */
export const PIPE_SIZES = [15, 20, 25, 32, 40, 50, 65, 80, 100, 125, 150, 225, 300];

registerCategory({ name: Cat.PipeType, dependencies: () => [], cascadeDelete: false, isType: true });
registerCategory({
  name: Cat.Pipe,
  dependencies: (el) => [...(el.typeId ? [el.typeId] : []), (el.params as PipeParams).levelId],
  related: (doc, el) => fittingsOfRun(doc, el as unknown as Run).map((f) => f.id),
  cascadeDelete: true,
  isType: false,
});
registerCategory({
  name: Cat.PipeFitting,
  dependencies: (el) => (el.params as { ends: { ductId: ElementId }[] }).ends.map((e) => e.ductId),
  cascadeDelete: true,
  isType: false,
});

export const PIPE_RUNS = {
  category: Cat.Pipe,
  fittingCategory: Cat.PipeFitting,
  size: (_doc: Document, r: Run) => (r as unknown as Pipe).params.diameter,
  sameSection: (_doc: Document, a: Run, b: Run) => !a || !b || Math.abs((a as unknown as Pipe).params.diameter - (b as unknown as Pipe).params.diameter) < 0.5,
};
registerRunKind(PIPE_RUNS);

// Each pipe end is a connector, facing out of the pipe.
registerConnectorSource(Cat.Pipe, (doc, el) => {
  const p = el as Pipe;
  const ends = runEnds(doc, p as unknown as Run);
  return (["start", "end"] as const).map((end, index): ModelConnector => {
    const q = ends[end];
    const inward = runInward(doc, p as unknown as Run, end);
    return {
      ownerId: p.id,
      index,
      classification: p.params.classification,
      domain: "pipe",
      position: [q.x, q.y, q.z],
      direction: [-inward.x, -inward.y, -inward.z],
      shape: "round",
      diameter: p.params.diameter,
      width: 0,
      height: 0,
      flow: 0,
      load: 0,
      units: 0,
      flowDirection: "both",
    };
  });
});

export function pipeTypes(doc: Document): Element<PipeTypeParams>[] {
  return doc.byCategory<PipeTypeParams>(Cat.PipeType);
}

/** Default pipe types (NZ practice), if the project has none. */
export function ensurePipeTypes(tx: Transaction, doc: Document): ElementId[] {
  const have = pipeTypes(doc);
  if (have.length) return have.map((t) => t.id);
  const t = (name: string, material: string, use: SystemClassification[]) => tx.create<PipeTypeParams>(Cat.PipeType, { material, use }, { name }).id;
  return [
    t("PE-X - Water supply", "PE-X", ["coldWater", "hotWater"]),
    t("Copper - Water supply", "Copper", ["coldWater", "hotWater", "gas"]),
    t("uPVC - Sanitary", "uPVC", ["sanitary", "vent"]),
    t("uPVC - Stormwater", "uPVC", ["stormwater"]),
  ];
}

/** The pipe type for a system: the first whose use includes it, else the first type. */
export function pipeTypeFor(doc: Document, c: SystemClassification): ElementId | undefined {
  const types = pipeTypes(doc);
  return (types.find((t) => t.params.use.includes(c)) ?? types[0])?.id;
}

/** Drainage falls. */
export function pipeFalls(c: SystemClassification): boolean {
  return c === "sanitary" || c === "stormwater";
}

/**
 * Minimum fall (rise over run) for a drainage pipe of nominal size `dn` mm: 1:40 up to DN65,
 * 1:60 for DN80–DN100, 1:100 above. Provisional figures after NZBC G13/AS1 and AS/NZS 3500.2;
 * check against the current documents.
 */
export function minimumFall(dn: number): number {
  return dn <= 65 ? 1 / 40 : dn <= 100 ? 1 / 60 : 1 / 100;
}

/** A pipe's fall (positive = drops from start to end) as rise over plan run; 0 for vertical. */
export function pipeFall(pipe: Pipe): number {
  const { start, end } = pipe.params;
  const run = Math.hypot(end.x - start.x, end.y - start.y);
  return run < 1 ? 0 : (start.z - end.z) / run;
}

export function fallLabel(f: number): string {
  return Math.abs(f) < 1e-6 ? "level" : `1:${Math.round(1 / Math.abs(f))}${f < 0 ? " (rises)" : ""}`;
}

export function createPipe(
  tx: Transaction,
  doc: Document,
  typeId: ElementId,
  levelId: ElementId,
  start: P3,
  end: P3,
  opts: Partial<Pick<PipeParams, "diameter" | "classification">> = {},
): Pipe {
  if (Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z) < 5) throw new Error("A pipe needs some length");
  const type = doc.require<PipeTypeParams>(typeId);
  if (type.category !== Cat.PipeType) throw new Error("Not a pipe type");
  const classification = opts.classification ?? "coldWater";
  if (classificationInfo(classification).domain !== "pipe") throw new Error("Pipes carry piping systems only");
  return tx.create<PipeParams>(Cat.Pipe, { levelId, start: { ...start }, end: { ...end }, diameter: opts.diameter ?? (pipeFalls(classification) ? 100 : 20), classification }, { typeId }) as Pipe;
}

export const pipes = (doc: Document): Pipe[] => doc.byCategory<PipeParams>(Cat.Pipe) as Pipe[];

export const pipeLength = (p: Pipe): number => runLength(p as unknown as Run);

export interface FallIssue {
  pipeId: ElementId;
  fall: number;
  minimum: number;
  message: string;
}

/** Drainage pipes laid flatter than the minimum fall for their size (vertical stacks are fine). */
export function pipeFallChecks(doc: Document): FallIssue[] {
  const out: FallIssue[] = [];
  for (const p of pipes(doc)) {
    if (!pipeFalls(p.params.classification)) continue;
    const { start, end } = p.params;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 1) continue;
    const fall = Math.abs(pipeFall(p));
    const minimum = minimumFall(p.params.diameter);
    if (fall + 1e-9 < minimum) {
      out.push({ pipeId: p.id, fall, minimum, message: `DN${p.params.diameter} ${classificationInfo(p.params.classification).label.toLowerCase()} pipe falls ${fallLabel(fall)}; it needs at least ${fallLabel(minimum)}` });
    }
  }
  return out;
}
