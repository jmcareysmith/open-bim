import { describe, expect, it } from "vitest";
import { Document, applyResidentialTemplate, createStair, ensureStairType, stairLayout, type StairTypeParams, type StairParams } from "@open-bim/core";
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

  it("winders fill a square turn instead of a landing, a riser each", () => {
    const { doc, ids, typeId } = setup();
    const s = doc.transact("Stair", (tx) =>
      createStair(tx, doc, typeId, ids.levels.ground, ids.levels.first, [
        { start: { x: 0, y: 0 }, end: { x: 1960, y: 0 } },
        { start: { x: 2410, y: 450 }, end: { x: 2410, y: 3000 } },
      ]),
    );
    doc.transact("Winders", (tx) => tx.update<StairParams>(s.id, { winders: 3 }));
    const L = stairLayout(doc, doc.require(s.id) as never);
    expect(L.landings).toEqual([]);
    expect(L.winders.map((w) => w.z)).toEqual([8 * 180, 9 * 180, 10 * 180].map((z) => expect.closeTo(z, 6)));
    // Same 15 risers: 8 up to the first winder, two more over the winders, 5 in the second run.
    expect(L.runs.map((r) => r.risers)).toEqual([8, 5]);
    expect(L.runs[1]!.z0).toBeCloseTo(10 * 180);
    const area = (b: { x: number; y: number }[]) => Math.abs(b.reduce((s2, q, i) => s2 + q.x * b[(i + 1) % b.length]!.y - b[(i + 1) % b.length]!.x * q.y, 0)) / 2;
    expect(L.winders.reduce((s2, w) => s2 + area(w.boundary), 0)).toBeCloseTo(900 * 900, 0);
    // They fan from the inner corner (1960, 450).
    for (const w of L.winders) expect(w.boundary[0]).toEqual({ x: 1960, y: 450 });
    expect(L.checks.some((c) => c.label.startsWith("Winder going"))).toBe(true);
    expect(boundingBox(new SimpleKernel().build(doc, doc.require(s.id))!).max[2]).toBeCloseTo(2700);
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
