import { describe, expect, it } from "vitest";
import {
  Document,
  applyFamilyTemplate,
  createFamilyParameter,
  createFamilyType,
  familyInfo,
  importTypeCatalog,
  instanceValues,
  levels,
  loadFamily,
  placeFamilyInstance,
  typeCatalogCsv,
} from "../src/index.ts";

describe("type catalogs", () => {
  it("export the family types with Revit-style headers", () => {
    const doc = new Document();
    applyFamilyTemplate(doc, "Door", "Panel Door");
    doc.transact("T", (tx) => createFamilyType(tx, doc, "760 x 1980, \"Hall\""));
    expect(typeCatalogCsv(doc)).toBe(
      ",Width##length##millimeters,Height##length##millimeters\nDefault,860,1980\n\"760 x 1980, \"\"Hall\"\"\",860,1980\n",
    );
  });

  it("import types (new and updated), converting units", () => {
    const doc = new Document();
    applyFamilyTemplate(doc, "Door", "Panel Door");
    const csv = ",Width##length##meters,Height##length##millimeters\r\nDefault,0.81,2000\r\n760 x 1980,0.76,1980\r\n";
    const loaded = doc.transact("Import", (tx) => importTypeCatalog(tx, doc, csv));
    expect(loaded).toEqual(["Default", "760 x 1980"]);
    expect(familyInfo(doc)!.params.types).toEqual([
      { name: "Default", values: { Width: 810, Height: 2000 } },
      { name: "760 x 1980", values: { Width: 760, Height: 1980 } },
    ]);
  });

  it("reject unknown columns and bad numbers", () => {
    const doc = new Document();
    applyFamilyTemplate(doc, "Door");
    expect(() => doc.transact("I", (tx) => importTypeCatalog(tx, doc, ",Colour##other##\nA,red\n"))).toThrow(/isn't a parameter/);
    expect(() => doc.transact("I", (tx) => importTypeCatalog(tx, doc, ",Width##length##millimeters\nA,wide\n"))).toThrow(/isn't a number/);
  });
});

describe("nested families", () => {
  it("nested instances take their parameters from the host through associations", () => {
    const leg = new Document();
    applyFamilyTemplate(leg, "GenericModel", "Leg");
    leg.transact("P", (tx) => createFamilyParameter(tx, leg, "Height", { value: 700 }));
    const table = new Document();
    applyFamilyTemplate(table, "Furniture", "Table");
    const def = table.transact("Nest", (tx) => loadFamily(tx, table, leg, "Leg"));
    const inst = table.transact("Place", (tx) =>
      placeFamilyInstance(tx, table, def.id, "Default", { levelId: levels(table)[0]!.id }),
    );
    table.transact("Assoc", (tx) => tx.update(inst.id, { associations: { Height: "Height - 30" } }));
    const placed = table.require(inst.id) as typeof inst;
    expect(instanceValues(table, placed).Height).toBe(720); // host current type: Height 750
    expect(instanceValues(table, placed, { Height: 450 }).Height).toBe(420); // another host type
    table.transact("Bad", (tx) => tx.update(inst.id, { associations: { Height: "Nope" } }));
    expect(() => instanceValues(table, table.require(inst.id) as typeof inst)).toThrow(/Nested Leg Height/);
  });
});
