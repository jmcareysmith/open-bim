import { beforeAll, describe, expect, it } from "vitest";
import * as WebIFC from "web-ifc";
import {
  Document,
  applyResidentialTemplate,
  createBeam,
  createBrace,
  createColumn,
  createLoad,
  createPadFooting,
  ensureStructuralTypes,
  type Vec2,
} from "@open-bim/core";
import { exportIfc } from "../src/index.ts";

let api: WebIFC.IfcAPI;
beforeAll(async () => {
  api = new WebIFC.IfcAPI();
  await api.Init(undefined, true);
}, 60_000);

const p = (x: number, y: number): Vec2 => ({ x, y });
const count = (model: number, type: number) => api.GetLineIDsWithType(model, type).size();

describe("IFC structural analysis view", () => {
  it("writes physical members, the analytical model, supports, load cases and loads", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const types = doc.transact("T", (tx) => ensureStructuralTypes(tx, doc));
    const byName = (n: string) => types.find((id) => doc.require(id).name === n)!;
    const beam = doc.transact("Frame", (tx) => {
      createColumn(tx, doc, byName("Steel SHS 100x100x4"), ids.levels.ground, ids.levels.first, p(0, 0));
      createColumn(tx, doc, byName("Steel SHS 100x100x4"), ids.levels.ground, ids.levels.first, p(6000, 0));
      createPadFooting(tx, doc, ids.levels.ground, p(0, 0));
      createBrace(tx, doc, byName("Steel SHS 100x100x4"), ids.levels.ground, p(0, 0), p(6000, 0));
      return createBeam(tx, doc, byName("Steel 200UB25"), ids.levels.first, p(0, 0), p(6000, 0));
    });
    doc.transact("Loads", (tx) => {
      createLoad(tx, doc, beam.id, { case: "G", kind: "line", value: 2 });
      createLoad(tx, doc, beam.id, { case: "Q", kind: "point", value: 10, at: 2000 });
    });
    const text = exportIfc(doc, { timestamp: "2026-11-09T00:00:00" });
    const model = api.OpenModel(new TextEncoder().encode(text));
    // Physical.
    expect(count(model, WebIFC.IFCCOLUMN)).toBe(2);
    expect(count(model, WebIFC.IFCBEAM)).toBe(1);
    expect(count(model, WebIFC.IFCMEMBER)).toBe(1);
    expect(count(model, WebIFC.IFCFOOTING)).toBe(1);
    // Analytical.
    expect(count(model, WebIFC.IFCSTRUCTURALANALYSISMODEL)).toBe(1);
    expect(count(model, WebIFC.IFCSTRUCTURALCURVEMEMBER)).toBe(4);
    expect(count(model, WebIFC.IFCSTRUCTURALPOINTCONNECTION)).toBe(4);
    expect(count(model, WebIFC.IFCRELCONNECTSSTRUCTURALMEMBER)).toBe(8);
    expect(count(model, WebIFC.IFCSTRUCTURALLOADCASE)).toBe(2);
    expect(count(model, WebIFC.IFCSTRUCTURALCURVEACTION)).toBe(1);
    expect(count(model, WebIFC.IFCSTRUCTURALPOINTACTION)).toBe(1);
    expect(count(model, WebIFC.IFCMATERIALPROFILESET)).toBe(2);
    // The line load: −2000 N/m in z.
    const lf = api.GetLine(model, api.GetLineIDsWithType(model, WebIFC.IFCSTRUCTURALLOADLINEARFORCE).get(0));
    expect(lf.LinearForceZ.value).toBe(-2000);
    // Two supports pinned (column bases).
    const conns = api.GetLineIDsWithType(model, WebIFC.IFCSTRUCTURALPOINTCONNECTION);
    let supports = 0;
    for (let i = 0; i < conns.size(); i++) if (api.GetLine(model, conns.get(i)).AppliedCondition) supports++;
    expect(supports).toBe(2);
    // Member ends carry their condition: columns rigid (Fixed), beam and brace ends hinged (Pinned).
    const conds = api.GetLineIDsWithType(model, WebIFC.IFCBOUNDARYNODECONDITION);
    expect([0, 1].map((k) => api.GetLine(model, conds.get(k)).Name.value).sort()).toEqual(["Fixed", "Pinned"]);
    const rels = api.GetLineIDsWithType(model, WebIFC.IFCRELCONNECTSSTRUCTURALMEMBER);
    let withCondition = 0;
    for (let k = 0; k < rels.size(); k++) if (api.GetLine(model, rels.get(k)).AppliedCondition) withCondition++;
    expect(withCondition).toBe(8);
    api.CloseModel(model);
  });

  it("can leave the analysis model out", () => {
    const doc = new Document();
    applyResidentialTemplate(doc);
    expect(exportIfc(doc, { structural: false })).not.toContain("IFCSTRUCTURALANALYSISMODEL");
  });
});
