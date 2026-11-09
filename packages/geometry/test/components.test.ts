import { describe, expect, it } from "vitest";
import {
  Document,
  applyFamilyTemplate,
  applyResidentialTemplate,
  createExtrusion,
  createFamilyParameter,
  createFamilyType,
  levels,
  loadFamily,
  setFamilyValue,
  placeFamilyInstance,
  type NumPt,
} from "@open-bim/core";
import { SimpleKernel, boundingBox, meshVolume } from "../src/index.ts";

const rect = (x0: string | number, y0: string | number, x1: string | number, y1: string | number): NumPt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

describe("family instance geometry", () => {
  it("shows forms by detail level and in plans as their visibility says", () => {
    const fam = new Document();
    applyFamilyTemplate(fam, "Furniture");
    const box = (x: number) => fam.transact("E", (tx) => createExtrusion(tx, rect(x, 0, x + 100, 100), { end: 100 }));
    box(0);
    const fine = box(200);
    const notPlan = box(400);
    fam.transact("V", (tx) => {
      tx.update(fine.id, { visibility: { coarse: false, medium: false } });
      tx.update(notPlan.id, { visibility: { plan: false } });
    });
    const project = new Document();
    const ids = applyResidentialTemplate(project);
    const def = project.transact("Load", (tx) => loadFamily(tx, project, fam, "Thing"));
    const inst = project.transact("Place", (tx) => placeFamilyInstance(tx, project, def.id, "Default", { levelId: ids.levels.ground, position: { x: 0, y: 0 } }));
    const k = new SimpleKernel();
    const vol = (d?: { detail: "coarse" | "medium" | "fine"; plan: boolean }) => meshVolume(k.build(project, inst, d)!) / 1e6;
    expect(vol()).toBeCloseTo(3);
    expect(vol({ detail: "fine", plan: false })).toBeCloseTo(3);
    expect(vol({ detail: "medium", plan: false })).toBeCloseTo(2);
    expect(vol({ detail: "medium", plan: true })).toBeCloseTo(1);
    expect(vol({ detail: "fine", plan: true })).toBeCloseTo(2);
    // Front/back only forms: hidden when a section looks at a side (along the family's X).
    fam.transact("V2", (tx) => tx.update(notPlan.id, { visibility: { leftRight: false } }));
    const def2 = project.transact("Load2", (tx) => loadFamily(tx, project, fam, "Thing 2"));
    const inst2 = project.transact("Place2", (tx) => placeFamilyInstance(tx, project, def2.id, "Default", { levelId: ids.levels.ground, position: { x: 0, y: 0 } }));
    const side = (viewDir: { x: number; y: number }) => meshVolume(k.build(project, inst2, { detail: "fine", plan: false, viewDir })!) / 1e6;
    expect(side({ x: 0, y: 1 })).toBeCloseTo(3); // looking at its front
    expect(side({ x: 1, y: 0 })).toBeCloseTo(2); // looking at its side
  });

  it("places the family mesh on its level, rotated", () => {
    const fam = new Document();
    applyFamilyTemplate(fam, "Furniture");
    fam.transact("Top", (tx) => createExtrusion(tx, rect("-Width/2", 0, "Width/2", "Depth"), { start: "Height - 30", end: "Height" }));
    const project = new Document();
    const ids = applyResidentialTemplate(project);
    const def = project.transact("Load", (tx) => loadFamily(tx, project, fam, "Table"));
    const inst = project.transact("Place", (tx) =>
      placeFamilyInstance(tx, project, def.id, "Default", { levelId: ids.levels.first, position: { x: 5000, y: 2000 }, rotation: Math.PI / 2 }),
    );
    const m = new SimpleKernel().build(project, inst)!;
    expect(meshVolume(m)).toBeCloseTo(1200 * 600 * 30, -2);
    const bb = boundingBox(m);
    // Rotated 90 degrees: width now runs along Y, depth towards -X.
    expect(bb.min[0]).toBeCloseTo(5000 - 600);
    expect(bb.max[0]).toBeCloseTo(5000);
    expect(bb.min[1]).toBeCloseTo(2000 - 600);
    expect(bb.max[1]).toBeCloseTo(2000 + 600);
    expect(bb.max[2]).toBeCloseTo(2700 + 750);
  });
});

describe("nested family geometry", () => {
  it("a table with four nested legs sized by host formulas, per host type", () => {
    const leg = new Document();
    applyFamilyTemplate(leg, "GenericModel", "Leg");
    leg.transact("P", (tx) => createFamilyParameter(tx, leg, "Height", { value: 700 }));
    leg.transact("E", (tx) => createExtrusion(tx, rect(-25, -25, 25, 25), { end: "Height" }));

    const table = new Document();
    applyFamilyTemplate(table, "Furniture", "Table");
    table.transact("Top", (tx) => createExtrusion(tx, rect("-Width/2", 0, "Width/2", "Depth"), { start: "Height - 30", end: "Height" }));
    const legDef = table.transact("Nest", (tx) => loadFamily(tx, table, leg, "Leg"));
    const lvl = levels(table)[0]!.id;
    for (const [x, y] of [[-550, 50], [550, 50], [-550, 550], [550, 550]] as const) {
      table.transact("Leg", (tx) => {
        const i = placeFamilyInstance(tx, table, legDef.id, "Default", { levelId: lvl, position: { x, y } });
        tx.update(i.id, { associations: { Height: "Height - 30" } });
      });
    }
    table.transact("T", (tx) => createFamilyType(tx, table, "Coffee"));
    table.transact("H", (tx) => setFamilyValue(tx, table, "Height", 450));

    const project = new Document();
    const ids = applyResidentialTemplate(project);
    const def = project.transact("Load", (tx) => loadFamily(tx, project, table, "Table"));
    const k = new SimpleKernel();
    const dining = project.transact("P", (tx) => placeFamilyInstance(tx, project, def.id, "Default", { levelId: ids.levels.ground }));
    const coffee = project.transact("P", (tx) => placeFamilyInstance(tx, project, def.id, "Coffee", { levelId: ids.levels.ground }));
    const legVol = (h: number) => 50 * 50 * h;
    expect(meshVolume(k.build(project, dining)!)).toBeCloseTo(1200 * 600 * 30 + 4 * legVol(720), -2);
    expect(meshVolume(k.build(project, coffee)!)).toBeCloseTo(1200 * 600 * 30 + 4 * legVol(420), -2);
    expect(boundingBox(k.build(project, coffee)!).max[2]).toBeCloseTo(450);
  });
});
