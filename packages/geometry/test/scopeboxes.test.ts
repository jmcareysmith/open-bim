import { describe, expect, it } from "vitest";
import { Document, applyResidentialTemplate, createScopeBox, floorPlanFor, planCrop, scopeBoxViews, transformElements, translation, type ViewParams } from "@open-bim/core";
import { SimpleKernel, viewDrawing } from "../src/index.ts";

describe("scope boxes", () => {
  it("crop the plans set to them, and move with the box", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const plan = floorPlanFor(doc, ids.levels.ground)!;
    const box = doc.transact("Box", (tx) => createScopeBox(tx, doc, { x: 4000, y: 3000 }, { x: -2000, y: -1000 }));
    expect(box.name).toBe("Scope Box 1");
    expect(box.params.min).toEqual({ x: -2000, y: -1000 });
    expect(planCrop(doc, plan)).toBeNull();
    doc.transact("Use", (tx) => tx.update<ViewParams>(plan.id, { scopeBoxId: box.id }));
    const v = floorPlanFor(doc, ids.levels.ground)!;
    expect(planCrop(doc, v)).toEqual({ min: { x: -2000, y: -1000 }, max: { x: 4000, y: 3000 } });
    expect(scopeBoxViews(doc, box.id).map((x) => x.id)).toEqual([plan.id]);
    // The drawing's bounds are the box.
    expect(viewDrawing(doc, new SimpleKernel(), v).bounds).toEqual({ min: { x: -2000, y: -1000 }, max: { x: 4000, y: 3000 } });
    doc.transact("Move", (tx) => transformElements(tx, doc, [box.id], translation({ x: 1000, y: 0 })));
    expect(planCrop(doc, floorPlanFor(doc, ids.levels.ground)!)!.min.x).toBe(-1000);
    expect(() => doc.transact("Tiny", (tx) => createScopeBox(tx, doc, { x: 0, y: 0 }, { x: 50, y: 50 }))).toThrow();
  });
});
