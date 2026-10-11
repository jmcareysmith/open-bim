import { describe, expect, it } from "vitest";
import {
  Document,
  applyFamilyTemplate,
  applyResidentialTemplate,
  createExtrusion,
  createFamilyType,
  createWall,
  familyTypeNames,
  instanceValues,
  loadFamily,
  placeFamilyInstance,
  setFamilyValue,
  wallCuts,
  type FamilyInstance,
  type NumPt,
} from "../src/index.ts";

const rect = (x0: string | number, y0: string | number, x1: string | number, y1: string | number): NumPt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

function table() {
  const fam = new Document();
  applyFamilyTemplate(fam, "Furniture");
  fam.transact("Top", (tx) => createExtrusion(tx, rect("-Width/2", 0, "Width/2", "Depth"), { start: "Height - 30", end: "Height" }));
  fam.transact("T", (tx) => createFamilyType(tx, fam, "1800 x 900"));
  fam.transact("W", (tx) => setFamilyValue(tx, fam, "Width", 1800));
  return fam;
}

describe("loading and placing families", () => {
  it("embeds the family with its types; placing uses type values plus overrides", () => {
    const project = new Document();
    const ids = applyResidentialTemplate(project);
    const def = project.transact("Load", (tx) => loadFamily(tx, project, table(), "Dining Table"));
    expect(familyTypeNames(def)).toEqual(["Default", "1800 x 900"]);
    const inst = project.transact("Place", (tx) =>
      placeFamilyInstance(tx, project, def.id, "1800 x 900", { levelId: ids.levels.ground, position: { x: 2000, y: 3000 }, overrides: { Height: 720 } }),
    );
    expect(instanceValues(project, inst)).toMatchObject({ Width: 1800, Depth: 600, Height: 720 });
    expect(() =>
      project.transact("Bad", (tx) => placeFamilyInstance(tx, project, def.id, "Nope", { levelId: ids.levels.ground })),
    ).toThrow(/no type "Nope"/);
  });

  it("reloading updates every instance and remaps missing types", () => {
    const project = new Document();
    const ids = applyResidentialTemplate(project);
    const fam = table();
    const def = project.transact("Load", (tx) => loadFamily(tx, project, fam, "Dining Table"));
    const inst = project.transact("Place", (tx) => placeFamilyInstance(tx, project, def.id, "1800 x 900", { levelId: ids.levels.ground }));
    const fresh = new Document();
    applyFamilyTemplate(fresh, "Furniture");
    const again = project.transact("Reload", (tx) => loadFamily(tx, project, fresh, "Dining Table"));
    expect(again.id).toBe(def.id);
    expect((project.require(inst.id) as FamilyInstance).params.typeName).toBe("Default");
  });

  it("wall-hosted families cut their wall by Width x Height and go with it", () => {
    const fam = new Document();
    applyFamilyTemplate(fam, "Door");
    const project = new Document();
    const ids = applyResidentialTemplate(project);
    const wall = project.transact("W", (tx) => createWall(tx, ids.wallTypes.interior, { x: 0, y: 0 }, { x: 4000, y: 0 }, ids.levels.ground, { height: 2400 }));
    const def = project.transact("Load", (tx) => loadFamily(tx, project, fam, "Panel Door"));
    expect(() => project.transact("P", (tx) => placeFamilyInstance(tx, project, def.id, "Default", { levelId: ids.levels.ground }))).toThrow(/in a wall/);
    const d = project.transact("P", (tx) => placeFamilyInstance(tx, project, def.id, "Default", { hostId: wall.id, along: 2000 }));
    expect(wallCuts(project, wall)).toEqual([{ id: d.id, u0: 2000 - 430, u1: 2000 + 430, z0: 0, z1: 1980 }]);
    project.transact("Delete wall", (tx) => tx.delete(wall.id));
    expect(project.has(d.id)).toBe(false);
  });
});
