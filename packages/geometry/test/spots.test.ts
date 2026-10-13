import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createFloor,
  createRoof,
  createSection,
  createSpotElevation,
  floorPlanFor,
  formatSpotElevation,
  spotElevationValue,
  type FloorParams,
  type SpotElevation,
  type Vec2,
} from "@open-bim/core";
import { SimpleKernel } from "../src/index.ts";

const p = (x: number, y: number): Vec2 => ({ x, y });
const deg = (d: number) => (d * Math.PI) / 180;

describe("spot elevations", () => {
  it("read a floor's top live in plan, a roof's top, and a section point's height", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const plan = floorPlanFor(doc, ids.levels.first)!;
    const f = doc.transact("F", (tx) => createFloor(tx, ids.floorTypes.timber, ids.levels.first, [p(0, 0), p(4000, 0), p(4000, 4000), p(0, 4000)]));
    const s = doc.transact("S", (tx) => createSpotElevation(tx, doc, plan.id, p(2000, 2000), p(3000, 3000), { hostId: f.id }));
    expect(spotElevationValue(doc, s)).toBeCloseTo(2700);
    doc.transact("Raise", (tx) => tx.update<FloorParams>(f.id, { offset: 150 }));
    expect(spotElevationValue(doc, doc.require(s.id) as SpotElevation)).toBeCloseTo(2850);
    // A hip roof's top at its ridge.
    const r = doc.transact("R", (tx) => createRoof(tx, ids.roofTypes.steel, ids.levels.roof, [p(0, 0), p(10000, 0), p(10000, 6000), p(0, 6000)], { slopes: Array(4).fill(deg(30)) }));
    const roofPlan = floorPlanFor(doc, ids.levels.roof)!;
    const sr = doc.transact("SR", (tx) => createSpotElevation(tx, doc, roofPlan.id, p(5000, 3000), p(6000, 4000), { hostId: r.id }));
    expect(spotElevationValue(doc, sr)).toBeCloseTo(5400 + 3000 * Math.tan(deg(30)) + 211, 1);
    // In a section with no host: the point's own height.
    const sec = doc.transact("Sec", (tx) => createSection(tx, doc, p(-1000, 2000), p(6000, 2000)));
    const ss = doc.transact("SS", (tx) => createSpotElevation(tx, doc, sec.id, p(1000, 1234), p(2000, 2000)));
    expect(spotElevationValue(doc, ss)).toBe(1234);
    expect(formatSpotElevation(2700)).toBe("+2.700");
    expect(formatSpotElevation(-450)).toBe("−0.450");
    // Drawn with its text.
    const lines = new SimpleKernel().buildLines(doc, doc.require(s.id), 100)!;
    expect(lines.labels[0]!.text).toBe("+2.850");
    expect(() => doc.transact("Bad", (tx) => createSpotElevation(tx, doc, plan.id, p(0, 0), p(1, 1), { hostId: ids.levels.ground }))).toThrow(/floors, roofs/);
  });
});
