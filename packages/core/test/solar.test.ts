import { describe, expect, it } from "vitest";
import { Document, ensureProjectSettings, nztmToLatLon, sunDirection, sunPosition, type ProjectSettingsParams } from "../src/index.ts";

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
