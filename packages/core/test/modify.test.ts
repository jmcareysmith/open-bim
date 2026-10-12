import { describe, expect, it } from "vitest";
import {
  Cat,
  Document,
  applyAffine,
  applyResidentialTemplate,
  arrayElements,
  compose,
  createDoor,
  createFloor,
  createGroup,
  createRoof,
  createWall,
  groupMembers,
  mirrorAcross,
  polygonArea,
  rotationAbout,
  selectionCentre,
  transformElements,
  translation,
  type DoorParams,
  type FloorParams,
  type GroupParams,
  type RoofParams,
  type Vec2,
  type WallParams,
} from "../src/index.ts";

const close = (a: Vec2, b: Vec2) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

function box() {
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
  const door = doc.transact("Door", (tx) => createDoor(tx, doc, ids.doorTypes.single810, walls[0]!.id, 1000));
  return { doc, ids, walls, door, pts };
}
const wall = (doc: Document, id: string) => doc.require<WallParams>(id).params;

describe("affine transforms", () => {
  it("rotates, mirrors and composes", () => {
    close(applyAffine(rotationAbout({ x: 1, y: 1 }, Math.PI / 2), { x: 2, y: 1 }), { x: 1, y: 2 });
    close(applyAffine(mirrorAcross({ x: 0, y: 0 }, { x: 1, y: 1 }), { x: 3, y: 1 }), { x: 1, y: 3 });
    const t = compose(translation({ x: 10, y: 0 }), rotationAbout({ x: 0, y: 0 }, Math.PI));
    close(applyAffine(t, { x: 1, y: 0 }), { x: 9, y: 0 });
  });
});

describe("move / copy / rotate / mirror", () => {
  it("moving one wall drags the walls joined to it (corners)", () => {
    const { doc, walls } = box();
    doc.transact("Move", (tx) => transformElements(tx, doc, [walls[1]!.id], translation({ x: 500, y: 0 })));
    close(wall(doc, walls[1]!.id).start, { x: 4500, y: 0 });
    close(wall(doc, walls[0]!.id).end, { x: 4500, y: 0 });
    close(wall(doc, walls[2]!.id).start, { x: 4500, y: 3000 });
    // Disjoin leaves the neighbours alone.
    doc.transact("Move", (tx) => transformElements(tx, doc, [walls[1]!.id], translation({ x: 500, y: 0 }), { disjoin: true }));
    close(wall(doc, walls[0]!.id).end, { x: 4500, y: 0 });
  });

  it("a tee follows the wall it butts into", () => {
    const { doc, ids, walls } = box();
    const stem = doc.transact("Stem", (tx) => createWall(tx, ids.wallTypes.interior, { x: 2000, y: 1500 }, { x: 2000, y: 3000 }, ids.levels.ground));
    doc.transact("Move", (tx) => transformElements(tx, doc, [walls[2]!.id], translation({ x: 300, y: 1000 })));
    close(wall(doc, stem.id).end, { x: 2000, y: 4000 });
    close(wall(doc, stem.id).start, { x: 2000, y: 1500 });
  });

  it("doors ride on their wall, and slide along it when moved alone", () => {
    const { doc, walls, door } = box();
    doc.transact("Move", (tx) => transformElements(tx, doc, [door.id], translation({ x: 700, y: 400 })));
    expect(doc.require<DoorParams>(door.id).params.position).toBeCloseTo(1700);
    expect(() => doc.transact("Rotate", (tx) => transformElements(tx, doc, [door.id], rotationAbout({ x: 0, y: 0 }, 1)))).toThrow(/along their wall/);
    doc.transact("Move", (tx) => transformElements(tx, doc, [walls[0]!.id], translation({ x: 0, y: -200 }), { disjoin: true }));
    expect(doc.require<DoorParams>(door.id).params.position).toBeCloseTo(1700);
  });

  it("copy brings doors along on the copied wall", () => {
    const { doc, walls } = box();
    const [copy] = doc.transact("Copy", (tx) => transformElements(tx, doc, [walls[0]!.id], translation({ x: 0, y: -5000 }), { copy: true }));
    close(wall(doc, copy!).start, { x: 0, y: -5000 });
    const doors = doc.byCategory<DoorParams>(Cat.Door);
    expect(doors).toHaveLength(2);
    expect(doors.some((d) => d.params.hostId === copy)).toBe(true);
    // Originals untouched.
    close(wall(doc, walls[3]!.id).end, { x: 0, y: 0 });
  });

  it("rotation turns walls about the pivot", () => {
    const { doc, walls } = box();
    doc.transact("Rotate", (tx) => transformElements(tx, doc, walls.map((w) => w.id), rotationAbout({ x: 0, y: 0 }, Math.PI / 2)));
    close(wall(doc, walls[0]!.id).end, { x: 0, y: 4000 });
  });

  it("mirror swaps wall ends so the door keeps its physical spot, with hand flipped", () => {
    const { doc, walls, door } = box();
    const axis = mirrorAcross({ x: 6000, y: 0 }, { x: 6000, y: 1 });
    const out = doc.transact("Mirror", (tx) => transformElements(tx, doc, walls.map((w) => w.id), axis, { copy: true }));
    const w0 = wall(doc, out[0]!);
    close(w0.start, { x: 8000, y: 0 });
    close(w0.end, { x: 12000, y: 0 });
    const d = doc.byCategory<DoorParams>(Cat.Door).find((x) => x.params.hostId === out[0])!;
    // Original door 1000 from x=0 → mirrored at x = 12000 - 1000 = 11000, i.e. 3000 from the new start.
    expect(d.params.position).toBeCloseTo(3000);
    expect(d.params.handFlipped).toBe(!doc.require<DoorParams>(door.id).params.handFlipped);
  });

  it("mirrored sketches stay counter-clockwise; roof slopes stay on their edges", () => {
    const { doc, ids } = box();
    const b = [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 3000 },
      { x: 0, y: 3000 },
    ];
    const floor = doc.transact("Floor", (tx) => createFloor(tx, ids.floorTypes.slab, ids.levels.ground, b));
    const roof = doc.transact("Roof", (tx) => createRoof(tx, ids.roofTypes.steel, ids.levels.first, b, { slopes: [0.4, null, 0.4, null] }));
    const axis = mirrorAcross({ x: 0, y: 0 }, { x: 0, y: 1 });
    doc.transact("Mirror", (tx) => transformElements(tx, doc, [floor.id, roof.id], axis));
    expect(polygonArea(doc.require<FloorParams>(floor.id).params.boundary)).toBeGreaterThan(0);
    const r = doc.require<RoofParams>(roof.id).params;
    expect(polygonArea(r.boundary)).toBeGreaterThan(0);
    // Each sloped edge is still a long (4000 mm) edge.
    r.slopes.forEach((s, i) => {
      const p = r.boundary[i]!;
      const q = r.boundary[(i + 1) % 4]!;
      expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeCloseTo(s === null ? 3000 : 4000);
    });
  });

  it("groups move and copy rigidly; members can't be moved on their own", () => {
    const { doc, walls } = box();
    const g = doc.transact("Group", (tx) => createGroup(tx, doc, walls.map((w) => w.id)));
    doc.transact("Move", (tx) => transformElements(tx, doc, [g.id], translation({ x: 1000, y: 0 })));
    expect(doc.require<GroupParams>(g.id).params.origin).toEqual({ x: 3000, y: 1500 });
    expect(() => doc.transact("Move", (tx) => transformElements(tx, doc, [walls[0]!.id], translation({ x: 1, y: 0 })))).toThrow(/group/);
    expect(() => doc.transact("Mirror", (tx) => transformElements(tx, doc, [g.id], mirrorAcross({ x: 0, y: 0 }, { x: 0, y: 1 })))).toThrow(/mirrored/);
    const [copy] = doc.transact("Copy", (tx) => transformElements(tx, doc, [g.id], translation({ x: 0, y: 5000 }), { copy: true }));
    expect(groupMembers(doc, copy!)).toHaveLength(5);
  });

  it("arrays: linear copies at equal steps, radial about a centre", () => {
    const { doc, walls } = box();
    const out = doc.transact("Array", (tx) => arrayElements(tx, doc, [walls[0]!.id], translation({ x: 0, y: -1000 }), 4));
    expect(out).toHaveLength(3);
    close(wall(doc, out[2]![0]!).start, { x: 0, y: -3000 });
    const radial = doc.transact("Array", (tx) => arrayElements(tx, doc, [walls[0]!.id], rotationAbout({ x: 0, y: 0 }, Math.PI / 2), 4));
    close(wall(doc, radial[1]![0]!).end, { x: -4000, y: 0 });
    expect(() => doc.transact("Array", (tx) => arrayElements(tx, doc, [walls[0]!.id], translation({ x: 1, y: 0 }), 1))).toThrow(/at least 2/);
  });

  it("selection centre is the middle of the plan extents (doors use their wall)", () => {
    const { doc, walls, door } = box();
    expect(selectionCentre(doc, walls.map((w) => w.id))).toEqual({ x: 2000, y: 1500 });
    expect(selectionCentre(doc, [door.id])).toEqual({ x: 2000, y: 0 });
  });

  it("undo restores everything in one step", () => {
    const { doc, walls } = box();
    const before = doc.toJSON();
    doc.transact("Move", (tx) => transformElements(tx, doc, [walls[1]!.id], translation({ x: 500, y: 0 })));
    doc.undo();
    expect(doc.toJSON()).toEqual(before);
  });
});
