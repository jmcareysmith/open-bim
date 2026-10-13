import { beforeAll, describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createDetailComponent,
  createSection,
  markerRole,
  type ViewParams,
  createWall,
  familyFile,
  familyInfo,
  familyTypeNames,
  loadFamily,
  placeFamilyInstance,
  readFamilyFile,
  views,
  wallCuts,
  type FamilyInstance,
  graphicsCategory,
  createDuct,
  createSystem,
  ductFlows,
  elementConnectors,
  enableMepFittings,
  ensureDuctTypes,
  sizeDucts,
  type Duct,
  type MEPSystem,
} from "@open-bim/core";
import { OcctKernel, SimpleKernel, boundingBox, buildDetailComponentLines, buildViewMarker, meshVolume } from "@open-bim/geometry";
import { LIBRARY, baseCabinet, casementWindow, ductedIndoorUnit, massGable, roundTable, supplyDiffuser } from "../src/index.ts";

let occt: OcctKernel;
beforeAll(async () => {
  occt = await OcctKernel.create();
}, 60_000);

function project() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  return { doc, ids };
}

describe("family library", () => {
  it.each(LIBRARY.map((f) => [f.name, f] as const))("%s: every type builds a solid and survives its file format", (_name, lib) => {
    const fam = lib.build();
    expect(familyInfo(fam)!.params.category).toBe(lib.category);
    const back = readFamilyFile(JSON.parse(JSON.stringify(familyFile(fam))));
    expect(back.toJSON()).toEqual(fam.toJSON());

    const { doc, ids } = project();
    const def = doc.transact("Load", (tx) => loadFamily(tx, doc, back, lib.name));
    if (lib.category === "ViewMarker") {
      // Drawn by the views that pick it: a section with this family as its head or tail.
      const role = markerRole(def)!;
      expect(["elevation", "sectionHead", "sectionTail", "calloutHead"]).toContain(role);
      const sec = doc.transact("S", (tx) => createSection(tx, doc, { x: 0, y: 0 }, { x: 5000, y: 0 }, { name: "Section 7" }));
      if (role === "sectionHead" || role === "sectionTail") {
        doc.transact("Pick", (tx) => tx.update<ViewParams>(sec.id, role === "sectionHead" ? { headFamilyId: def.id } : { tailFamilyId: def.id }));
        const lines = buildViewMarker(doc, doc.require(sec.id))!;
        if (role === "sectionHead") expect(lines.labels.map((l) => l.text)).toContain("7");
      }
      expect(() => doc.transact("P", (tx) => placeFamilyInstance(tx, doc, def.id, "Default", { levelId: ids.levels.ground }))).toThrow(/view marker/);
      return;
    }
    if (lib.category === "DetailItem") {
      // 2D: placed in a view as a detail component; it must draw something.
      const plan = views(doc).find((v) => v.params.kind === "floorPlan")!;
      const d = doc.transact("P", (tx) => createDetailComponent(tx, doc, plan.id, def.id, { x: 0, y: 0 }));
      expect(buildDetailComponentLines(doc, d)!.segments.length).toBeGreaterThan(0);
      expect(() => doc.transact("P", (tx) => placeFamilyInstance(tx, doc, def.id, "Default", { levelId: ids.levels.ground }))).toThrow(/detail item/);
      return;
    }
    const k = new SimpleKernel();
    for (const type of familyTypeNames(def)) {
      let inst: FamilyInstance;
      if (def.params.hosting === "wall") {
        const wall = doc.transact("W", (tx) =>
          createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 5000, y: 0 }, ids.levels.ground, { topLevelId: ids.levels.first }),
        );
        inst = doc.transact("P", (tx) => placeFamilyInstance(tx, doc, def.id, type, { hostId: wall.id, along: 2500 }));
        expect(wallCuts(doc, wall)).toHaveLength(1);
      } else {
        inst = doc.transact("P", (tx) => placeFamilyInstance(tx, doc, def.id, type, { levelId: ids.levels.ground }));
      }
      const mesh = k.build(doc, inst)!;
      expect(meshVolume(mesh)).toBeGreaterThan(0);
    }
  });

  it("windows sit at their type's default sill", () => {
    const { doc, ids } = project();
    const def = doc.transact("Load", (tx) => loadFamily(tx, doc, casementWindow.build(), "Window"));
    const wall = doc.transact("W", (tx) =>
      createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 5000, y: 0 }, ids.levels.ground, { topLevelId: ids.levels.first }),
    );
    const small = doc.transact("P", (tx) => placeFamilyInstance(tx, doc, def.id, "600 x 600", { hostId: wall.id, along: 1000 }));
    const big = doc.transact("P", (tx) => placeFamilyInstance(tx, doc, def.id, "1800 x 1200", { hostId: wall.id, along: 3500 }));
    expect([small.params.sillHeight, big.params.sillHeight]).toEqual([1500, 900]);
    expect(boundingBox(new SimpleKernel().build(doc, big)!).min[2]).toBeCloseTo(900);
  });

  it("the cabinet's toe kick is a void (cut with OpenCascade)", () => {
    const { doc, ids } = project();
    const def = doc.transact("Load", (tx) => loadFamily(tx, doc, baseCabinet.build(), "Cabinet"));
    const inst = doc.transact("P", (tx) => placeFamilyInstance(tx, doc, def.id, "600", { levelId: ids.levels.ground }));
    const solid = meshVolume(new SimpleKernel().build(doc, inst)!);
    const cut = meshVolume(occt.build(doc, inst)!);
    expect(solid - cut).toBeCloseTo(600 * 60 * 100, -3);
  });

  it("the round table is one revolved profile", () => {
    const { doc, ids } = project();
    const def = doc.transact("Load", (tx) => loadFamily(tx, doc, roundTable.build(), "Round"));
    const inst = doc.transact("P", (tx) => placeFamilyInstance(tx, doc, def.id, "900", { levelId: ids.levels.ground }));
    const bb = boundingBox(new SimpleKernel().build(doc, inst)!);
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(900, -1);
    expect(bb.max[2]).toBeCloseTo(750);
  });

  it("masses build to their parameters and show as the Mass category", () => {
    const { doc, ids } = project();
    const def = doc.transact("Load", (tx) => loadFamily(tx, doc, massGable.build(), "Gable"));
    const inst = doc.transact("P", (tx) => placeFamilyInstance(tx, doc, def.id, familyTypeNames(def)[0]!, { levelId: ids.levels.ground }));
    const mesh = new SimpleKernel().build(doc, inst)!;
    const bb = boundingBox(mesh);
    expect(bb.max[2]).toBeCloseTo(5400);
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(8000);
    // Walls to the eaves plus the gable triangle, through the depth.
    expect(meshVolume(mesh)).toBeCloseTo((12000 * 2700 + (12000 * 2700) / 2) * 8000, -6);
    expect(graphicsCategory(doc, inst)).toBe("Mass");
  });

  it("an indoor unit and two diffusers: connectors line up, ducts join them, sizing works", () => {
    const { doc, ids } = project();
    enableMepFittings(doc);
    const unitDef = doc.transact("Load", (tx) => loadFamily(tx, doc, ductedIndoorUnit.build(), "Unit"));
    const diffDef = doc.transact("Load", (tx) => loadFamily(tx, doc, supplyDiffuser.build(), "Diffuser"));
    const unit = doc.transact("P", (tx) => placeFamilyInstance(tx, doc, unitDef.id, "7 kW", { levelId: ids.levels.ground, position: { x: 0, y: 0 }, offset: 2500 }));
    const place = (x: number) => doc.transact("P", (tx) => placeFamilyInstance(tx, doc, diffDef.id, "600 x 600 - 250 neck", { levelId: ids.levels.ground, position: { x, y: 0 }, offset: 2400 }));
    const d1 = place(3000);
    const d2 = place(6000);
    const supply = elementConnectors(doc, unit).find((c) => c.classification === "supplyAir")!;
    expect(supply.position).toEqual([550, 0, 2640]);
    expect(elementConnectors(doc, unit)).toHaveLength(4);
    const neck = elementConnectors(doc, d1)[0]!;
    expect(neck.position).toEqual([3000, 0, 2550]);
    expect(neck.flow).toBe(100);
    // Duct from the unit's supply along to above each diffuser, then drops to their necks.
    const [round] = doc.transact("Types", (tx) => ensureDuctTypes(tx, doc));
    const duct = (a: [number, number, number], b: [number, number, number]) =>
      doc.transact("D", (tx) => createDuct(tx, doc, round!, ids.levels.ground, { x: a[0], y: a[1], z: a[2] }, { x: b[0], y: b[1], z: b[2] }, { diameter: 200 }));
    const main = duct([550, 0, 2640], [6000, 0, 2640]);
    duct([3000, 0, 2640], [3000, 0, 2550]);
    duct([6000, 0, 2640], [6000, 0, 2550]);
    const sys = doc.transact("S", (tx) => createSystem(tx, doc, "supplyAir", [unit.id, d1.id, d2.id]));
    const flows = ductFlows(doc, doc.require(sys.id) as MEPSystem);
    expect(flows.get(main.id)).toBe(200);
    doc.transact("Size", (tx) => sizeDucts(tx, doc, sys.id, { velocity: 4 }));
    // 200 L/s at 4 m/s: Ø252 → 300.
    expect((doc.require(main.id) as Duct).params.diameter).toBe(300);
    void d2;
  });
});
