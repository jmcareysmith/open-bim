import { describe, expect, it } from "vitest";
import {
  Document,
  addToSystem,
  applyFamilyTemplate,
  applyResidentialTemplate,
  connectableClassifications,
  createConnector,
  createSystem,
  elementConnectors,
  loadFamily,
  placeFamilyInstance,
  removeFromSystem,
  systemTotals,
  systemsOf,
  type FamilyInstance,
  type MEPSystem,
} from "../src/index.ts";

/** A ceiling diffuser: one supply air connector on top, flow from a parameter. */
function diffuser(project: Document) {
  const fam = new Document();
  applyFamilyTemplate(fam, "AirTerminal", "Diffuser");
  fam.transact("Connector", (tx) =>
    createConnector(tx, { classification: "supplyAir", x: "Width/2", y: 0, z: 50, facing: "+x", diameter: 200, flow: "Width / 10", flowDirection: "in" }),
  );
  return project.transact("Load", (tx) => loadFamily(tx, project, fam, "Diffuser"));
}

/** A fan coil unit: supply out, return in, and a power connector. */
function fanCoil(project: Document) {
  const fam = new Document();
  applyFamilyTemplate(fam, "MechanicalEquipment", "Fan coil");
  fam.transact("Connectors", (tx) => {
    createConnector(tx, { classification: "supplyAir", flow: 300, flowDirection: "out" });
    createConnector(tx, { classification: "returnAir", flow: 300, flowDirection: "in" });
    createConnector(tx, { classification: "power", load: 450 });
  });
  return project.transact("Load", (tx) => loadFamily(tx, project, fam, "Fan coil"));
}

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const place = (familyId: string, x: number, rotation = 0) =>
    doc.transact("Place", (tx) => placeFamilyInstance(tx, doc, familyId, "Default", { levelId: ids.levels.ground, position: { x, y: 0 }, rotation, offset: 2400 })) as FamilyInstance;
  return { doc, place };
}

describe("MEP connectors", () => {
  it("places family connectors in the model with the instance's position, rotation and parameters", () => {
    const { doc, place } = setup();
    const d = diffuser(doc);
    const a = place(d.id, 1000, Math.PI / 2);
    const [c] = elementConnectors(doc, a);
    // Width 600: the connector at x = 300 in the family, turned 90°.
    expect(c!.position[0]).toBeCloseTo(1000);
    expect(c!.position[1]).toBeCloseTo(300);
    expect(c!.position[2]).toBeCloseTo(2450);
    expect(c!.direction[0]).toBeCloseTo(0);
    expect(c!.direction[1]).toBeCloseTo(1);
    expect(c!.flow).toBeCloseTo(60);
    expect(c!.domain).toBe("duct");
    expect(connectableClassifications(doc, a)).toEqual(["supplyAir"]);
  });
});

describe("MEP systems", () => {
  it("group elements by classification and total their flow and load", () => {
    const { doc, place } = setup();
    const d = diffuser(doc);
    const f = fanCoil(doc);
    const t1 = place(d.id, 0);
    const t2 = place(d.id, 2000);
    const fcu = place(f.id, 5000);
    const sa = doc.transact("System", (tx) => createSystem(tx, doc, "supplyAir", [fcu.id, t1.id, t2.id]));
    expect(sa.name).toBe("Supply Air 1");
    // Terminals draw 60 + 60 L/s; the fan coil's supply (out) isn't counted on top.
    expect(systemTotals(doc, doc.require(sa.id) as MEPSystem)).toMatchObject({ members: 3, flow: 120 });
    const pw = doc.transact("Power", (tx) => createSystem(tx, doc, "power", [fcu.id]));
    expect(systemTotals(doc, doc.require(pw.id) as MEPSystem).load).toBe(450);
    expect(systemsOf(doc, fcu.id).map((s) => s.name)).toEqual(["Supply Air 1", "Power 1"]);
  });

  it("refuses elements without a matching connector or already in a system of that kind", () => {
    const { doc, place } = setup();
    const d = diffuser(doc);
    const t1 = place(d.id, 0);
    const t2 = place(d.id, 2000);
    expect(() => doc.transact("S", (tx) => createSystem(tx, doc, "coldWater", [t1.id]))).toThrow(/no cold water connector/);
    const s = doc.transact("S", (tx) => createSystem(tx, doc, "supplyAir", [t1.id]));
    expect(() => doc.transact("S2", (tx) => createSystem(tx, doc, "supplyAir", [t1.id]))).toThrow(/already in Supply Air 1/);
    doc.transact("Add", (tx) => addToSystem(tx, doc, s.id, [t2.id]));
    expect((doc.require(s.id) as MEPSystem).params.memberIds).toEqual([t1.id, t2.id]);
    doc.transact("Remove", (tx) => removeFromSystem(tx, doc, s.id, [t1.id]));
    expect((doc.require(s.id) as MEPSystem).params.memberIds).toEqual([t2.id]);
    // Deleted members drop out of the totals.
    doc.transact("Delete", (tx) => tx.delete(t2.id));
    expect(systemTotals(doc, doc.require(s.id) as MEPSystem).members).toBe(0);
  });
});
