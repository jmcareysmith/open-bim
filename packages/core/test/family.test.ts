import { describe, expect, it } from "vitest";
import {
  Cat,
  Document,
  applyFamilyTemplate,
  createExtrusion,
  createFamilyParameter,
  createFamilyType,
  familyInfo,
  familyValues,
  setFamilyValue,
  views,
  type ChangeSet,
  type FamilyParameterParams,
} from "../src/index.ts";

describe("family documents", () => {
  it("start with a reference level, views, centre reference planes and starter parameters", () => {
    const doc = new Document();
    applyFamilyTemplate(doc, "Furniture");
    expect(views(doc).map((v) => v.name)).toEqual(["Ref. Level", "Front", "Right", "{3D}"]);
    expect(doc.byCategory(Cat.ReferencePlane).map((r) => r.name)).toEqual(["Center (Left/Right)", "Center (Front/Back)"]);
    expect(familyValues(doc)).toEqual({ Width: 1200, Depth: 600, Height: 750 });
    expect(familyInfo(doc)!.params.hosting).toBe("none");
    const door = new Document();
    applyFamilyTemplate(door, "Door");
    expect(familyInfo(door)!.params.hosting).toBe("wall");
  });

  it("types carry values; formulas compute the rest; overrides apply per instance", () => {
    const doc = new Document();
    applyFamilyTemplate(doc, "Furniture");
    doc.transact("P", (tx) => createFamilyParameter(tx, doc, "Top Thickness", { value: 30 }));
    doc.transact("P", (tx) => createFamilyParameter(tx, doc, "Leg Height", { formula: "Height - Top Thickness" }));
    expect(familyValues(doc)["Leg Height"]).toBe(720);
    doc.transact("T", (tx) => createFamilyType(tx, doc, "Coffee Table"));
    doc.transact("V", (tx) => setFamilyValue(tx, doc, "Height", 450));
    expect(familyValues(doc)["Leg Height"]).toBe(420);
    expect(familyValues(doc, "Default")["Leg Height"]).toBe(720);
    expect(familyValues(doc, "Coffee Table", { Height: 500 })["Leg Height"]).toBe(470);
  });

  it("parameter and type edits regenerate every form", () => {
    const doc = new Document();
    applyFamilyTemplate(doc, "Furniture");
    const top = doc.transact("E", (tx) =>
      createExtrusion(tx, [{ x: "-Width/2", y: 0 }, { x: "Width/2", y: 0 }, { x: "Width/2", y: "Depth" }, { x: "-Width/2", y: "Depth" }], { end: "Height" }),
    );
    const changes: ChangeSet[] = [];
    doc.on((c) => changes.push(c));
    doc.transact("V", (tx) => setFamilyValue(tx, doc, "Width", 1500));
    expect(changes.at(-1)!.regenerate).toContain(top.id);
    const p = doc.byCategory<FamilyParameterParams>(Cat.FamilyParameter)[0]!;
    doc.transact("F", (tx) => tx.update<FamilyParameterParams>(p.id, { formula: "Depth * 2" }));
    expect(changes.at(-1)!.regenerate).toContain(top.id);
  });

  it("validates parameter names and duplicates", () => {
    const doc = new Document();
    applyFamilyTemplate(doc, "Furniture");
    expect(() => doc.transact("P", (tx) => createFamilyParameter(tx, doc, "Width"))).toThrow(/already exists/);
    expect(() => doc.transact("P", (tx) => createFamilyParameter(tx, doc, "2nd"))).toThrow(/start with a letter/);
    expect(() => doc.transact("T", (tx) => createFamilyType(tx, doc, "Default"))).toThrow(/already exists/);
  });
});
