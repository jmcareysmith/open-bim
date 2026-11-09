import { describe, expect, it } from "vitest";
import { Document, applyResidentialTemplate, createDetailLine, createDraftingView, createWall, is2DView, isAnnotationView } from "@open-bim/core";
import { SimpleKernel, viewDrawing } from "../src/index.ts";

describe("drafting views", () => {
  it("hold their own drafting and none of the model", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    doc.transact("W", (tx) => createWall(tx, ids.wallTypes.interior, { x: 0, y: 0 }, { x: 4000, y: 0 }, ids.levels.ground, { height: 2400 }));
    const v = doc.transact("D", (tx) => createDraftingView(tx, doc));
    expect(v.name).toBe("Drafting 1");
    expect(v.params.scale).toBe(10);
    expect(isAnnotationView(v) && is2DView(v)).toBe(true);
    expect(doc.transact("D2", (tx) => createDraftingView(tx, doc)).name).toBe("Drafting 2");
    const line = doc.transact("L", (tx) => createDetailLine(tx, doc, v.id, { x: 0, y: 0 }, { x: 500, y: 0 }));
    const d = viewDrawing(doc, new SimpleKernel(), v);
    const ids2 = new Set(d.strokes.map((s) => s.id));
    expect(ids2.has(line.id)).toBe(true);
    expect(d.strokes.every((s) => s.id === line.id)).toBe(true);
    expect(d.fills).toHaveLength(0);
  });
});
