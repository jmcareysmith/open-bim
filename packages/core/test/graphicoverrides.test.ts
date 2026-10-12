import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createViewFilter,
  createViewTemplate,
  createWall,
  effectiveGraphics,
  elementGraphics,
  floorPlanFor,
  graphicsOwner,
  setCategoryOverride,
  setElementOverrides,
  type ViewParams,
} from "../src/index.ts";

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const plan = floorPlanFor(doc, ids.levels.ground)!;
  const [a, b] = doc.transact("W", (tx) => [
    createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 4000, y: 0 }, ids.levels.ground, { height: 2400 }),
    createWall(tx, ids.wallTypes.exterior, { x: 0, y: 3000 }, { x: 4000, y: 3000 }, ids.levels.ground, { height: 2400 }),
  ]);
  const g = () => effectiveGraphics(doc, doc.require<ViewParams>(plan.id));
  return { doc, plan, a: a!, b: b!, g };
}

describe("Override Graphics in View", () => {
  it("by element: transparency, lines and patterns; only that element; clear with null", () => {
    const { doc, plan, a, b, g } = setup();
    doc.transact("Override", (tx) =>
      setElementOverrides(tx, doc, plan.id, [a.id], {
        halftone: true,
        transparency: 60,
        projectionLines: { color: 0xff0000, weight: 5, pattern: "dash" },
        cutLines: { color: 0x0000ff, weight: 8 },
        cutPatterns: { foreground: { pattern: "solid", color: 0x333333 }, background: { visible: false } },
        surfacePatterns: { foreground: { color: 0x00aa00 } },
      }),
    );
    const r = elementGraphics(doc, g(), a);
    expect(r).toMatchObject({ halftone: true, transparency: 60, color: 0xff0000 });
    expect(r.projection).toEqual({ color: 0xff0000, weight: 5, pattern: "dash" });
    expect(r.cut).toEqual({ color: 0x0000ff, weight: 8, pattern: null });
    expect(r.cutFill.foreground).toEqual({ visible: true, color: 0x333333, pattern: "solid" });
    expect(r.cutFill.background.visible).toBe(false);
    expect(r.surface.foreground.color).toBe(0x00aa00);
    expect(elementGraphics(doc, g(), b)).toMatchObject({ halftone: false, transparency: 0, color: null });
    doc.transact("Clear", (tx) => setElementOverrides(tx, doc, plan.id, [a.id], null));
    expect(doc.require<ViewParams>(plan.id).params.elementOverrides).toBeNull();
  });

  it("element beats filter beats category, field by field", () => {
    const { doc, plan, a, g } = setup();
    doc.transact("Cat", (tx) => setCategoryOverride(tx, doc, plan.id, "Wall", { projectionLines: { color: 0x111111, weight: 3 }, transparency: 20 }));
    const f = doc.transact("F", (tx) => createViewFilter(tx, doc, "Walls", { categories: ["Wall"] }));
    doc.transact("Apply", (tx) => tx.update<ViewParams>(plan.id, { filters: [{ filterId: f.id, override: { projectionLines: { color: 0x222222 } } }] }));
    doc.transact("El", (tx) => setElementOverrides(tx, doc, plan.id, [a.id], { transparency: 50 }));
    const r = elementGraphics(doc, g(), a);
    expect(r.projection).toEqual({ color: 0x222222, weight: 3, pattern: null }); // colour from filter, weight from category
    expect(r.transparency).toBe(50); // element
    // Hiding the category by override also hides it in V/G; showing again restores it.
    doc.transact("Hide", (tx) => setCategoryOverride(tx, doc, plan.id, "Wall", { visible: false }));
    expect(elementGraphics(doc, g(), a).visible).toBe(false);
    doc.transact("Show", (tx) => setCategoryOverride(tx, doc, plan.id, "Wall", { visible: true }));
    expect(elementGraphics(doc, g(), a).visible).toBe(true);
  });

  it("category overrides go to the view template when the view has one", () => {
    const { doc, plan } = setup();
    const t = doc.transact("T", (tx) => createViewTemplate(tx, doc, "Plans", doc.require<ViewParams>(plan.id)));
    doc.transact("Use", (tx) => tx.update<ViewParams>(plan.id, { templateId: t.id }));
    expect(graphicsOwner(doc, plan.id)).toBe(t.id);
    doc.transact("Cat", (tx) => setCategoryOverride(tx, doc, plan.id, "Door", { halftone: true }));
    expect((doc.require(t.id).params as { categoryOverrides: Record<string, unknown> }).categoryOverrides.Door).toEqual({ halftone: true });
  });
});
