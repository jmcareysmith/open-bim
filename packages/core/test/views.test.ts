import { describe, expect, it } from "vitest";
import { Document, PLAN_CUT_HEIGHT, applyResidentialTemplate, planViewRange, type LevelParams } from "../src/index.ts";

describe("plan view range", () => {
  it("runs from the level to the cut plane and follows level changes", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    expect(planViewRange(doc, ids.levels.first)).toEqual({ bottom: 2700, cut: 2700 + PLAN_CUT_HEIGHT });
    doc.transact("Raise", (tx) => tx.update<LevelParams>(ids.levels.first, { elevation: 3000 }));
    expect(planViewRange(doc, ids.levels.first, 1500)).toEqual({ bottom: 3000, cut: 4500 });
  });

  it("throws for a missing level", () => {
    expect(() => planViewRange(new Document(), "nope")).toThrow(/not found/);
  });
});
