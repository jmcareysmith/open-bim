import { describe, expect, it } from "vitest";
import {
  Cat,
  Document,
  applyFamilyTemplate,
  applyResidentialTemplate,
  createConnector,
  createDuct,
  createSystem,
  ductFlows,
  ducts,
  elementConnectors,
  enableDuctFittings,
  ensureDuctTypes,
  loadFamily,
  placeFamilyInstance,
  sizeDucts,
  type Duct,
  type DuctFittingParams,
  type DuctParams,
  type FamilyInstance,
  type MEPSystem,
  type P3,
} from "../src/index.ts";

const p = (x: number, y: number, z = 2700): P3 => ({ x, y, z });

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  enableDuctFittings(doc);
  const [round, rect] = doc.transact("Types", (tx) => ensureDuctTypes(tx, doc));
  const duct = (a: P3, b: P3, opts: Partial<DuctParams> = {}, type = round!) => doc.transact("Duct", (tx) => createDuct(tx, doc, type, ids.levels.ground, a, b, opts));
  const fittings = () => doc.byCategory<DuctFittingParams>(Cat.DuctFitting).map((f) => f.params);
  return { doc, ids, duct, fittings, rect: rect! };
}

describe("ducts", () => {
  it("make an elbow where two ends meet at an angle, and drop it when they part", () => {
    const { doc, duct, fittings } = setup();
    const a = duct(p(0, 0), p(3000, 0));
    duct(p(3000, 0), p(3000, 2000));
    expect(fittings().map((f) => f.kind)).toEqual(["elbow"]);
    expect(fittings()[0]!.point).toEqual({ x: 3000, y: 0, z: 2700 });
    doc.transact("Move", (tx) => tx.update<DuctParams>(a.id, { end: p(2500, 0) }));
    expect(fittings()).toEqual([]);
  });

  it("split a duct for a tee where a branch ends on its side", () => {
    const { duct, fittings, doc } = setup();
    duct(p(0, 0), p(4000, 0));
    duct(p(2000, 0), p(2000, 1500), { diameter: 150 });
    expect(ducts(doc)).toHaveLength(3);
    const tee = fittings().find((f) => f.kind === "tee")!;
    expect(tee).toBeTruthy();
    // Main pieces first, branch last.
    const branch = doc.require(tee.ends[2]!.ductId) as Duct;
    expect(branch.params.diameter).toBe(150);
  });

  it("make a transition between sizes on a straight run, and none between equal sizes", () => {
    const { duct, fittings } = setup();
    duct(p(0, 0), p(2000, 0), { diameter: 300 });
    duct(p(2000, 0), p(4000, 0), { diameter: 300 });
    expect(fittings()).toEqual([]);
    duct(p(4000, 0), p(6000, 0), { diameter: 200 });
    expect(fittings().map((f) => f.kind)).toEqual(["transition"]);
  });

  it("expose a connector at each end facing out", () => {
    const { doc, duct } = setup();
    const d = duct(p(0, 0), p(1000, 0, 3000));
    const [s, e] = elementConnectors(doc, d);
    expect(s!.position).toEqual([0, 0, 2700]);
    expect(e!.position).toEqual([1000, 0, 3000]);
    expect(s!.direction[0]).toBeLessThan(0);
  });
});

describe("duct sizing", () => {
  it("carries the terminals' air back to the equipment and sizes ducts by velocity", () => {
    const { doc, ids, duct } = setup();
    // Fan coil at the origin (supply out), two diffusers of 100 L/s each.
    const fam = (name: string, flowDirection: "in" | "out", flow: number) => {
      const f = new Document();
      applyFamilyTemplate(f, name === "FCU" ? "MechanicalEquipment" : "AirTerminal", name);
      f.transact("C", (tx) => createConnector(tx, { classification: "supplyAir", flowDirection, flow }));
      return doc.transact("Load", (tx) => loadFamily(tx, doc, f, name)).id;
    };
    const fcu = fam("FCU", "out", 200);
    const diff = fam("Diffuser", "in", 100);
    const place = (id: string, x: number, y: number) =>
      doc.transact("P", (tx) => placeFamilyInstance(tx, doc, id, "Default", { levelId: ids.levels.ground, position: { x, y }, offset: 2700 })) as FamilyInstance;
    const unit = place(fcu, 0, 0);
    const d1 = place(diff, 4000, 0);
    const d2 = place(diff, 2000, 2000);
    const main = duct(p(0, 0), p(4000, 0), { diameter: 100 });
    duct(p(2000, 0), p(2000, 2000), { diameter: 100 });
    const sys = doc.transact("S", (tx) => createSystem(tx, doc, "supplyAir", [unit.id, d1.id, d2.id]));
    const flows = ductFlows(doc, doc.require(sys.id) as MEPSystem);
    // Main split by the tee: 200 L/s from the unit to the tee, 100 beyond; the branch 100.
    const values = [...flows.values()].sort((a, b) => a - b);
    expect(values).toEqual([100, 100, 200]);
    expect(flows.get(main.id)).toBe(200);
    const n = doc.transact("Size", (tx) => sizeDucts(tx, doc, sys.id, { velocity: 5 }));
    expect(n).toBe(3);
    // 200 L/s at 5 m/s needs Ø226 → 250; 100 L/s needs Ø160 → 175.
    expect((doc.require(main.id) as Duct).params.diameter).toBe(250);
    expect(ducts(doc).map((d) => d.params.diameter).sort((a, b) => a - b)).toEqual([175, 175, 250]);
  });
});
