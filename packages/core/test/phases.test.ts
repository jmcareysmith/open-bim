import { describe, expect, it } from "vitest";
import {
  DEMOLISHED_COLOUR,
  Document,
  applyResidentialTemplate,
  createWall,
  demolish,
  effectiveGraphics,
  elementGraphics,
  floorPlanFor,
  phaseStatus,
  type View,
  type ViewParams,
} from "../src/index.ts";

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const w = (x: number) =>
    doc.transact("W", (tx) => createWall(tx, ids.wallTypes.exterior, { x, y: 0 }, { x: x + 3000, y: 0 }, ids.levels.ground, { topLevelId: ids.levels.first }));
  const existing = w(0);
  const demo = w(4000);
  const added = w(8000);
  doc.transact("Phases", (tx) => {
    tx.update(existing.id, { phaseCreated: "existing" });
    tx.update(demo.id, { phaseCreated: "existing" });
    demolish(tx, doc, demo.id, "new");
  });
  const plan = floorPlanFor(doc, ids.levels.ground)!;
  const g = (filter: ViewParams["phaseFilter"], phase?: string) => {
    doc.transact("View", (tx) => tx.update<ViewParams>(plan.id, { phaseFilter: filter, phase: phase ?? null }));
    const eg = effectiveGraphics(doc, doc.require(plan.id) as View);
    return [existing, demo, added].map((el) => elementGraphics(doc, eg, doc.require(el.id)));
  };
  return { doc, existing, demo, added, g };
}

describe("phasing", () => {
  it("statuses by phase", () => {
    const { doc, existing, demo, added } = setup();
    expect([existing, demo, added].map((e) => phaseStatus(doc, doc.require(e.id), "new"))).toEqual(["existing", "demolished", "new"]);
    expect([existing, demo, added].map((e) => phaseStatus(doc, doc.require(e.id), "existing"))).toEqual(["new", "new", "future"]);
  });

  it("phase filters hide and override by status", () => {
    const { g } = setup();
    const [ex, de, nw] = g("all");
    expect(ex).toMatchObject({ visible: true, halftone: true });
    expect(de).toMatchObject({ visible: true, color: DEMOLISHED_COLOUR });
    expect(nw).toMatchObject({ visible: true, halftone: false, color: null });
    expect(g("complete").map((x) => x.visible)).toEqual([true, false, true]);
    expect(g("new").map((x) => x.visible)).toEqual([false, false, true]);
    expect(g("previous").map((x) => x.visible)).toEqual([true, true, false]);
    // The existing phase's view doesn't show new construction.
    expect(g("all", "existing").map((x) => x.visible)).toEqual([true, true, false]);
  });

  it("can't demolish before an element exists", () => {
    const { doc, added } = setup();
    expect(() => doc.transact("D", (tx) => demolish(tx, doc, added.id, "existing"))).toThrow(/later phase/);
  });
});
