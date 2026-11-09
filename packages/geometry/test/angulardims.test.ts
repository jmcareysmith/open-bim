import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createAngularDimension,
  createGrid,
  createRadialDimension,
  createSection,
  createWall,
  floorPlanFor,
  setWallCurve,
  type AngularDimension,
  type GridParams,
  type Vec2,
} from "@open-bim/core";
import { SimpleKernel } from "../src/index.ts";

const p = (x: number, y: number): Vec2 => ({ x, y });

describe("angular and radial dimensions", () => {
  it("measure the angle between grids, live, and an arc's radius", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const plan = floorPlanFor(doc, ids.levels.ground)!;
    const a = doc.transact("A", (tx) => createGrid(tx, doc, p(0, 0), p(10000, 0), "A"));
    const b = doc.transact("B", (tx) => createGrid(tx, doc, p(0, 0), p(5000, 5000), "B"));
    const d = doc.transact("Ang", (tx) =>
      createAngularDimension(tx, doc, plan.id, { kind: "datum", id: a.id, pick: p(5000, 0) }, { kind: "datum", id: b.id, pick: p(3000, 3000) }, p(3000, 1000)),
    );
    const k = new SimpleKernel();
    expect(k.buildLines(doc, d, 100)!.labels[0]!.text).toBe("45.00°");
    // Turn grid B to 60°: the dimension follows.
    doc.transact("Turn", (tx) => tx.update<GridParams>(b.id, { end: { x: 5000 * Math.cos(Math.PI / 3), y: 5000 * Math.sin(Math.PI / 3) } }));
    expect(k.buildLines(doc, doc.require(d.id) as AngularDimension, 100)!.labels[0]!.text).toBe("60.00°");
    // Parallel lines have no angle.
    const c = doc.transact("C", (tx) => createGrid(tx, doc, p(0, 2000), p(10000, 2000), "C"));
    expect(() => doc.transact("Bad", (tx) => createAngularDimension(tx, doc, plan.id, { kind: "datum", id: a.id, pick: p(0, 0) }, { kind: "datum", id: c.id, pick: p(0, 2000) }, p(1, 1)))).toThrow(/parallel/);
    // Radial: a semicircular wall of radius 2000.
    const w = doc.transact("W", (tx) => createWall(tx, ids.wallTypes.interior, p(20000, 0), p(24000, 0), ids.levels.ground, { height: 2400 }));
    doc.transact("Curve", (tx) => setWallCurve(tx, doc, w.id, 2000));
    const r = doc.transact("R", (tx) => createRadialDimension(tx, doc, plan.id, w.id, p(22000, 1000)));
    expect(k.buildLines(doc, r, 100)!.labels[0]!.text).toBe("R 2000");
    expect(() => doc.transact("Straight", (tx) => createRadialDimension(tx, doc, plan.id, a.id, p(0, 0)))).toThrow(/arcs/);
    const s = doc.transact("S", (tx) => createSection(tx, doc, p(0, -1000), p(1000, -1000)));
    expect(() => doc.transact("Sec", (tx) => createRadialDimension(tx, doc, s.id, w.id, p(0, 0)))).toThrow(/plans/);
  });
  it("measure angles in sections between a drawn edge and a level", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const s = doc.transact("S", (tx) => createSection(tx, doc, p(0, -1000), p(10000, -1000)));
    // A 30° roof slope drawn from (2000, 2700) and the First Floor level (2700).
    const slope = { kind: "line" as const, at: p(2000, 2700), dir: { x: Math.cos(Math.PI / 6), y: Math.sin(Math.PI / 6) } };
    const d = doc.transact("Ang", (tx) => createAngularDimension(tx, doc, s.id, { kind: "level", id: ids.levels.first, pick: p(3000, 2700) }, slope, p(3500, 3000)));
    expect(new SimpleKernel().buildLines(doc, d, 100)!.labels[0]!.text).toBe("30.00°");
  });
});
