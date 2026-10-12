import { describe, expect, it } from "vitest";
import { Document, applyResidentialTemplate, createStair, ensureStairType, stairLayout, type StairTypeParams } from "@open-bim/core";
import { SimpleKernel, boundingBox, buildStairLines, meshVolume } from "../src/index.ts";

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const typeId = doc.transact("Type", (tx) => ensureStairType(tx, doc));
  return { doc, ids, typeId };
}

describe("stairs", () => {
  it("lay out risers from the floor-to-floor height (NZBC D1/AS1 private stair)", () => {
    const { doc, ids, typeId } = setup();
    const s = doc.transact("Stair", (tx) => createStair(tx, doc, typeId, ids.levels.ground, ids.levels.first, [{ start: { x: 0, y: 0 }, end: { x: 4000, y: 0 } }]));
    const L = stairLayout(doc, s);
    expect(L.risers).toBe(15);
    expect(L.riser).toBeCloseTo(180);
    expect(L.runs[0]!.treads).toBe(14);
    expect(L.runs[0]!.length).toBe(14 * 280);
    expect(L.checks.every((c) => c.ok)).toBe(true);
    const mesh = new SimpleKernel().build(doc, s)!;
    expect(meshVolume(mesh)).toBeGreaterThan(0);
    const bb = boundingBox(mesh);
    expect(bb.max[2]).toBeCloseTo(2700);
    expect(bb.max[0]).toBeCloseTo(3920);
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(900);
  });

  it("splits risers between runs and puts a landing at the turn", () => {
    const { doc, ids, typeId } = setup();
    const s = doc.transact("Stair", (tx) =>
      createStair(tx, doc, typeId, ids.levels.ground, ids.levels.first, [
        { start: { x: 0, y: 0 }, end: { x: 1960, y: 0 } },
        { start: { x: 2410, y: 450 }, end: { x: 2410, y: 3000 } },
      ]),
    );
    const L = stairLayout(doc, s);
    expect(L.runs.map((r) => r.risers)).toEqual([8, 7]);
    expect(L.runs[1]!.z0).toBeCloseTo(8 * 180);
    expect(L.landings).toHaveLength(1);
    expect(L.landings[0]!.z).toBeCloseTo(8 * 180);
    const xs = L.landings[0]!.boundary.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(900);
    expect(meshVolume(new SimpleKernel().build(doc, s)!)).toBeGreaterThan(0);
    expect(buildStairLines(doc, s)!.labels[0]!.text).toBe("UP");
  });

  it("builds when a run has a single riser", () => {
    const { doc, ids, typeId } = setup();
    const s = doc.transact("Stair", (tx) =>
      createStair(tx, doc, typeId, ids.levels.ground, ids.levels.first, [
        { start: { x: 0, y: 0 }, end: { x: 5000, y: 0 } },
        { start: { x: 4400, y: 500 }, end: { x: 4400, y: 1500 } },
      ]),
    );
    expect(stairLayout(doc, s).runs.map((r) => r.risers)).toEqual([14, 1]);
    expect(meshVolume(new SimpleKernel().build(doc, s)!)).toBeGreaterThan(0);
  });

  it("flags steep stairs", () => {
    const { doc, ids, typeId } = setup();
    doc.transact("Steep", (tx) => tx.update<StairTypeParams>(typeId, { maxRiser: 220, going: 240 }));
    const s = doc.transact("Stair", (tx) => createStair(tx, doc, typeId, ids.levels.ground, ids.levels.first, [{ start: { x: 0, y: 0 }, end: { x: 3000, y: 0 } }]));
    const bad = stairLayout(doc, s).checks.filter((c) => !c.ok).map((c) => c.label);
    expect(bad.some((l) => l.startsWith("Riser"))).toBe(true);
    expect(bad.some((l) => l.startsWith("Going"))).toBe(true);
  });
});
