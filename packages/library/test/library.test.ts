import { beforeAll, describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createDetailComponent,
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
} from "@open-bim/core";
import { OcctKernel, SimpleKernel, boundingBox, buildDetailComponentLines, meshVolume } from "@open-bim/geometry";
import { LIBRARY, baseCabinet, casementWindow, roundTable } from "../src/index.ts";

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
});
