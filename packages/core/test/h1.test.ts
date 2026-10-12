import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createDoor,
  createFloor,
  createWall,
  createWindow,
  h1Check,
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
    expect(r.items.every((i) => i.rValue === null)).toBe(true);
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
