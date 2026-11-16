import { beforeAll, describe, expect, it } from "vitest";
import {
  Cat,
  Document,
  applyResidentialTemplate,
  createBeam,
  createCeiling,
  createColumn,
  createDoor,
  createDuct,
  createFloor,
  createRoof,
  createStair,
  createStairRailings,
  createWall,
  createWindow,
  enableDuctFittings,
  ensureDuctTypes,
  ensureRailingType,
  ensureStairType,
  ensureStructuralTypes,
  loadFamily,
  familyTypeNames,
  placeFamilyInstance,
  type DirectShapeParams,
  type Vec2,
} from "@open-bim/core";
import { LIBRARY } from "@open-bim/library";
import { convertDirectShapes, convertible } from "@open-bim/geometry";
import { createIfcApi, exportIfc, importIfc, type IfcApi } from "../src/index.ts";

let api: IfcApi;
beforeAll(async () => {
  api = await createIfcApi();
}, 60_000);

const p = (x: number, y: number): Vec2 => ({ x, y });

describe("IFC round trip of a whole house", () => {
  it("converts back to native elements, leaving little as shapes", async () => {
    const src = new Document();
    const ids = applyResidentialTemplate(src);
    enableDuctFittings(src);
    const pts = [p(0, 0), p(10000, 0), p(10000, 8000), p(0, 8000)];
    const types = src.transact("T", (tx) => ensureStructuralTypes(tx, src));
    const rect = types.find((t) => (src.require(t).params as { shape: string }).shape === "rect")!;
    src.transact("House", (tx) => {
      const w = pts.map((q, i) => createWall(tx, ids.wallTypes.exterior, q, pts[(i + 1) % 4]!, ids.levels.ground, { topLevelId: ids.levels.first }));
      createWall(tx, ids.wallTypes.interior, p(5000, 0), p(5000, 8000), ids.levels.ground, { topLevelId: ids.levels.first });
      createDoor(tx, src, ids.doorTypes.single860, w[0]!.id, 2500);
      createWindow(tx, src, ids.windowTypes.w1200x1200, w[2]!.id, 3000);
      createFloor(tx, ids.floorTypes.slab, ids.levels.ground, pts);
      createCeiling(tx, src.byCategory("CeilingType")[0]!.id, ids.levels.ground, pts, { offset: 2400 });
      createRoof(tx, ids.roofTypes.steel, ids.levels.first, [p(-500, -500), p(10500, -500), p(10500, 8500), p(-500, 8500)], { slopes: [0.44, 0.44, 0.44, 0.44] });
      const st = createStair(tx, src, ensureStairType(tx, src), ids.levels.ground, ids.levels.first, [{ start: p(6000, 6000), end: p(9600, 6000) }]);
      createStairRailings(tx, src, ensureRailingType(tx, src), st);
      createColumn(tx, src, rect, ids.levels.ground, ids.levels.first, p(2500, 4000));
      createBeam(tx, src, rect, ids.levels.first, p(500, 4000), p(4500, 4000));
      const [round] = ensureDuctTypes(tx, src);
      createDuct(tx, src, round!, ids.levels.ground, { x: 1000, y: 1000, z: 2600 }, { x: 4000, y: 1000, z: 2600 }, { diameter: 200 });
    });
    const chair = src.transact("L", (tx) => loadFamily(tx, src, LIBRARY.find((f) => f.category === "Furniture")!.build(), "Chair"));
    src.transact("P", (tx) => placeFamilyInstance(tx, src, chair.id, familyTypeNames(chair)[0]!, { levelId: ids.levels.ground, position: p(2000, 2000) }));
    const doc = new Document();
    enableDuctFittings(doc);
    await importIfc(doc, new TextEncoder().encode(exportIfc(src, { timestamp: "t" })), api);
    const shapes = doc.byCategory(Cat.DirectShape).filter((d) => convertible(d)).map((d) => d.id);
    doc.transact("C", (tx) => convertDirectShapes(tx, doc, shapes));
    const left = doc.byCategory<DirectShapeParams>(Cat.DirectShape).map((d) => d.params.ifcClass);
    const count = (c: string) => doc.byCategory(c).length;
    expect(count("Wall")).toBe(5);
    expect(count("Door")).toBe(1);
    expect(count("Window")).toBe(1);
    expect(count("Roof")).toBe(1);
    expect(count("Stair")).toBe(1);
    expect(count("Railing")).toBe(2);
    expect(left).toEqual([]);
    expect(count("Column")).toBe(1);
    expect(count("Beam")).toBe(1);
    expect(count("Duct")).toBe(1);
  });
});
