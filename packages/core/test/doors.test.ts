import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createDoor,
  createWall,
  createWindow,
  wallCuts,
  type ChangeSet,
  type DoorTypeParams,
  type Vec2,
} from "../src/index.ts";

const p = (x: number, y: number): Vec2 => ({ x, y });

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const wall = doc.transact("W", (tx) =>
    createWall(tx, ids.wallTypes.exterior, p(0, 0), p(5000, 0), ids.levels.ground, { topLevelId: ids.levels.first }),
  );
  const changes: ChangeSet[] = [];
  doc.on((c) => changes.push(c));
  return { doc, ids, wall, changes };
}

describe("doors and windows", () => {
  it("cut openings sized by their type", () => {
    const { doc, ids, wall } = setup();
    const d = doc.transact("D", (tx) => createDoor(tx, doc, ids.doorTypes.single810, wall.id, 1000));
    const w = doc.transact("W", (tx) => createWindow(tx, doc, ids.windowTypes.w1800x1200, wall.id, 3500));
    expect(w.params.sillHeight).toBe(900); // type default
    expect(wallCuts(doc, wall)).toEqual([
      { id: d.id, u0: 1000 - 435, u1: 1000 + 435, z0: 0, z1: 2010 },
      { id: w.id, u0: 2600, u1: 4400, z0: 900, z1: 2100 },
    ]);
  });

  it("changing a type regenerates the host wall of every instance", () => {
    const { doc, ids, wall, changes } = setup();
    const d = doc.transact("D", (tx) => createDoor(tx, doc, ids.doorTypes.single810, wall.id, 1000));
    doc.transact("Wider", (tx) => tx.update<DoorTypeParams>(ids.doorTypes.single810, { leafWidth: 910 }));
    expect(changes.at(-1)!.regenerate).toEqual(expect.arrayContaining([d.id, wall.id]));
    expect(wallCuts(doc, wall)[0]!.u1 - wallCuts(doc, wall)[0]!.u0).toBe(970);
  });

  it("must fit their host, and go with it", () => {
    const { doc, ids, wall } = setup();
    expect(() => doc.transact("D", (tx) => createDoor(tx, doc, ids.doorTypes.single860, wall.id, 200))).toThrow(/past the end/);
    expect(() =>
      doc.transact("W", (tx) => createWindow(tx, doc, ids.windowTypes.w1200x1200, wall.id, 2000, { sillHeight: 2000 })),
    ).toThrow(/taller/);
    const d = doc.transact("D", (tx) => createDoor(tx, doc, ids.doorTypes.single860, wall.id, 2000));
    doc.transact("Delete", (tx) => tx.delete(wall.id));
    expect(doc.has(d.id)).toBe(false);
  });

  it("deleting a type deletes its instances and their cuts", () => {
    const { doc, ids, wall } = setup();
    doc.transact("W", (tx) => createWindow(tx, doc, ids.windowTypes.w600x600, wall.id, 2000));
    doc.transact("Delete type", (tx) => tx.delete(ids.windowTypes.w600x600));
    expect(wallCuts(doc, wall)).toEqual([]);
  });
});
