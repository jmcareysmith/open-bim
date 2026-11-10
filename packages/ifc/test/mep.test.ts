import { beforeAll, describe, expect, it } from "vitest";
import * as WebIFC from "web-ifc";
import {
  Document,
  applyResidentialTemplate,
  createDuct,
  createPipe,
  enableDuctFittings,
  ensureDuctTypes,
  ensurePipeTypes,
  loadFamily,
  placeFamilyInstance,
  type P3,
} from "@open-bim/core";
import { LIBRARY } from "@open-bim/library";
import { exportIfc } from "../src/index.ts";

let api: WebIFC.IfcAPI;
beforeAll(async () => {
  api = new WebIFC.IfcAPI();
  await api.Init(undefined, true);
}, 60_000);
const count = (model: number, type: number) => api.GetLineIDsWithType(model, type).size();
const p = (x: number, y: number, z = 2700): P3 => ({ x, y, z });

describe("IFC export of MEP", () => {
  it("writes sprinklers, terminals, duct and pipe segments and fittings as their IFC4 classes", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    enableDuctFittings(doc);
    const lib = (n: string) => doc.transact("L", (tx) => loadFamily(tx, doc, LIBRARY.find((f) => f.name === n)!.build(), n));
    const spr = lib("Sprinkler - Pendent");
    expect(spr.params.category).toBe("Sprinkler");
    doc.transact("S", (tx) => placeFamilyInstance(tx, doc, spr.id, "K80 68 °C", { levelId: ids.levels.ground, position: { x: 1000, y: 1000 }, offset: 2400 }));
    const diff = lib("Supply Diffuser - Square");
    doc.transact("D", (tx) => placeFamilyInstance(tx, doc, diff.id, "600 x 600 - 250 neck", { levelId: ids.levels.ground, position: { x: 3000, y: 1000 }, offset: 2400 }));
    const [round] = doc.transact("T", (tx) => ensureDuctTypes(tx, doc));
    doc.transact("Duct", (tx) => createDuct(tx, doc, round!, ids.levels.ground, p(0, 0), p(3000, 0), { diameter: 200 }));
    doc.transact("Duct", (tx) => createDuct(tx, doc, round!, ids.levels.ground, p(3000, 0), p(3000, 2000), { diameter: 200 }));
    const [pex] = doc.transact("T", (tx) => ensurePipeTypes(tx, doc));
    doc.transact("Pipe", (tx) => createPipe(tx, doc, pex!, ids.levels.ground, p(0, 500, 2500), p(2000, 500, 2500), { diameter: 25, classification: "fireProtection" }));
    const model = api.OpenModel(new TextEncoder().encode(exportIfc(doc, { timestamp: "t" })));
    expect(count(model, WebIFC.IFCFIRESUPPRESSIONTERMINAL)).toBe(1);
    expect(count(model, WebIFC.IFCAIRTERMINAL)).toBe(1);
    expect(count(model, WebIFC.IFCDUCTSEGMENT)).toBe(2);
    expect(count(model, WebIFC.IFCDUCTFITTING)).toBe(1);
    expect(count(model, WebIFC.IFCPIPESEGMENT)).toBe(1);
    api.CloseModel(model);
  });
});
