import { describe, expect, it } from "vitest";
import { Document, createDimension, createGrid, createSection, dimensionLayout, floorPlanFor, levels, applyResidentialTemplate, setGridCurve, type View } from "@open-bim/core";
import { sectionAnnotations } from "../src/index.ts";

describe("curved grids in sections and dimensions", () => {
  it("a section crossing an arc grid twice shows it twice; concentric arc grids dimension radially", () => {
    const doc = new Document();
    applyResidentialTemplate(doc);
    for (const g of doc.byCategory("Grid")) doc.transact("Del", (tx) => tx.delete(g.id));
    // Two arcs about (0, 0): radius 5000 and 7000, from (−R, 0) round through (0, R) to (R, 0).
    const [g1, g2] = doc.transact("G", (tx) => [createGrid(tx, doc, { x: -5000, y: 0 }, { x: 5000, y: 0 }, "R1"), createGrid(tx, doc, { x: -7000, y: 0 }, { x: 7000, y: 0 }, "R2")]);
    doc.transact("C", (tx) => {
      setGridCurve(tx, doc, g1!.id, 5000);
      setGridCurve(tx, doc, g2!.id, 7000);
    });
    // A section across at y = 3000, looking north.
    const s = doc.transact("S", (tx) => createSection(tx, doc, { x: -9000, y: 3000 }, { x: 9000, y: 3000 }));
    const ann = sectionAnnotations(doc, doc.require(s.id) as View);
    expect(ann.labels.filter((l) => l.text === "R1")).toHaveLength(2);
    expect(ann.labels.filter((l) => l.text === "R2")).toHaveLength(2);
    // R1 meets y = 3000 at x = ±4000: 5000 in from the section's start (at x = −9000).
    expect(ann.labels.filter((l) => l.text === "R1").map((l) => Math.round(l.position[0])).sort((a, b) => a - b)).toEqual([5000, 13000]);
    // Plan dimension between the arcs, picked on their tops: 2000.
    const plan = floorPlanFor(doc, levels(doc)[0]!.id)!;
    const d = doc.transact("D", (tx) =>
      createDimension(tx, doc, plan.id, [{ kind: "datum", id: g1!.id, pick: { x: 0, y: 5000 } }, { kind: "datum", id: g2!.id, pick: { x: 0, y: 7000 } }], { x: 500, y: 6000 }),
    );
    expect(dimensionLayout(doc, d).values[0]).toBeCloseTo(2000, 3);
    // In the section: between R1 and R2 on the east side (x = 4000 and √(7000² − 3000²)).
    const ds = doc.transact("D", (tx) =>
      createDimension(tx, doc, s.id, [{ kind: "datum", id: g1!.id, pick: { x: 13000, y: 0 } }, { kind: "datum", id: g2!.id, pick: { x: 15000, y: 0 } }], { x: 14000, y: 3000 }),
    );
    expect(dimensionLayout(doc, ds).values[0]).toBeCloseTo(Math.sqrt(7000 ** 2 - 3000 ** 2) - 4000, 3);
  });
});
