import { describe, expect, it } from "vitest";
import {
  Cat,
  Document,
  applyResidentialTemplate,
  associateGlobal,
  createGlobalParameter,
  createProjectParameter,
  createViewFilter,
  createWall,
  customValue,
  enableGlobalParameters,
  filterMatches,
  globalValues,
  parseSharedParameters,
  setCustomValue,
  shareProjectParameters,
  writeSharedParameters,
  type GlobalParameterParams,
  type ViewFilter,
  type WallParams,
} from "../src/index.ts";

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const wall = doc.transact("W", (tx) =>
    createWall(tx, ids.wallTypes.interior, { x: 0, y: 0 }, { x: 4000, y: 0 }, ids.levels.ground, { height: 2400 }),
  );
  return { doc, ids, wall };
}

describe("project parameters", () => {
  it("instance parameters live on the element, type parameters on its type", () => {
    const { doc, ids, wall } = setup();
    doc.transact("P", (tx) => createProjectParameter(tx, doc, "Fire Rating", { categories: [Cat.Wall], dataType: "text" }));
    doc.transact("P", (tx) => createProjectParameter(tx, doc, "Cost per m2", { categories: [Cat.Wall], dataType: "number", binding: "type" }));
    doc.transact("V", (tx) => setCustomValue(tx, doc, doc.require(wall.id), "Fire Rating", "FRR 30/30/30"));
    doc.transact("V", (tx) => setCustomValue(tx, doc, doc.require(wall.id), "Cost per m2", "85.5"));
    const w = doc.require(wall.id);
    expect(customValue(doc, w, "Fire Rating")).toBe("FRR 30/30/30");
    expect(customValue(doc, w, "Cost per m2")).toBe(85.5);
    expect((doc.require(ids.wallTypes.interior).params as { custom?: unknown }).custom).toEqual({ "Cost per m2": 85.5 });
    expect(() => doc.transact("Bad", (tx) => setCustomValue(tx, doc, w, "Cost per m2", "lots"))).toThrow(/needs a number/);
    expect(() => doc.transact("Bad", (tx) => setCustomValue(tx, doc, doc.require(ids.levels.ground), "Fire Rating", "x"))).toThrow(/doesn't apply/);
  });

  it("filters can test project parameters", () => {
    const { doc, wall } = setup();
    doc.transact("P", (tx) => createProjectParameter(tx, doc, "Fire Rating", { categories: [Cat.Wall] }));
    doc.transact("V", (tx) => setCustomValue(tx, doc, doc.require(wall.id), "Fire Rating", "FRR 60/60/60"));
    const f = doc.transact("F", (tx) =>
      createViewFilter(tx, doc, "Fire walls", { categories: [Cat.Wall], rules: [{ field: "Fire Rating", op: "contains", value: "FRR" }] }),
    ) as ViewFilter;
    expect(filterMatches(doc, f, doc.require(wall.id))).toBe(true);
  });
});

describe("shared parameters", () => {
  it("round-trip the Revit shared parameter file format", () => {
    const { doc } = setup();
    doc.transact("P", (tx) => createProjectParameter(tx, doc, "Fire Rating", { categories: [Cat.Wall] }));
    doc.transact("P", (tx) => createProjectParameter(tx, doc, "Acoustic STC", { categories: [Cat.Wall], dataType: "number", group: "Acoustics" }));
    const defs = doc.transact("Share", (tx) => shareProjectParameters(tx, doc));
    const text = writeSharedParameters(defs);
    expect(text).toContain("*PARAM\tGUID\tNAME\tDATATYPE");
    const back = parseSharedParameters(text);
    expect(back.map((d) => [d.name, d.dataType, d.group])).toEqual([
      ["Fire Rating", "text", "Identity Data"],
      ["Acoustic STC", "number", "Acoustics"],
    ]);
    expect(back[0]!.guid).toBe(defs[0]!.guid);
    // The same shared parameter can't be added twice.
    expect(() => doc.transact("Again", (tx) => createProjectParameter(tx, doc, "Fire Rating 2", { guid: defs[0]!.guid }))).toThrow(/already in this project/);
  });
});

describe("global parameters", () => {
  it("evaluate formulas and drive associated element parameters, live and undoable", () => {
    const { doc, wall } = setup();
    enableGlobalParameters(doc);
    doc.transact("G", (tx) => createGlobalParameter(tx, doc, "Floor to Floor", { value: 2700 }));
    const ch = doc.transact("G", (tx) => createGlobalParameter(tx, doc, "Ceiling Height", { formula: "Floor to Floor - 300" }));
    expect(globalValues(doc)["Ceiling Height"]).toBe(2400);
    doc.transact("Assoc", (tx) => associateGlobal(tx, doc, wall.id, "height", "Ceiling Height"));
    const f2f = doc.byCategory<GlobalParameterParams>(Cat.GlobalParameter).find((g) => g.name === "Floor to Floor")!;
    doc.transact("Raise", (tx) => tx.update<GlobalParameterParams>(f2f.id, { value: 3000 }));
    expect((doc.require(wall.id).params as WallParams).height).toBe(2700);
    doc.undo();
    expect((doc.require(wall.id).params as WallParams).height).toBe(2400);
    expect(() => doc.transact("Bad", (tx) => associateGlobal(tx, doc, wall.id, "baseLevelId", "Ceiling Height"))).toThrow(/numeric/);
    void ch;
  });
});
