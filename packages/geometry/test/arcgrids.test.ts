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

describe("levels and scope boxes", () => {
  it("a boxed level shows only across the box in sections through it, and not in others", async () => {
    const { createScopeBox } = await import("@open-bim/core");
    const doc = new Document();
    applyResidentialTemplate(doc);
    const lv = levels(doc)[1]!;
    const box = doc.transact("B", (tx) => createScopeBox(tx, doc, { x: 2000, y: -5000 }, { x: 6000, y: 5000 }));
    doc.transact("L", (tx) => tx.update(lv.id, { scopeBoxId: box.id }));
    const through = doc.transact("S", (tx) => createSection(tx, doc, { x: 0, y: 0 }, { x: 10000, y: 0 }));
    const missing = doc.transact("S", (tx) => createSection(tx, doc, { x: 0, y: 8000 }, { x: 10000, y: 8000 }));
    const levelSegs = (v: View) => {
      const a = sectionAnnotations(doc, doc.require(v.id) as View);
      const y = lv.params.elevation;
      const out: [number, number][] = [];
      for (let i = 0; i < a.segments.length; i += 6) if (Math.abs(a.segments[i + 1]! - y) < 1e-6 && Math.abs(a.segments[i + 4]! - y) < 1e-6) out.push([a.segments[i]!, a.segments[i + 3]!]);
      return out;
    };
    const s1 = levelSegs(through);
    expect(s1).toHaveLength(1);
    expect(s1[0]![0]).toBeCloseTo(2000);
    expect(s1[0]![1]).toBeCloseTo(6000);
    expect(levelSegs(missing)).toHaveLength(0);
  });
});
