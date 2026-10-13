import { describe, expect, it } from "vitest";
import { Cat, Document, applyResidentialTemplate, createDuct, enableDuctFittings, ensureDuctTypes, floorPlanFor, type P3 } from "@open-bim/core";
import { SimpleKernel, boundingBox, meshVolume, viewDrawing } from "../src/index.ts";

const p = (x: number, y: number, z = 2700): P3 => ({ x, y, z });

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  enableDuctFittings(doc);
  const [round, rect] = doc.transact("Types", (tx) => ensureDuctTypes(tx, doc));
  return { doc, ids, round: round!, rect: rect! };
}

describe("duct solids", () => {
  it("build a tube the duct's size, taken back for a fitting", () => {
    const { doc, ids, round } = setup();
    const k = new SimpleKernel();
    const a = doc.transact("D", (tx) => createDuct(tx, doc, round, ids.levels.ground, p(0, 0), p(3000, 0), { diameter: 200 }));
    // 24-sided section: area = (24 / 2) r² sin(360° / 24) ≈ 0.989 π r².
    const section = 12 * 100 * 100 * Math.sin(Math.PI / 12);
    expect(meshVolume(k.build(doc, doc.require(a.id))!)).toBeCloseTo(section * 3000, -3);
    doc.transact("D", (tx) => createDuct(tx, doc, round, ids.levels.ground, p(3000, 0), p(3000, 2000), { diameter: 200 }));
    // The elbow takes 200 (one diameter) off this end.
    expect(boundingBox(k.build(doc, doc.require(a.id))!).max[0]).toBeCloseTo(2800);
    const elbow = doc.byCategory(Cat.DuctFitting)[0]!;
    const bb = boundingBox(k.build(doc, elbow)!);
    expect(bb.min[0]).toBeCloseTo(2800, -1);
    expect(bb.max[1]).toBeCloseTo(200, -1);
    expect(bb.max[2]).toBeCloseTo(2800, 0);
  });

  it("rectangular ducts keep their width level and height up, and draw in plan", () => {
    const { doc, ids, rect } = setup();
    const d = doc.transact("D", (tx) => createDuct(tx, doc, rect, ids.levels.ground, p(0, 0, 1000), p(2000, 0, 1000), { width: 400, height: 250 }));
    const bb = boundingBox(new SimpleKernel().build(doc, doc.require(d.id))!);
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(400);
    expect(bb.max[2] - bb.min[2]).toBeCloseTo(250);
    // Below the ground floor plan's cut plane, so it shows in projection.
    const draw = viewDrawing(doc, new SimpleKernel(), floorPlanFor(doc, ids.levels.ground)!);
    expect(draw.strokes.some((s) => s.id === d.id)).toBe(true);
  });

  it("draw single-line at Coarse, with no fittings", () => {
    const { doc, ids, round } = setup();
    const k = new SimpleKernel();
    const a = doc.transact("D", (tx) => createDuct(tx, doc, round, ids.levels.ground, p(0, 0), p(3000, 0)));
    doc.transact("D", (tx) => createDuct(tx, doc, round, ids.levels.ground, p(3000, 0), p(3000, 2000)));
    expect(k.buildLines(doc, doc.require(a.id), 100, "coarse")!.segments.length).toBe(6);
    expect(k.buildLines(doc, doc.byCategory(Cat.DuctFitting)[0]!, 100, "coarse")).toBeNull();
    expect(k.buildLines(doc, doc.require(a.id), 100, "medium")!.segments.length).toBeGreaterThan(6);
  });
});
