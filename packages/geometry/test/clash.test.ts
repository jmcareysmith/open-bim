import { beforeAll, describe, expect, it } from "vitest";
import { Document, applyResidentialTemplate, createBeam, createDoor, createFloor, createWall, ensureStructuralTypes } from "@open-bim/core";
import { OcctKernel, findClashes } from "../src/index.ts";

let occt: OcctKernel;
beforeAll(async () => {
  occt = await OcctKernel.create();
}, 60_000);

describe("clash detection", () => {
  it("finds a beam through a wall, ignores touching and hosted elements", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const wall = doc.transact("W", (tx) => createWall(tx, ids.wallTypes.interior, { x: 0, y: 0 }, { x: 4000, y: 0 }, ids.levels.ground, { topLevelId: ids.levels.first }));
    // A slab the wall stands on (touching only), and a door in the wall (hosted).
    doc.transact("F", (tx) => createFloor(tx, ids.floorTypes.slab, ids.levels.ground, [
      { x: -1000, y: -1000 },
      { x: 5000, y: -1000 },
      { x: 5000, y: 1000 },
      { x: -1000, y: 1000 },
    ]));
    doc.transact("D", (tx) => createDoor(tx, doc, ids.doorTypes.single810, wall.id, 2000));
    // A beam passing through the wall below the first floor.
    const types = doc.transact("T", (tx) => ensureStructuralTypes(tx, doc));
    const ub = types.find((t) => doc.require(t).name === "Steel 200UB25")!;
    const beam = doc.transact("B", (tx) => createBeam(tx, doc, ub, ids.levels.first, { x: 1000, y: -1500 }, { x: 1000, y: 1500 }));
    const clashes = findClashes(doc, occt, { a: ["Beam", "Wall", "Floor", "Door"], b: ["Beam", "Wall", "Floor", "Door"] });
    expect(clashes).toHaveLength(1);
    expect(new Set([clashes[0]!.a, clashes[0]!.b])).toEqual(new Set([beam.id, wall.id]));
    expect(clashes[0]!.exact).toBe(true);
    // 200UB section area × wall thickness (110).
    const area = 2 * 133 * 7.8 + (203 - 2 * 7.8) * 5.8;
    expect(clashes[0]!.volume).toBeCloseTo(area * 110, -3);
  }, 60_000);
});
