import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  bracingCheck,
  bracingSettings,
  createWall,
  setBracingSettings,
  setWallBracing,
  type Wall,
} from "../src/index.ts";

/** Single-storey 10 m (x) by 8 m (y) box, walls 2.7 m high, flat (no roof). */
function box() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const pts = [
    { x: 0, y: 0 },
    { x: 10000, y: 0 },
    { x: 10000, y: 8000 },
    { x: 0, y: 8000 },
  ];
  const walls = doc.transact("Walls", (tx) => pts.map((p, i) => createWall(tx, ids.wallTypes.exterior, p, pts[(i + 1) % 4]!, ids.levels.ground, { topLevelId: ids.levels.first }))) as Wall[];
  return { doc, ids, walls };
}

describe("NZS 3604 bracing", () => {
  it("finds two lines each way and estimates wind demand from the elevation", () => {
    const { doc } = box();
    const r = bracingCheck(doc);
    expect(r.storeys).toHaveLength(2);
    const x = r.storeys.find((s) => s.direction === "x")!;
    expect(x.lines.map((l) => l.position)).toEqual([0, 8000]);
    expect(x.maxSpacing).toBe(8000);
    expect(x.spacingPass).toBe(false); // 8 m > 6 m between lines
    // High wind zone 44 m/s: q = 0.6 * 44² Pa; 8 m wide, 1.35 m above mid-storey; 20 BU/kN.
    const q = (0.6 * 44 * 44) / 1000;
    expect(x.demandWind).toBeCloseTo(q * 1.2 * 8 * 1.35 * 20, 6);
    expect(x.capacityWind).toBe(0);
    expect(r.pass).toBe(false);
  });

  it("adds panel capacity per line and checks each line's minimum", () => {
    const { doc, walls } = box();
    const sys = bracingSettings(doc).systems[2]!; // 150 / 135 BU/m
    doc.transact("Brace", (tx) => {
      for (const w of walls) setWallBracing(tx, doc, w.id, [{ system: sys.name, offset: 500, length: 1200 }]);
    });
    const x = bracingCheck(doc).storeys.find((s) => s.direction === "x")!;
    expect(x.lines[0]!.wind).toBeCloseTo(180, 6);
    expect(x.lines[0]!.eq).toBeCloseTo(162, 6);
    expect(x.capacityWind).toBeCloseTo(360, 6);
    expect(x.lines[0]!.required).toBeGreaterThanOrEqual(100);
    expect(x.lines.every((l) => l.pass)).toBe(true);
    // An internal line in the middle brings spacing within 6 m.
    doc.transact("Middle", (tx) => {
      const w = createWall(tx, walls[0]!.typeId!, { x: 0, y: 4000 }, { x: 10000, y: 4000 }, walls[0]!.params.baseLevelId, { topLevelId: walls[0]!.params.topLevelId });
      setWallBracing(tx, doc, w.id, [{ system: sys.name, offset: 0, length: 1000 }]);
    });
    const x2 = bracingCheck(doc).storeys.find((s) => s.direction === "x")!;
    expect(x2.lines).toHaveLength(3);
    expect(x2.spacingPass).toBe(true);
  });

  it("uses tabulated overrides and rejects panels past the wall end", () => {
    const { doc, ids, walls } = box();
    doc.transact("Override", (tx) => setBracingSettings(tx, doc, { overrides: { [ids.levels.ground]: { windX: 250, eqX: 90 } } }));
    const x = bracingCheck(doc).storeys.find((s) => s.direction === "x")!;
    expect(x.overridden).toBe(true);
    expect(x.demandWind).toBe(250);
    expect(x.demandEq).toBe(90);
    const sys = bracingSettings(doc).systems[0]!;
    expect(() => doc.transact("Bad", (tx) => setWallBracing(tx, doc, walls[0]!.id, [{ system: sys.name, offset: 9500, length: 1000 }]))).toThrow(/past the end/);
    expect(() => doc.transact("Short", (tx) => setWallBracing(tx, doc, walls[0]!.id, [{ system: sys.name, offset: 0, length: 200 }]))).toThrow(/at least/);
  });
});
