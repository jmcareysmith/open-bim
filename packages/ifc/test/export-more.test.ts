import { beforeAll, describe, expect, it } from "vitest";
import * as WebIFC from "web-ifc";
import { Document, applyResidentialTemplate, createDirectShape, createFloor, createRebar, ensureFoundationSlabType } from "@open-bim/core";
import { exportIfc } from "../src/index.ts";

let api: WebIFC.IfcAPI;
beforeAll(async () => {
  api = new WebIFC.IfcAPI();
  await api.Init(undefined, true);
}, 60_000);
const count = (model: number, type: number) => api.GetLineIDsWithType(model, type).size();

describe("IFC export of rebar and imported shapes", () => {
  it("writes reinforcement as IfcReinforcingBar and imported shapes as their class (proxy otherwise)", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    doc.transact("S", (tx) => {
      const f = createFloor(tx, ensureFoundationSlabType(tx, doc), ids.levels.ground, [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 4000 }, { x: 0, y: 4000 }]);
      createRebar(tx, doc, f.id);
    });
    const shape = (ifcClass: string) => ({ levelId: ids.levels.ground, ifcClass, globalId: ifcClass, positions: [0, 0, 0, 1000, 0, 0, 0, 1000, 0, 0, 0, 1000], indices: [0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3], color: 0x999999, properties: {} });
    doc.transact("I", (tx) => {
      createDirectShape(tx, shape("IfcFurniture"), "Sofa");
      createDirectShape(tx, shape("IfcTransportElement"), "Lift");
    });
    const model = api.OpenModel(new TextEncoder().encode(exportIfc(doc, { timestamp: "t" })));
    expect(count(model, WebIFC.IFCREINFORCINGBAR)).toBe(1);
    const bar = api.GetLine(model, api.GetLineIDsWithType(model, WebIFC.IFCREINFORCINGBAR).get(0));
    expect(Number(bar.NominalDiameter.value)).toBeGreaterThan(0);
    expect(count(model, WebIFC.IFCFURNITURE)).toBe(1);
    expect(count(model, WebIFC.IFCBUILDINGELEMENTPROXY)).toBe(1);
    api.CloseModel(model);
  });
});
