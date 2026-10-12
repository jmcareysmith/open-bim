import { describe, expect, it } from "vitest";
import { Document, applyResidentialTemplate, createWall, curtainOf, floorPlanFor } from "@open-bim/core";
import { SimpleKernel, boundingBox, curtainGridLines, meshVolume, viewDrawing } from "../src/index.ts";

describe("curtain walls", () => {
  it("divide equally within the spacing, with glass panels and mullions", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const w = doc.transact("CW", (tx) =>
      createWall(tx, ids.wallTypes.curtain, { x: 0, y: 0 }, { x: 5000, y: 0 }, ids.levels.ground, { topLevelId: ids.levels.first }),
    );
    const grid = curtainOf(doc, w)!;
    const lines = curtainGridLines(5000, 0, 2700, grid);
    expect(lines.u).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
    expect(lines.z).toEqual([0, 1350, 2700]);
    const m = new SimpleKernel().build(doc, w)!;
    // 5 x 2 panels, 6 vertical mullions, 3 rows of 5 horizontal mullions; 24 vertices per box.
    expect(m.positions.length / 3 / 24).toBe(10 + 6 + 15);
    expect(m.colors).toBeDefined();
    expect(meshVolume(m)).toBeGreaterThan(0);
    const bb = boundingBox(m);
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(100);
    expect(bb.max[2]).toBeCloseTo(2700);
    // Shows in plan as cut mullions and glass.
    const d = viewDrawing(doc, new SimpleKernel(), floorPlanFor(doc, ids.levels.ground)!);
    expect(d.strokes.some((s) => s.id === w.id)).toBe(true);
  });
});
