import { describe, expect, it } from "vitest";
import { Cat, Document, applyResidentialTemplate, createDirectShape, effectiveGraphics, elementGraphics, floorPlanFor, graphicsCategory, styleCategory, type ViewParams } from "../src/index.ts";

describe("imported IFC shapes", () => {
  it("show and style as the category their IFC class means", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const shape = (ifcClass: string) =>
      doc.transact("S", (tx) => createDirectShape(tx, { levelId: ids.levels.ground, ifcClass, globalId: ifcClass, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2], color: 0xcccccc, properties: {} }));
    const wall = shape("IfcWall");
    const odd = shape("IfcFlowTerminal");
    expect(graphicsCategory(doc, wall)).toBe(Cat.Wall);
    expect(styleCategory(doc, wall)).toBe(Cat.Wall);
    expect(graphicsCategory(doc, odd)).toBe(Cat.DirectShape);
    // Hiding Walls in a plan hides the imported wall too.
    const plan = floorPlanFor(doc, ids.levels.ground)!;
    doc.transact("Hide", (tx) => tx.update<ViewParams>(plan.id, { hiddenCategories: [Cat.Wall] }));
    const g = effectiveGraphics(doc, doc.require(plan.id) as never);
    expect(elementGraphics(doc, g, wall).visible).toBe(false);
    expect(elementGraphics(doc, g, odd).visible).toBe(true);
  });
});
