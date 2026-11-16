import { describe, expect, it } from "vitest";
import { Cat, Document, applyResidentialTemplate, createDoor, createWall, pasteSamePlace, pasteToLevel, wallExtent, type Wall } from "../src/index.ts";

describe("paste aligned", () => {
  it("same place copies; to a level keeps offsets, moves the top constraint up and brings hosted doors", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const w = doc.transact("W", (tx) => createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 4000, y: 0 }, ids.levels.ground, { topLevelId: ids.levels.first }));
    doc.transact("D", (tx) => createDoor(tx, doc, ids.doorTypes.single860, w.id, 2000));
    const same = doc.transact("P", (tx) => pasteSamePlace(tx, doc, [w.id]));
    expect(same).toHaveLength(1);
    const up = doc.transact("P", (tx) => pasteToLevel(tx, doc, [w.id], ids.levels.first));
    const copy = doc.require(up[0]!) as Wall;
    expect(copy.params.baseLevelId).toBe(ids.levels.first);
    const a = wallExtent(doc, doc.require(w.id) as Wall);
    const b = wallExtent(doc, copy);
    const dz = doc.require<{ elevation: number }>(ids.levels.first).params.elevation - doc.require<{ elevation: number }>(ids.levels.ground).params.elevation;
    expect(b.bottom - a.bottom).toBeCloseTo(dz);
    expect(b.top - b.bottom).toBeCloseTo(a.top - a.bottom);
    // Doors came along.
    expect(doc.byCategory(Cat.Door).filter((d) => (d.params as { hostId: string }).hostId === copy.id)).toHaveLength(1);
  });
});
