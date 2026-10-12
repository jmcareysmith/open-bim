import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createDoor,
  createFloor,
  createRoom,
  createWall,
  dragGrip,
  elementGrips,
  setLineLength,
  type DoorParams,
  type FloorParams,
  type RoomParams,
  type Vec2,
  type WallParams,
} from "../src/index.ts";

function box() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const pts: Vec2[] = [
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 4000, y: 3000 },
    { x: 0, y: 3000 },
  ];
  const walls = doc.transact("Walls", (tx) => pts.map((p, i) => createWall(tx, ids.wallTypes.interior, p, pts[(i + 1) % 4]!, ids.levels.ground)));
  return { doc, ids, walls, pts };
}
const W = (doc: Document, id: string) => doc.require<WallParams>(id).params;

describe("grips", () => {
  it("dragging a wall end moves a joined wall's end only when that wall is selected too", () => {
    const { doc, walls } = box();
    expect(elementGrips(doc, walls[0]!).map((g) => g.key)).toEqual(["start", "end"]);
    doc.transact("Drag", (tx) => dragGrip(tx, doc, walls[0]!.id, "end", { x: 5000, y: 0 }));
    expect(W(doc, walls[0]!.id).end).toEqual({ x: 5000, y: 0 });
    expect(W(doc, walls[1]!.id).start).toEqual({ x: 4000, y: 0 });
    doc.undo();
    doc.transact("Drag", (tx) => dragGrip(tx, doc, walls[0]!.id, "end", { x: 5000, y: 0 }, [walls[0]!.id, walls[1]!.id]));
    expect(W(doc, walls[1]!.id).start).toEqual({ x: 5000, y: 0 });
  });

  it("a door's grip slides it along its wall", () => {
    const { doc, ids, walls } = box();
    const door = doc.transact("Door", (tx) => createDoor(tx, doc, ids.doorTypes.single810, walls[0]!.id, 1000));
    const [g] = elementGrips(doc, door);
    expect(g).toMatchObject({ key: "along", point: { x: 1000, y: 0 } });
    doc.transact("Drag", (tx) => dragGrip(tx, doc, door.id, "along", { x: 2500, y: 300 }));
    expect(doc.require<DoorParams>(door.id).params.position).toBeCloseTo(2500);
  });

  it("sketch vertices reshape floors; point elements move", () => {
    const { doc, ids, pts } = box();
    const floor = doc.transact("Floor", (tx) => createFloor(tx, ids.floorTypes.slab, ids.levels.ground, pts));
    doc.transact("Drag", (tx) => dragGrip(tx, doc, floor.id, "v2", { x: 5000, y: 3500 }));
    expect(doc.require<FloorParams>(floor.id).params.boundary).toContainEqual({ x: 5000, y: 3500 });
    const room = doc.transact("Room", (tx) => createRoom(tx, doc, ids.levels.ground, { x: 2000, y: 1500 }));
    doc.transact("Drag", (tx) => dragGrip(tx, doc, room.id, "move", { x: 1000, y: 1000 }));
    expect(doc.require<RoomParams>(room.id).params.point).toEqual({ x: 1000, y: 1000 });
  });

  it("temporary dimension sets a wall's length; the joined wall follows", () => {
    const { doc, walls } = box();
    doc.transact("Length", (tx) => setLineLength(tx, doc, walls[0]!.id, 4500));
    expect(W(doc, walls[0]!.id).end).toEqual({ x: 4500, y: 0 });
    expect(W(doc, walls[1]!.id).start).toEqual({ x: 4500, y: 0 });
    expect(() => doc.transact("Length", (tx) => setLineLength(tx, doc, walls[0]!.id, 0))).toThrow(/at least/);
  });
});
