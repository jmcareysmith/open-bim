import { describe, expect, it } from "vitest";
import {
  Cat,
  Document,
  applyResidentialTemplate,
  createDuct,
  createPipe,
  elementConnectors,
  enableMepFittings,
  ensureDuctTypes,
  ensurePipeTypes,
  fallLabel,
  minimumFall,
  pipeFall,
  pipeFallChecks,
  pipeTypeFor,
  pipes,
  type FittingParams,
  type P3,
  type Pipe,
} from "../src/index.ts";

const p = (x: number, y: number, z = 300): P3 => ({ x, y, z });

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  enableMepFittings(doc);
  doc.transact("Types", (tx) => ensurePipeTypes(tx, doc));
  const pipe = (a: P3, b: P3, classification: "coldWater" | "sanitary" = "coldWater", diameter = classification === "sanitary" ? 100 : 20) =>
    doc.transact("Pipe", (tx) => createPipe(tx, doc, pipeTypeFor(doc, classification)!, ids.levels.ground, a, b, { classification, diameter }));
  const fittings = () => doc.byCategory<FittingParams>(Cat.PipeFitting).map((f) => f.params.kind);
  return { doc, ids, pipe, fittings };
}

describe("pipes", () => {
  it("pick the type for the system and get elbows, tees and reducers like ducts", () => {
    const { doc, pipe, fittings } = setup();
    expect(doc.require(pipeTypeFor(doc, "sanitary")!).name).toBe("uPVC - Sanitary");
    pipe(p(0, 0), p(2000, 0));
    pipe(p(2000, 0), p(2000, 1000));
    expect(fittings()).toEqual(["elbow"]);
    pipe(p(1000, 0), p(1000, -800));
    expect(pipes(doc)).toHaveLength(4);
    expect(fittings().sort()).toEqual(["elbow", "tee"]);
    pipe(p(2000, 1000), p(2000, 2000), "coldWater", 15);
    expect(fittings().sort()).toEqual(["elbow", "tee", "transition"]);
  });

  it("don't join ducts: each kind keeps its own fittings", () => {
    const { doc, ids, pipe, fittings } = setup();
    const [round] = doc.transact("Duct types", (tx) => ensureDuctTypes(tx, doc));
    pipe(p(0, 0), p(2000, 0));
    doc.transact("Duct", (tx) => createDuct(tx, doc, round!, ids.levels.ground, p(2000, 0), p(2000, 2000)));
    expect(fittings()).toEqual([]);
    expect(doc.byCategory(Cat.DuctFitting)).toHaveLength(0);
  });

  it("expose pipe connectors and check drainage falls", () => {
    const { doc, pipe } = setup();
    const flat = pipe(p(0, 0, 0), p(3000, 0, -30), "sanitary");
    const ok = pipe(p(0, 2000, 0), p(3000, 2000, -50), "sanitary");
    pipe(p(0, 4000, 0), p(0, 4000, -2000), "sanitary"); // vertical stack
    const [c] = elementConnectors(doc, ok);
    expect(c!.domain).toBe("pipe");
    expect(pipeFall(ok as Pipe)).toBeCloseTo(1 / 60);
    expect(fallLabel(pipeFall(flat as Pipe))).toBe("1:100");
    expect(minimumFall(100)).toBeCloseTo(1 / 60);
    const issues = pipeFallChecks(doc);
    expect(issues.map((i) => i.pipeId)).toEqual([flat.id]);
    expect(issues[0]!.message).toMatch(/needs at least 1:60/);
  });
});
