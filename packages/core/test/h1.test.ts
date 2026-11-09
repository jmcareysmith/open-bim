import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createDoor,
  createFloor,
  createWall,
  createWindow,
  h1Check,
  energyAnalysis,
  ZONE_CLIMATE,
  AIR_CHANGES,
  setH1Settings,
  type ThermalTypeParams,
} from "../src/index.ts";

function house() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const pts = [
    { x: 0, y: 0 },
    { x: 10000, y: 0 },
    { x: 10000, y: 8000 },
    { x: 0, y: 8000 },
  ];
  doc.transact("House", (tx) => {
    const walls = pts.map((p, i) => createWall(tx, ids.wallTypes.exterior, p, pts[(i + 1) % 4]!, ids.levels.ground, { topLevelId: ids.levels.first }));
    createWall(tx, ids.wallTypes.interior, { x: 5000, y: 0 }, { x: 5000, y: 8000 }, ids.levels.ground, { topLevelId: ids.levels.first });
    createWindow(tx, doc, ids.windowTypes.w1800x1200, walls[0]!.id, 3000);
    createWindow(tx, doc, ids.windowTypes.w1200x1200, walls[2]!.id, 3000);
    createDoor(tx, doc, ids.doorTypes.single860, walls[0]!.id, 7000);
    createFloor(tx, ids.floorTypes.slab, ids.levels.ground, pts);
  });
  return { doc, ids };
}

describe("H1 schedule method", () => {
  it("measures exterior walls and glazing, and flags unset R-values", () => {
    const { doc } = house();
    const r = h1Check(doc);
    expect(r.wallArea).toBeCloseTo(36 * 2.7, 6); // 36 m of exterior wall, interior wall excluded
    expect(r.glazingArea).toBeCloseTo(1.8 * 1.2 + 1.2 * 1.2, 6);
    expect(r.glazingPass).toBe(true);
    expect(r.items.find((i) => i.cls === "slab")?.area).toBeCloseTo(80, 6);
    // Layered types take their R from their materials' conductivity; windows and doors need it set.
    const wall = r.items.find((i) => i.cls === "wall")!;
    expect(wall.rSource).toBe("layers");
    expect(wall.rValue).toBeCloseTo(0.15 + 0.018 / 0.13 + 0.02 / 0.12 + 0.001 / 0.2 + 0.09 / 0.045 + 0.01 / 0.25, 6);
    expect(r.items.filter((i) => i.cls === "window" || i.cls === "door").every((i) => i.rValue === null)).toBe(true);
    expect(r.pass).toBe(false);
    expect(r.notes.some((n) => /R-value not set/.test(n))).toBe(true);
  });

  it("passes once types meet the zone minimums, and tightens windows in zone 5", () => {
    const { doc, ids } = house();
    const setR = (id: string, rValue: number) => doc.transact("R", (tx) => tx.update<ThermalTypeParams>(id, { rValue }));
    setR(ids.wallTypes.exterior, 2.2);
    setR(ids.floorTypes.slab, 1.6);
    setR(ids.windowTypes.w1800x1200, 0.46);
    setR(ids.windowTypes.w1200x1200, 0.46);
    setR(ids.doorTypes.single860, 0.5);
    const r = h1Check(doc);
    // No roof yet: nothing to fail, but noted.
    expect(r.notes).toContain("No roofs in the model.");
    expect(r.items.every((i) => i.pass)).toBe(true);
    doc.transact("Zone", (tx) => setH1Settings(tx, doc, { climateZone: 5 }));
    const z5 = h1Check(doc);
    expect(z5.items.filter((i) => i.cls === "window").every((i) => !i.pass && i.required === 0.5)).toBe(true);
  });

  it("limits glazing to the allowed share of wall area", () => {
    const { doc, ids } = house();
    doc.transact("Curtain", (tx) => createWall(tx, ids.wallTypes.curtain, { x: 0, y: -3000 }, { x: 20000, y: -3000 }, ids.levels.ground, { topLevelId: ids.levels.first }));
    const r = h1Check(doc);
    expect(r.glazingRatio).toBeGreaterThan(0.3);
    expect(r.glazingPass).toBe(false);
  });
});

describe("energy analysis (provisional)", () => {
  it("adds up fabric and ventilation heat loss, peak load and annual heating, against the H1 reference", () => {
    const { doc } = house();
    const r = energyAnalysis(doc);
    // Walls are net of the two windows and the door.
    const wall = r.rows.find((x) => x.cls === "wall")!;
    const openings = 1.8 * 1.2 + 1.2 * 1.2 + r.rows.filter((x) => x.cls === "door").reduce((s, x) => s + x.area, 0);
    expect(wall.area).toBeCloseTo(36 * 2.7 - openings, 6);
    // Windows and doors have no R-values: the H1 minimums are assumed; layered types use their layers.
    expect(r.rows.filter((x) => x.cls === "window" || x.cls === "door").every((x) => x.assumed)).toBe(true);
    expect(r.rows.find((x) => x.cls === "wall")!.assumed).toBe(false);
    expect(r.fabric).toBeCloseTo(r.rows.reduce((s, x) => s + x.area / x.r, 0), 9);
    // 10 x 8 slab, 2.7 m to the level above: 80 m², 216 m³.
    expect(r.floorArea).toBeCloseTo(80, 6);
    expect(r.volume).toBeCloseTo(216, 6);
    expect(r.ventilation).toBeCloseTo(0.33 * AIR_CHANGES * 216, 6);
    const c = ZONE_CLIMATE[r.zone];
    expect(r.peak).toBeCloseTo(r.total * (20 - c.design), 6);
    expect(r.annual).toBeCloseTo((r.total * c.hdd * 24) / 1000, 6);
    expect(r.pass).toBe(r.fabric <= r.reference + 1e-6);
    // Better walls than the minimum lower the heat loss below the reference.
    const wallType = doc.byCategory("WallType").find((t) => t.name === wall.typeName)!;
    doc.transact("R", (tx) => tx.update<ThermalTypeParams>(wallType.id, { rValue: 4 }));
    const better = energyAnalysis(doc);
    expect(better.fabric).toBeLessThan(r.fabric);
    expect(better.pass).toBe(better.fabric <= better.reference + 1e-6);
  });
});
