import { beforeAll, describe, expect, it } from "vitest";
import {
  Cat,
  Document,
  applyResidentialTemplate,
  createDoor,
  createLevel,
  createWall,
  levels,
  type DirectShapeParams,
  type Vec2,
} from "@open-bim/core";
import { SimpleKernel, boundingBox } from "@open-bim/geometry";
import { createIfcApi, exportIfc, importIfc, type IfcApi } from "../src/index.ts";

let api: IfcApi;
beforeAll(async () => {
  api = await createIfcApi();
}, 60_000);

function source() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const pts: Vec2[] = [
    { x: 0, y: 0 },
    { x: 8000, y: 0 },
    { x: 8000, y: 6000 },
    { x: 0, y: 6000 },
  ];
  const walls = doc.transact("Walls", (tx) =>
    pts.map((p, i) => createWall(tx, ids.wallTypes.exterior, p, pts[(i + 1) % 4]!, ids.levels.ground, { topLevelId: ids.levels.first })),
  );
  doc.transact("Upper", (tx) => createWall(tx, ids.wallTypes.interior, { x: 0, y: 3000 }, { x: 8000, y: 3000 }, ids.levels.first, { topLevelId: ids.levels.roof }));
  doc.transact("Door", (tx) => createDoor(tx, doc, ids.doorTypes.single810, walls[0]!.id, 2000));
  return doc;
}

describe("IFC import", () => {
  it("brings storeys in as levels and products as direct shapes in model mm, Z up", async () => {
    const text = exportIfc(source(), { timestamp: "t" });
    const doc = new Document();
    const r = await importIfc(doc, new TextEncoder().encode(text), api);
    expect(r.levelsCreated).toBe(3);
    expect(levels(doc).map((l) => l.params.elevation)).toEqual([0, 2700, 5400]);
    const shapes = doc.byCategory<DirectShapeParams>(Cat.DirectShape);
    expect(shapes).toHaveLength(r.shapes);
    expect(shapes.filter((s) => s.params.ifcClass === "IfcWall")).toHaveLength(5);
    expect(shapes.filter((s) => s.params.ifcClass === "IfcDoor")).toHaveLength(1);

    // The south wall comes back where it was: 8 m long along X, 2.7 m tall from z = 0.
    const k = new SimpleKernel();
    const boxes = shapes.filter((s) => s.params.ifcClass === "IfcWall").map((s) => boundingBox(k.build(doc, s)!));
    const south = boxes.find((b) => b.max[0] - b.min[0] > 7000 && b.max[1] < 200)!;
    expect(south.min[2]).toBeCloseTo(0, 0);
    expect(south.max[2]).toBeCloseTo(2700, 0);
    // The first-floor wall is on the first-floor level.
    const upper = shapes.find((s) => s.params.ifcClass === "IfcWall" && s.params.levelId === levels(doc)[1]!.id);
    expect(upper).toBeDefined();
    // Properties and quantities are flattened.
    const wall = shapes.find((s) => s.params.ifcClass === "IfcWall")!;
    expect(wall.params.globalId).toHaveLength(22);
    expect(wall.params.properties["Pset_WallCommon.Reference"]).toBeDefined();
    expect(Number(wall.params.properties["Qto_WallBaseQuantities.Length"])).toBeGreaterThan(5000);
    // One undo removes the whole import.
    doc.undo();
    expect(doc.all()).toHaveLength(0);
  });

  it("reuses levels at matching elevations", async () => {
    const text = exportIfc(source(), { timestamp: "t" });
    const doc = new Document();
    doc.transact("L", (tx) => createLevel(tx, "GF", 0));
    const r = await importIfc(doc, new TextEncoder().encode(text), api);
    expect(r.levelsCreated).toBe(2);
    expect(levels(doc).map((l) => l.name)).toEqual(["GF", "First Floor", "Roof"]);
  });
});
