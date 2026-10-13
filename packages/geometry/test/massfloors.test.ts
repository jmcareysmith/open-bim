import { describe, expect, it } from "vitest";
import {
  Document,
  applyFamilyTemplate,
  applyResidentialTemplate,
  createExtrusion,
  createSchedule,
  isMass,
  loadFamily,
  massFloors,
  placeFamilyInstance,
  setMassFloors,
  type MassFloor,
  type ScheduleParams,
  type Schedule,
} from "@open-bim/core";
import { massFloorArea, massTotals, scheduleTable, SimpleKernel } from "../src/index.ts";

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  // An L-shaped mass, 6 m tall: 10 × 4 plus 4 × 6, so 64 m² per floor.
  const fam = new Document();
  applyFamilyTemplate(fam, "Mass", "L Mass");
  fam.transact("L", (tx) =>
    createExtrusion(
      tx,
      [
        { x: 0, y: 0 },
        { x: 10000, y: 0 },
        { x: 10000, y: 4000 },
        { x: 4000, y: 4000 },
        { x: 4000, y: 10000 },
        { x: 0, y: 10000 },
      ],
      { end: 6000 },
    ),
  );
  const def = doc.transact("Load", (tx) => loadFamily(tx, doc, fam, "L Mass"));
  const mass = doc.transact("Place", (tx) => placeFamilyInstance(tx, doc, def.id, "Default", { levelId: ids.levels.ground, position: { x: 0, y: 0 } }));
  return { doc, ids, mass };
}

describe("mass floors", () => {
  it("slice the mass at each chosen level for area and perimeter", () => {
    const { doc, ids, mass } = setup();
    expect(isMass(doc, mass)).toBe(true);
    doc.transact("Floors", (tx) => setMassFloors(tx, doc, mass.id, [ids.levels.ground, ids.levels.first, ids.levels.roof]));
    // The roof level (5400) is inside the 6 m mass too.
    const floors = massFloors(doc, mass.id);
    expect(floors).toHaveLength(3);
    const a = massFloorArea(doc, floors[0] as MassFloor);
    expect(a.area).toBeCloseTo(64e6, -3);
    expect(a.perimeter).toBeCloseTo(40000, 0);
    expect(massTotals(doc, mass.id).floorArea).toBeCloseTo(3 * 64e6, -3);
    expect(massTotals(doc, mass.id).volume).toBeCloseTo(64e6 * 6000, -6);
    // Turning a level off removes its floor.
    doc.transact("Floors", (tx) => setMassFloors(tx, doc, mass.id, [ids.levels.ground]));
    expect(massFloors(doc, mass.id)).toHaveLength(1);
    expect(new SimpleKernel().buildLines(doc, massFloors(doc, mass.id)[0]!)!.segments.length).toBe(6 * 6);
  });

  it("list in a Mass Floors schedule with a gross total", () => {
    const { doc, ids, mass } = setup();
    doc.transact("Floors", (tx) => setMassFloors(tx, doc, mass.id, [ids.levels.ground, ids.levels.first]));
    let s = doc.transact("S", (tx) => createSchedule(tx, doc, "MassFloor"));
    doc.transact("Totals", (tx) => tx.update<ScheduleParams>(s.id, { grandTotals: true }));
    s = doc.require(s.id) as Schedule;
    const t = scheduleTable(doc, s);
    expect(t.headings).toEqual(["Mass", "Level", "Floor Area", "Floor Perimeter"]);
    expect(t.rows.filter((r) => r.kind === "row").map((r) => r.cells[0])).toEqual(["L Mass", "L Mass"]);
    expect(t.rows.at(-1)!.values[2]).toBeCloseTo(128, 1);
  });

  it("go when their mass is deleted", () => {
    const { doc, ids, mass } = setup();
    doc.transact("Floors", (tx) => setMassFloors(tx, doc, mass.id, [ids.levels.ground]));
    doc.transact("Delete", (tx) => tx.delete(mass.id));
    expect(massFloors(doc)).toHaveLength(0);
  });
});
