import { describe, expect, it } from "vitest";
import {
  Cat,
  DEFAULT_UNITS,
  Document,
  applyResidentialTemplate,
  createProjectSettings,
  ensureProjectSettings,
  formatAngle,
  formatArea,
  formatLength,
  lengthInputValue,
  parseAngle,
  parseLength,
  projectSettings,
  projectUnits,
  type ProjectSettingsParams,
  type UnitsSettings,
} from "../src/index.ts";

const metres: UnitsSettings = { ...DEFAULT_UNITS, length: { unit: "m", decimals: 3 } };

describe("length formatting and parsing", () => {
  it("formats in the project unit with digit grouping", () => {
    expect(formatLength(12500)).toBe("12 500 mm");
    expect(formatLength(2400, metres)).toBe("2.400 m");
    expect(formatLength(-0.2)).toBe("0 mm");
    expect(lengthInputValue(2400, metres)).toBe("2.4");
    expect(lengthInputValue(12500)).toBe("12500");
    // Inputs keep mm precision even when the display rounds to whole metres.
    expect(lengthInputValue(2700, { ...DEFAULT_UNITS, length: { unit: "m", decimals: 0 } })).toBe("2.7");
  });

  it("parses bare numbers in the project unit, or an explicit suffix", () => {
    expect(parseLength("2400")).toBe(2400);
    expect(parseLength("2.4", metres)).toBe(2400);
    expect(parseLength("2.4m")).toBe(2400);
    expect(parseLength("240 cm", metres)).toBe(2400);
    expect(parseLength("12 500")).toBe(12500);
    expect(parseLength("12,500 mm")).toBe(12500);
    expect(parseLength("-150")).toBe(-150);
    expect(parseLength(".5m")).toBe(500);
    expect(parseLength("abc")).toBeNull();
    expect(parseLength("")).toBeNull();
    expect(parseLength("3 ft")).toBeNull();
  });
});

describe("area and angle", () => {
  it("formats areas in m² by default", () => {
    expect(formatArea(24.16e6)).toBe("24.16 m²");
    expect(formatArea(1500, { ...DEFAULT_UNITS, area: { unit: "mm2", decimals: 0 } })).toBe("1 500 mm²");
  });

  it("formats and parses angles", () => {
    expect(formatAngle(Math.PI / 4)).toBe("45.0°");
    expect(parseAngle("25")).toBeCloseTo((25 * Math.PI) / 180);
    expect(parseAngle("25°")).toBeCloseTo((25 * Math.PI) / 180);
    expect(parseAngle("0.5 rad")).toBe(0.5);
    expect(parseAngle("steep")).toBeNull();
  });
});

describe("project settings", () => {
  it("are created by the template, saved with the file, and singular", () => {
    const doc = new Document();
    applyResidentialTemplate(doc);
    expect(projectUnits(doc)).toEqual(DEFAULT_UNITS);
    doc.transact("Units", (tx) =>
      tx.update<ProjectSettingsParams>(projectSettings(doc)!.id, { units: metres, info: { name: "Kauri St", number: "24-017", client: "", address: "" } }),
    );
    const copy = Document.fromJSON(JSON.parse(JSON.stringify(doc.toJSON())));
    expect(projectUnits(copy)).toEqual(metres);
    expect(projectSettings(copy)!.params.info.name).toBe("Kauri St");
    expect(() => doc.transact("Again", (tx) => createProjectSettings(tx, doc))).toThrow(/already exist/);
  });

  it("default for older documents and can be added on demand", () => {
    const doc = new Document();
    expect(projectUnits(doc)).toEqual(DEFAULT_UNITS);
    doc.transact("Ensure", (tx) => ensureProjectSettings(tx, doc));
    doc.transact("Ensure again", (tx) => ensureProjectSettings(tx, doc));
    expect(doc.byCategory(Cat.ProjectSettings)).toHaveLength(1);
  });
});
