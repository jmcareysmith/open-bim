import { describe, expect, it } from "vitest";
import { Document, ensureProjectSettings, nztmToLatLon, projectLocation, sunDirection, sunPosition, sunStudyFrames, viewSun, viewSunDate, type ProjectSettingsParams, type ViewParams } from "../src/index.ts";

describe("solar position", () => {
  it("converts NZTM2000 to latitude/longitude", () => {
    // Wellington CBD.
    const { lat, lon } = nztmToLatLon(1748735, 5428000);
    expect(lat).toBeCloseTo(-41.286, 2);
    expect(lon).toBeCloseTo(174.776, 2);
    // Central meridian at the false origin's easting.
    expect(nztmToLatLon(1600000, 5000000).lon).toBeCloseTo(173, 6);
  });

  it("puts the summer and winter noon sun in the north at the right height", () => {
    // Solar noon in Wellington is about 00:20 UTC.
    const summer = sunPosition(new Date("2025-12-21T00:19:00Z"), -41.28, 174.78);
    expect(summer.altitude).toBeCloseTo(72.2, 0);
    expect(Math.min(summer.azimuth, 360 - summer.azimuth)).toBeLessThan(8);
    const winter = sunPosition(new Date("2026-06-21T00:20:00Z"), -41.28, 174.78);
    expect(winter.altitude).toBeCloseTo(25.3, 0);
    // Morning sun is in the east, below the noon height.
    const morning = sunPosition(new Date("2026-03-20T20:00:00Z"), -41.28, 174.78);
    expect(morning.azimuth).toBeGreaterThan(60);
    expect(morning.azimuth).toBeLessThan(120);
    // Midnight: below the horizon.
    expect(sunPosition(new Date("2026-03-20T12:20:00Z"), -41.28, 174.78).altitude).toBeLessThan(-30);
  });

  it("turns the sun into project axes using the project rotation", () => {
    const doc = new Document();
    const noon = new Date("2026-06-21T00:20:00Z");
    doc.transact("Location", (tx) => {
      const s = ensureProjectSettings(tx, doc);
      tx.update<ProjectSettingsParams>(s.id, { location: { epsg: 2193, eastings: 1748735, northings: 5428000, height: 0, rotation: 0 } });
    });
    const d = sunDirection(doc, noon);
    expect(d.y).toBeGreaterThan(0.85); // north = +Y
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6);
    doc.transact("Rotate", (tx) => {
      const s = ensureProjectSettings(tx, doc);
      tx.update<ProjectSettingsParams>(s.id, { location: { epsg: 2193, eastings: 1748735, northings: 5428000, height: 0, rotation: Math.PI / 2 } });
    });
    // Project X now points north.
    expect(sunDirection(doc, noon).x).toBeGreaterThan(0.85);
  });
});

describe("view sun settings", () => {
  it("a view's own date and time, else today at 2 pm", () => {
    const p = { kind: "3d", levelId: null, range: null, scale: 100, detailLevel: "medium", hiddenCategories: [] } as unknown as ViewParams;
    const today = new Date(2026, 9, 13, 9, 30);
    expect(viewSunDate(p, today)).toEqual(new Date(2026, 9, 13, 14, 0));
    expect(viewSunDate({ ...p, sun: { date: "2026-12-21", time: "16:45" } }, today)).toEqual(new Date(2026, 11, 21, 16, 45));
    expect(viewSunDate({ ...p, sun: { date: "bad", time: "x" } }, today)).toEqual(new Date(2026, 9, 13, 14, 0));
  });
});

describe("solar studies", () => {
  it("steps a single-day study across the day and a multi-day study across the dates", () => {
    const single = sunStudyFrames({ study: "singleDay", date: "2026-12-21", time: "12:00", startTime: "06:00", endTime: "18:00", interval: 60 });
    expect(single).toHaveLength(13);
    expect(single[0]!.getHours()).toBe(6);
    expect(single.at(-1)!.getHours()).toBe(18);
    const multi = sunStudyFrames({ study: "multiDay", date: "2026-06-01", endDate: "2026-06-29", time: "10:00", interval: 7 });
    expect(multi.map((d) => d.getDate())).toEqual([1, 8, 15, 22, 29]);
    expect(sunStudyFrames({ date: "2026-06-01", time: "10:00" })).toHaveLength(1);
  });

  it("shows the study's current frame, or set angles in Lighting mode", () => {
    const p = { sun: { study: "singleDay" as const, date: "2026-12-21", time: "12:00", interval: 120, frame: 2 } } as unknown as ViewParams;
    expect(viewSunDate(p).getHours()).toBe(10);
    const doc = new Document();
    const north = viewSun(doc, { sun: { study: "lighting", date: "", time: "", azimuth: 0, altitude: 0 } } as unknown as ViewParams);
    expect(north.y).toBeCloseTo(Math.cos(projectLocation(doc).rotation));
    expect(north.z).toBeCloseTo(0);
    const up = viewSun(doc, { sun: { study: "lighting", date: "", time: "", azimuth: 90, altitude: 90 } } as unknown as ViewParams);
    expect(up.z).toBeCloseTo(1);
  });
});
