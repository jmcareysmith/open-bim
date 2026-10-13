import { describe, expect, it } from "vitest";
import {
  Document,
  createPropertyLine,
  ensureProjectSettings,
  formatBearing,
  misclose,
  parseBearing,
  pointsFromLegs,
  projectSettings,
  propertyArea,
  propertyLegs,
  type ProjectSettingsParams,
} from "../src/index.ts";

describe("property lines", () => {
  it("read bearings and distances round the boundary, and its area", () => {
    const doc = new Document();
    // 20 × 30 m lot, plan up = north.
    const pl = doc.transact("PL", (tx) =>
      createPropertyLine(tx, [
        { x: 0, y: 0 },
        { x: 0, y: 30000 },
        { x: 20000, y: 30000 },
        { x: 20000, y: 0 },
      ]),
    );
    const legs = propertyLegs(doc, pl);
    expect(legs.map((l) => Math.round(l.bearing))).toEqual([0, 90, 180, 270]);
    expect(legs[1]!.distance).toBeCloseTo(20000);
    expect(propertyArea(pl)).toBeCloseTo(600e6);
  });

  it("follow the project's survey north when the project is rotated", () => {
    const doc = new Document();
    doc.transact("Settings", (tx) => ensureProjectSettings(tx, doc));
    const s = projectSettings(doc)!;
    // Project X turned 30° anticlockwise from east: plan up points 30° west of north.
    doc.transact("Rotate", (tx) => tx.update<ProjectSettingsParams>(s.id, { location: { ...s.params.location, rotation: (30 * Math.PI) / 180 } } as Partial<ProjectSettingsParams>));
    const pl = doc.transact("PL", (tx) => createPropertyLine(tx, [{ x: 0, y: 0 }, { x: 0, y: 10000 }, { x: 10000, y: 10000 }]));
    expect(propertyLegs(doc, pl)[0]!.bearing).toBeCloseTo(330);
  });

  it("build corners from bearings and distances, and check the misclose", () => {
    const doc = new Document();
    const legs = [
      { bearing: 0, distance: 30000 },
      { bearing: 90, distance: 20000 },
      { bearing: 180, distance: 30000 },
      { bearing: 270, distance: 20000 },
    ];
    const pts = pointsFromLegs(doc, { x: 0, y: 0 }, legs);
    expect(pts[2]!.x).toBeCloseTo(20000);
    expect(pts[2]!.y).toBeCloseTo(30000);
    expect(misclose(doc, { x: 0, y: 0 }, legs)).toBeCloseTo(0);
    expect(misclose(doc, { x: 0, y: 0 }, [...legs.slice(0, 3), { bearing: 270, distance: 19950 }])).toBeCloseTo(50);
  });

  it("format and parse bearings in degrees, minutes and seconds", () => {
    expect(formatBearing(45.5)).toBe("45°30'00\"");
    expect(formatBearing(359.99999)).toBe("0°00'00\"");
    expect(parseBearing("45°30'00\"")).toBeCloseTo(45.5);
    expect(parseBearing("123 15 36")).toBeCloseTo(123.26);
    expect(parseBearing("12.25")).toBeCloseTo(12.25);
    expect(parseBearing("10 75")).toBeNull();
  });
});
