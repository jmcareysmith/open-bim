import { describe, expect, it } from "vitest";
import {
  Cat,
  Document,
  applyResidentialTemplate,
  createDoor,
  createGroup,
  createRoom,
  createWall,
  groupInstances,
  groupMembers,
  moveGroup,
  placeGroup,
  syncGroupInstances,
  ungroup,
  type DoorParams,
  type RoomParams,
  type Vec2,
  type WallParams,
} from "../src/index.ts";

function unit() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const pts: Vec2[] = [
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 4000, y: 3000 },
    { x: 0, y: 3000 },
  ];
  const walls = doc.transact("Walls", (tx) =>
    pts.map((p, i) => createWall(tx, ids.wallTypes.interior, p, pts[(i + 1) % 4]!, ids.levels.ground, { topLevelId: ids.levels.first })),
  );
  const door = doc.transact("Door", (tx) => createDoor(tx, doc, ids.doorTypes.single810, walls[0]!.id, 2000));
  const room = doc.transact("Room", (tx) => createRoom(tx, doc, ids.levels.ground, { x: 2000, y: 1500 }, { name: "Bedroom" }));
  return { doc, ids, walls, door, room };
}

describe("model groups", () => {
  it("group walls (with their doors) and rooms; place copies with remapped hosts", () => {
    const { doc, walls, room } = unit();
    const g = doc.transact("Group", (tx) => createGroup(tx, doc, [...walls.map((w) => w.id), room.id], "Bedroom Unit"));
    expect(g.params.origin).toEqual({ x: 2000, y: 1500 });
    expect(groupMembers(doc, g.id)).toHaveLength(6); // 4 walls, the door, the room

    const copy = doc.transact("Place", (tx) => placeGroup(tx, doc, g.id, { x: 12000, y: 1500 }));
    const members = groupMembers(doc, copy.id);
    expect(members).toHaveLength(6);
    const door = members.find((m) => m.category === Cat.Door)!;
    const host = doc.require<WallParams>((door.params as DoorParams).hostId);
    expect(members.map((m) => m.id)).toContain(host.id);
    expect(host.params.start).toEqual({ x: 10000, y: 0 });
    const r = members.find((m) => m.category === Cat.Room)!;
    expect((r.params as RoomParams).point).toEqual({ x: 12000, y: 1500 });
    expect(r.name).toBe("Bedroom");
  });

  it("move and rotate an instance; apply one instance's edits to the others", () => {
    const { doc, ids, walls, door } = unit();
    const g = doc.transact("Group", (tx) => createGroup(tx, doc, walls.map((w) => w.id)));
    const copy = doc.transact("Place", (tx) => placeGroup(tx, doc, g.id, { x: 2000, y: 11500 }, Math.PI / 2));
    // Rotated a quarter turn about its origin: the first wall now runs up.
    const w0 = groupMembers(doc, copy.id).find((m) => m.category === Cat.Wall && (m.params as WallParams).start.x === 3500)!;
    expect(w0).toBeDefined();
    doc.transact("Move", (tx) => moveGroup(tx, doc, g.id, { x: 2000, y: 2500 }));
    expect(doc.require<WallParams>(walls[0]!.id).params.start).toEqual({ x: 0, y: 1000 });

    // Edit the source: retype a wall and move the door, then apply to the copy.
    doc.transact("Edit", (tx) => {
      tx.setType(walls[0]!.id, ids.wallTypes.exterior);
      tx.update<DoorParams>(door.id, { position: 1000 });
    });
    expect(doc.transact("Apply", (tx) => syncGroupInstances(tx, doc, g.id))).toBe(1);
    const synced = groupMembers(doc, copy.id);
    expect(synced.filter((m) => m.typeId === ids.wallTypes.exterior)).toHaveLength(1);
    expect((synced.find((m) => m.category === Cat.Door)!.params as DoorParams).position).toBe(1000);
  });

  it("deleting a group deletes its members; ungrouping keeps them", () => {
    const { doc, walls } = unit();
    const g = doc.transact("Group", (tx) => createGroup(tx, doc, walls.map((w) => w.id)));
    const copy = doc.transact("Place", (tx) => placeGroup(tx, doc, g.id, { x: 12000, y: 1500 }));
    const before = doc.all().length;
    doc.transact("Delete", (tx) => tx.delete(copy.id));
    expect(doc.all().length).toBe(before - 6); // group + 4 walls + door
    const freed = doc.transact("Ungroup", (tx) => ungroup(tx, doc, g.id));
    expect(freed).toHaveLength(5);
    expect(doc.has(walls[0]!.id)).toBe(true);
    expect(doc.byCategory(Cat.GroupType)).toHaveLength(0);
    expect(groupInstances(doc, g.typeId!)).toHaveLength(0);
  });

  it("doors can't be grouped without their wall; members can't join two groups", () => {
    const { doc, walls, door } = unit();
    expect(() => doc.transact("G", (tx) => createGroup(tx, doc, [door.id]))).toThrow(/with their wall/);
    doc.transact("G", (tx) => createGroup(tx, doc, [walls[0]!.id]));
    expect(() => doc.transact("G", (tx) => createGroup(tx, doc, [walls[0]!.id]))).toThrow(/already in a group/);
  });
});
