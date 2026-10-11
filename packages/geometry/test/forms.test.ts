import { beforeAll, describe, expect, it } from "vitest";
import {
  Document,
  applyFamilyTemplate,
  createBlend,
  createExtrusion,
  createRevolution,
  createSweep,
  familyValues,
  setFamilyValue,
  type NumPt,
} from "@open-bim/core";
import { OcctKernel, SimpleKernel, boundingBox, meshVolume } from "../src/index.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): NumPt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

function family() {
  const doc = new Document();
  applyFamilyTemplate(doc, "Furniture");
  return { doc, k: new SimpleKernel() };
}

describe("family forms", () => {
  it("extrusions follow formulas and type values", () => {
    const { doc, k } = family();
    const e = doc.transact("E", (tx) =>
      createExtrusion(tx, [{ x: "-Width/2", y: 0 }, { x: "Width/2", y: 0 }, { x: "Width/2", y: "Depth" }, { x: "-Width/2", y: "Depth" }], { start: "Height - 30", end: "Height" }),
    );
    expect(meshVolume(k.build(doc, e)!)).toBeCloseTo(1200 * 600 * 30, -2);
    expect(boundingBox(k.build(doc, e)!).max[2]).toBeCloseTo(750);
    doc.transact("V", (tx) => setFamilyValue(tx, doc, "Width", 1800));
    expect(meshVolume(k.build(doc, doc.require(e.id))!)).toBeCloseTo(1800 * 600 * 30, -2);
  });

  it("extrusions on the front plane go along +y and stay outward-facing", () => {
    const { doc, k } = family();
    const e = doc.transact("E", (tx) => createExtrusion(tx, rect(0, 0, 500, 300), { plane: { kind: "XZ", offset: 0 }, start: 0, end: 200 }));
    const m = k.build(doc, e)!;
    expect(meshVolume(m)).toBeCloseTo(500 * 300 * 200, -2);
    expect(boundingBox(m)).toEqual({ min: [0, 0, 0], max: [500, 200, 300] });
  });

  it("blends loft between profiles (a frustum)", () => {
    const { doc, k } = family();
    const b = doc.transact("B", (tx) => createBlend(tx, rect(-500, -500, 500, 500), rect(-250, -250, 250, 250), { end: 900 }));
    const a1 = 1000 * 1000;
    const a2 = 500 * 500;
    expect(meshVolume(k.build(doc, b)!)).toBeCloseTo((900 / 3) * (a1 + a2 + Math.sqrt(a1 * a2)), -3);
  });

  it("blends resample profiles with different point counts", () => {
    const { doc, k } = family();
    const tri: NumPt[] = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 0, y: 600 }];
    const b = doc.transact("B", (tx) => createBlend(tx, rect(0, 0, 600, 600), tri, { end: 500 }));
    expect(meshVolume(k.build(doc, b)!)).toBeGreaterThan(0);
  });

  it("revolutions make cylinders (polygonal) and partial turns get end caps", () => {
    const { doc, k } = family();
    const r = doc.transact("R", (tx) => createRevolution(tx, rect(0, 0, 300, 1000)));
    const n = 48;
    const polygonArea = (n / 2) * 300 * 300 * Math.sin((2 * Math.PI) / n);
    expect(meshVolume(k.build(doc, r)!)).toBeCloseTo(polygonArea * 1000, -3);
    const half = doc.transact("R", (tx) => createRevolution(tx, rect(100, 0, 300, 500), { endAngle: 180 }));
    const v = meshVolume(k.build(doc, half)!);
    expect(v).toBeGreaterThan(0.95 * (Math.PI / 2) * (300 ** 2 - 100 ** 2) * 500);
    expect(v).toBeLessThan((Math.PI / 2) * (300 ** 2 - 100 ** 2) * 500);
  });

  it("sweeps a profile along a mitred path (volume = area x path length)", () => {
    const { doc, k } = family();
    const profile = rect(-25, 0, 25, 50);
    const s = doc.transact("S", (tx) => createSweep(tx, [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 800 }], profile));
    expect(meshVolume(k.build(doc, s)!)).toBeCloseTo(50 * 50 * 1800, -2);
  });

  it("reports bad formulas and degenerate forms", () => {
    const { doc, k } = family();
    const e = doc.transact("E", (tx) => createExtrusion(tx, rect(0, 0, 100, 100), { end: "Nope * 2" }));
    expect(() => k.build(doc, e)).toThrow(/Extrusion end: Unknown name "Nope"/);
    const r = doc.transact("R", (tx) => createRevolution(tx, rect(-100, 0, 100, 100)));
    expect(() => k.build(doc, r)).toThrow(/crosses its axis/);
  });
});

describe("family voids (OCCT)", () => {
  let kernel: OcctKernel;
  beforeAll(async () => {
    kernel = await OcctKernel.create();
  }, 60_000);

  it("voids cut every solid in the family", () => {
    const doc = new Document();
    applyFamilyTemplate(doc, "GenericModel");
    const block = doc.transact("E", (tx) => createExtrusion(tx, rect(0, 0, 1000, 1000), { end: 500 }));
    doc.transact("V", (tx) => createExtrusion(tx, rect(250, 250, 750, 750), { start: -10, end: 510, isVoid: true }));
    const cut = kernel.build(doc, block)!;
    expect(meshVolume(cut)).toBeCloseTo((1000 * 1000 - 500 * 500) * 500, -4);
    const whole = kernel.familyMesh(doc, familyValues(doc))!;
    expect(meshVolume(whole)).toBeCloseTo((1000 * 1000 - 500 * 500) * 500, -4);
    // Without OCCT, voids are skipped.
    expect(meshVolume(new SimpleKernel().familyMesh(doc, familyValues(doc))!)).toBeCloseTo(1000 * 1000 * 500, -3);
  });
});
