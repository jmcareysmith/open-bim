import { describe, expect, it } from "vitest";
import { Document, applyResidentialTemplate, createCeiling, createFloor, createShaft, type Vec2 } from "@open-bim/core";
import { SimpleKernel, meshVolume } from "../src/index.ts";

const p = (x: number, y: number): Vec2 => ({ x, y });

describe("shaft openings", () => {
  it("cut floors and ceilings in their height, not others", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const sq = (s: number) => [p(0, 0), p(s, 0), p(s, s), p(0, s)];
    const [ground, first, ceil] = doc.transact("Model", (tx) => [
      createFloor(tx, ids.floorTypes.slab, ids.levels.ground, sq(6000)),
      createFloor(tx, ids.floorTypes.timber, ids.levels.first, sq(6000)),
      createCeiling(tx, ids.ceilingTypes.plasterboard, ids.levels.ground, sq(6000)),
    ]);
    const k = new SimpleKernel();
    const vol = (id: string) => meshVolume(k.build(doc, doc.require(id))!);
    const before = { ground: vol(ground!.id), first: vol(first!.id), ceil: vol(ceil!.id) };
    // A 2000 × 1000 shaft from the ground level up through the first floor.
    doc.transact("Shaft", (tx) => createShaft(tx, doc, ids.levels.ground, [p(1000, 1000), p(3000, 1000), p(3000, 2000), p(1000, 2000)]));
    expect(vol(first!.id) / before.first).toBeCloseTo(1 - 2e6 / 36e6, 6);
    expect(vol(ceil!.id) / before.ceil).toBeCloseTo(1 - 2e6 / 36e6, 6);
    // The ground slab sits below the shaft's base: untouched.
    expect(vol(ground!.id)).toBeCloseTo(before.ground, -3);
    // A shaft spilling past the slab's edge still cuts cleanly.
    doc.transact("Edge shaft", (tx) => createShaft(tx, doc, ids.levels.ground, [p(5000, 5000), p(7000, 5000), p(7000, 7000), p(5000, 7000)]));
    expect(vol(first!.id) / before.first).toBeCloseTo(1 - 3e6 / 36e6, 6);
    expect(k.buildLines(doc, doc.byCategory("Shaft")[0]!, 100)!.segments.length).toBe(6 * 6);
  });
});
