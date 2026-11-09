import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  analyticalModel,
  createBeam,
  createBrace,
  createColumn,
  createPadFooting,
  ensureStructuralTypes,
  type Vec2,
} from "../src/index.ts";

const p = (x: number, y: number): Vec2 => ({ x, y });

describe("analytical model", () => {
  it("connects beams to column axes, braces to the frame, and supports column bases", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const types = doc.transact("T", (tx) => ensureStructuralTypes(tx, doc));
    const byName = (n: string) => types.find((id) => doc.require(id).name === n)!;
    const shs = byName("Steel SHS 100x100x4");
    const ub = byName("Steel 200UB25");
    doc.transact("Frame", (tx) => {
      createColumn(tx, doc, shs, ids.levels.ground, ids.levels.first, p(0, 0));
      createColumn(tx, doc, shs, ids.levels.ground, ids.levels.first, p(6000, 0));
      createPadFooting(tx, doc, ids.levels.ground, p(0, 0));
      // Beam ends stop 50 short of the column centres (at their faces): they still meet the axes.
      createBeam(tx, doc, ub, ids.levels.first, p(50, 0), p(5950, 0));
      createBrace(tx, doc, shs, ids.levels.ground, p(0, 0), p(6000, 0));
    });
    const m = analyticalModel(doc);
    const beam = m.members.find((x) => x.kind === "beam")!;
    const cols = m.members.filter((x) => x.kind === "column");
    expect(cols).toHaveLength(2);
    // The beam's ends are the column tops.
    expect(new Set([beam.a, beam.b])).toEqual(new Set(cols.map((c) => c.b)));
    expect(m.nodes[beam.a]!.p.slice(0, 2)).toEqual([0, 0]);
    // The brace runs from the first column's base to the second column's top.
    const brace = m.members.find((x) => x.kind === "brace")!;
    expect(brace.a).toBe(cols[0]!.a);
    expect(brace.b).toBe(cols[1]!.b);
    // Both bases are supports (one on a pad, both at the lowest level).
    expect(cols.every((c) => m.nodes[c.a]!.support)).toBe(true);
    expect(m.nodes.filter((n) => n.support)).toHaveLength(2);
  });
});
