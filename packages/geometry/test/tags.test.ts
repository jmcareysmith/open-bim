import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createBuildingElevations,
  createDoor,
  createRoom,
  createTag,
  createWall,
  floorPlanFor,
  tagPosition,
  tagText,
  type DoorParams,
  type Tag,
  type WallParams,
} from "@open-bim/core";
import { SimpleKernel, viewDrawing } from "../src/index.ts";

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const wall = doc.transact("W", (tx) =>
    createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 6000, y: 0 }, ids.levels.ground, { topLevelId: ids.levels.first }),
  );
  const door = doc.transact("D", (tx) => createDoor(tx, doc, ids.doorTypes.single810, wall.id, 2000));
  const plan = floorPlanFor(doc, ids.levels.ground)!;
  return { doc, ids, wall, door, plan };
}

describe("tags", () => {
  it("door tags number their doors and follow them", () => {
    const { doc, door, plan } = setup();
    const tag = doc.transact("Tag", (tx) => createTag(tx, doc, plan.id, door.id, { x: 2000, y: 600 }));
    expect(tagText(doc, tag)).toBe("1");
    const second = doc.transact("D2", (tx) => createDoor(tx, doc, door.typeId!, door.params.hostId, 4500));
    const t2 = doc.transact("Tag", (tx) => createTag(tx, doc, plan.id, second.id, { x: 4500, y: 600 }));
    expect(tagText(doc, t2)).toBe("2");
    doc.transact("Move door", (tx) => tx.update<DoorParams>(door.id, { position: 3000 }));
    expect(tagPosition(doc, doc.require(tag.id) as Tag)).toEqual({ x: 3000, y: 600 });
    // Deleting the door deletes its tag.
    doc.transact("Delete", (tx) => tx.delete(door.id));
    expect(doc.get(tag.id)).toBeUndefined();
  });

  it("wall tags show the type name, room tags name and number; text is drawn", () => {
    const { doc, ids, wall, plan } = setup();
    const wt = doc.transact("Tag", (tx) => createTag(tx, doc, plan.id, wall.id, { x: 3000, y: -500 }, { leader: true }));
    expect(tagText(doc, wt)).toBe(doc.require(wall.typeId!).name);
    doc.transact("Mark", (tx) => tx.update<WallParams & { mark: string }>(wall.id, { mark: "W1" }));
    expect(tagText(doc, doc.require(wt.id) as Tag)).toBe("W1");
    const room = doc.transact("R", (tx) => createRoom(tx, doc, ids.levels.ground, { x: 3000, y: 2000 }, { name: "Garage" }));
    const rt = doc.transact("Tag", (tx) => createTag(tx, doc, plan.id, room.id, { x: 3000, y: 2000 }));
    expect(tagText(doc, rt)).toBe("Garage 1");
    const texts = viewDrawing(doc, new SimpleKernel(), plan).texts.map((t) => t.text);
    expect(texts).toEqual(expect.arrayContaining(["W1", "Garage 1"]));
  });

  it("tags in elevations sit at the element's height", () => {
    const { doc, door } = setup();
    const [south] = doc.transact("Elev", (tx) => createBuildingElevations(tx, doc, { x: 0, y: -100 }, { x: 6000, y: 100 }));
    const t = doc.transact("Tag", (tx) => createTag(tx, doc, south!.id, door.id, { x: 0, y: 0 }));
    const anchorZ = -t.params.offset.y;
    expect(anchorZ).toBeGreaterThan(500);
    expect(anchorZ).toBeLessThan(2100);
  });

  it("can't tag in 3D or untaggable elements", () => {
    const { doc, plan, door, ids } = setup();
    const v3d = doc.all().find((e) => (e.params as { kind?: string }).kind === "3d")!;
    expect(() => doc.transact("T", (tx) => createTag(tx, doc, v3d.id, door.id, { x: 0, y: 0 }))).toThrow(/plans/);
    expect(() => doc.transact("T", (tx) => createTag(tx, doc, plan.id, ids.levels.ground, { x: 0, y: 0 }))).toThrow(/can't be tagged/);
  });
});
