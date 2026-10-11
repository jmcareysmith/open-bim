import { describe, expect, it } from "vitest";
import {
  Cat,
  Document,
  applyResidentialTemplate,
  createViewFilter,
  createViewTemplate,
  createWall,
  effectiveGraphics,
  elementGraphics,
  floorPlanFor,
  ruleMatches,
  type ViewParams,
  type ViewTemplateParams,
} from "../src/index.ts";

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const plan = floorPlanFor(doc, ids.levels.ground)!;
  const ext = doc.transact("W", (tx) => createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 4000, y: 0 }, ids.levels.ground, { height: 2400 }));
  const int = doc.transact("W", (tx) => createWall(tx, ids.wallTypes.interior, { x: 0, y: 1000 }, { x: 4000, y: 1000 }, ids.levels.first, { height: 2400 }));
  return { doc, ids, plan, ext, int };
}

describe("filter rules", () => {
  it("match type names, level names, numbers and categories", () => {
    const { doc, ext, int } = setup();
    expect(ruleMatches(doc, ext, { field: "type", op: "contains", value: "exterior" })).toBe(true);
    expect(ruleMatches(doc, int, { field: "type", op: "contains", value: "exterior" })).toBe(false);
    expect(ruleMatches(doc, int, { field: "baseLevelId", op: "equals", value: "First Floor" })).toBe(true);
    expect(ruleMatches(doc, ext, { field: "height", op: "greater", value: "2000" })).toBe(true);
    expect(ruleMatches(doc, ext, { field: "height", op: "less", value: "2000" })).toBe(false);
    expect(ruleMatches(doc, ext, { field: "category", op: "equals", value: "Wall" })).toBe(true);
    expect(ruleMatches(doc, ext, { field: "nonsense", op: "notEquals", value: "x" })).toBe(true);
  });
});

describe("visibility/graphics", () => {
  it("category visibility and overrides, then filters by priority", () => {
    const { doc, plan, ext, int } = setup();
    const exterior = doc.transact("F", (tx) =>
      createViewFilter(tx, doc, "Exterior walls", { categories: [Cat.Wall], rules: [{ field: "type", op: "contains", value: "Exterior" }] }),
    );
    const allWalls = doc.transact("F", (tx) => createViewFilter(tx, doc, "All walls", { categories: [Cat.Wall] }));
    doc.transact("VG", (tx) =>
      tx.update<ViewParams>(plan.id, {
        categoryOverrides: { [Cat.Wall]: { halftone: true } },
        filters: [
          { filterId: exterior.id, override: { color: 0xff0000 } },
          { filterId: allWalls.id, override: { color: 0x00ff00, visible: true } },
        ],
      }),
    );
    const g = effectiveGraphics(doc, doc.require<ViewParams>(plan.id));
    expect(elementGraphics(doc, g, ext)).toEqual({ visible: true, halftone: true, color: 0xff0000 });
    expect(elementGraphics(doc, g, int)).toEqual({ visible: true, halftone: true, color: 0x00ff00 });

    doc.transact("Hide walls", (tx) => tx.update<ViewParams>(plan.id, { hiddenCategories: [Cat.Wall], filters: [] }));
    expect(elementGraphics(doc, effectiveGraphics(doc, doc.require<ViewParams>(plan.id)), ext).visible).toBe(false);
  });

  it("view templates control the graphics of every view using them", () => {
    const { doc, ids, plan, ext } = setup();
    const t = doc.transact("T", (tx) => createViewTemplate(tx, doc, "Plans - 1:50 Fine", doc.require<ViewParams>(plan.id)));
    doc.transact("Edit template", (tx) => tx.update<ViewTemplateParams>(t.id, { scale: 50, detailLevel: "fine", hiddenCategories: [Cat.Grid] }));
    const first = floorPlanFor(doc, ids.levels.first)!;
    for (const v of [plan, first]) doc.transact("Apply", (tx) => tx.update<ViewParams>(v.id, { templateId: t.id }));
    for (const v of [plan, first]) {
      const g = effectiveGraphics(doc, doc.require<ViewParams>(v.id));
      expect([g.scale, g.detailLevel, g.hiddenCategories]).toEqual([50, "fine", [Cat.Grid]]);
    }
    // Deleting the template leaves the views with their own settings.
    doc.transact("Delete template", (tx) => tx.delete(t.id));
    expect(doc.has(plan.id)).toBe(true);
    expect(effectiveGraphics(doc, doc.require<ViewParams>(plan.id)).scale).toBe(100);
    void ext;
  });

  it("filter and template names are unique", () => {
    const { doc, plan } = setup();
    doc.transact("F", (tx) => createViewFilter(tx, doc, "A"));
    expect(() => doc.transact("F", (tx) => createViewFilter(tx, doc, "A"))).toThrow(/already exists/);
    doc.transact("T", (tx) => createViewTemplate(tx, doc, "T1", doc.require<ViewParams>(plan.id)));
    expect(() => doc.transact("T", (tx) => createViewTemplate(tx, doc, "T1", doc.require<ViewParams>(plan.id)))).toThrow(/already exists/);
  });
});
