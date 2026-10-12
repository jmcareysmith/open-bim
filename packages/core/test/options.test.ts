import { describe, expect, it } from "vitest";
import {
  Document,
  acceptPrimary,
  addOption,
  applyResidentialTemplate,
  createOptionSet,
  createWall,
  effectiveGraphics,
  elementGraphics,
  floorPlanFor,
  makePrimary,
  optionSets,
  setDesignOption,
  type View,
  type ViewParams,
} from "../src/index.ts";

describe("design options", () => {
  it("views show the primary unless they pick another; accepting folds it into the model", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const wall = (y: number) =>
      doc.transact("W", (tx) => createWall(tx, ids.wallTypes.interior, { x: 0, y }, { x: 3000, y }, ids.levels.ground, { topLevelId: ids.levels.first }));
    const main = wall(0);
    const a = wall(1000);
    const b = wall(2000);
    const set = doc.transact("Set", (tx) => createOptionSet(tx, doc, "Kitchen layout"));
    const [o1, o2] = set.options;
    doc.transact("Assign", (tx) => {
      setDesignOption(tx, doc, [a.id], o1!.id);
      setDesignOption(tx, doc, [b.id], o2!.id);
    });
    const plan = floorPlanFor(doc, ids.levels.ground)!;
    const shown = () => {
      const g = effectiveGraphics(doc, doc.require(plan.id) as View);
      return [main, a, b].map((w) => elementGraphics(doc, g, doc.require(w.id)).visible);
    };
    expect(shown()).toEqual([true, true, false]);
    doc.transact("View", (tx) => tx.update<ViewParams>(plan.id, { designOptions: { [set.id]: o2!.id } }));
    expect(shown()).toEqual([true, false, true]);
    doc.transact("View", (tx) => tx.update<ViewParams>(plan.id, { designOptions: null }));
    doc.transact("Primary", (tx) => makePrimary(tx, doc, o2!.id));
    expect(shown()).toEqual([true, false, true]);
    const o3 = doc.transact("Add", (tx) => addOption(tx, doc, set.id));
    expect(optionSets(doc)[0]!.options.map((o) => o.id)).toContain(o3.id);
    doc.transact("Accept", (tx) => acceptPrimary(tx, doc, set.id));
    expect(doc.has(a.id)).toBe(false);
    expect(doc.require(b.id).params.designOption).toBeUndefined();
    expect(optionSets(doc)).toHaveLength(0);
    const g = effectiveGraphics(doc, doc.require(plan.id) as View);
    expect(elementGraphics(doc, g, doc.require(b.id)).visible).toBe(true);
  });
});
