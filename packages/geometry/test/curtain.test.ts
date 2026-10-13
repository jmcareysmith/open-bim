import { describe, expect, it } from "vitest";
import { Document, applyResidentialTemplate, createWall, curtainOf, floorPlanFor, setCurtainEdits, type LayeredTypeParams, type Wall } from "@open-bim/core";
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
    // 5 x 2 panels, 6 vertical mullions in 2 rows, 3 rows of 5 horizontal mullions; 24 vertices per box.
    expect(m.positions.length / 3 / 24).toBe(10 + 12 + 15);
    expect(m.colors).toBeDefined();
    expect(m.glass).toEqual({ start: 0, count: 10 * 36 });
    expect(meshVolume(m)).toBeGreaterThan(0);
    const bb = boundingBox(m);
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(100);
    expect(bb.max[2]).toBeCloseTo(2700);
    // Shows in plan as cut mullions and glass.
    const d = viewDrawing(doc, new SimpleKernel(), floorPlanFor(doc, ids.levels.ground)!);
    expect(d.strokes.some((s) => s.id === w.id)).toBe(true);
  });

  it("own grid lines, removed mullion segments and panel swaps", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const w = doc.transact("CW", (tx) =>
      createWall(tx, ids.wallTypes.curtain, { x: 0, y: 0 }, { x: 5000, y: 0 }, ids.levels.ground, { topLevelId: ids.levels.first }),
    );
    doc.transact("Edit", (tx) =>
      setCurtainEdits(tx, doc, w.id, { uLines: [3000, 1500], zLines: [900], panels: { "0,0": "door", "2,1": "solid", "1,1": "empty" }, removed: ["v:1:1"] }),
    );
    const cw = doc.require(w.id) as Wall;
    const grid = curtainOf(doc, cw)!;
    expect(curtainGridLines(5000, 0, 2700, grid, cw.params.curtainEdits)).toEqual({ u: [0, 1500, 3000, 5000], z: [0, 900, 2700] });
    const m = new SimpleKernel().build(doc, cw)!;
    // Glass: 6 cells less the solid and empty ones, less the door cell, plus the door's leaf.
    expect(m.glass!.count).toBe(4 * 36);
    expect(meshVolume(m)).toBeGreaterThan(0);
    expect(() => doc.transact("Bad", (tx) => setCurtainEdits(tx, doc, w.id, { uLines: [6000] }))).toThrow(/inside the wall/);
    // Round mullions and no border mullions build too.
    doc.transact("Type", (tx) => tx.update<LayeredTypeParams>(ids.wallTypes.curtain, { curtain: { ...grid, mullionShape: "circular", borderMullions: false } }));
    expect(meshVolume(new SimpleKernel().build(doc, doc.require(w.id))!)).toBeGreaterThan(0);
  });
});
