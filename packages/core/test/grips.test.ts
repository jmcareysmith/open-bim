import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createDoor,
  createFloor,
  createRoom,
  createGrid,
  createSection,
  createCallout,
  floorPlanFor,
  calloutHeadPosition,
  createElevationAt,
  type ViewParams,
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

  it("view extents: line ends slide along the line, the far clip sets depth, elevations move by their marker", () => {
    const { doc } = box();
    const sec = doc.transact("S", (tx) => createSection(tx, doc, { x: 0, y: 1500 }, { x: 4000, y: 1500 }, { farClip: 2000 }));
    expect(elementGrips(doc, sec).map((g) => g.key)).toEqual(["lstart", "lend", "far"]);
    doc.transact("Drag", (tx) => dragGrip(tx, doc, sec.id, "lend", { x: 6000, y: 1900 }));
    expect(doc.require<ViewParams>(sec.id).params.line!.end).toEqual({ x: 6000, y: 1500 });
    doc.transact("Drag", (tx) => dragGrip(tx, doc, sec.id, "far", { x: 3000, y: 4500 }));
    expect(doc.require<ViewParams>(sec.id).params.farClip).toBeCloseTo(3000);
    const el = doc.transact("E", (tx) => createElevationAt(tx, doc, { x: 2000, y: -3000 }));
    const move = elementGrips(doc, el).find((g) => g.key === "move")!;
    expect(move.point).toEqual({ x: 2000, y: -3000 });
    doc.transact("Drag", (tx) => dragGrip(tx, doc, el.id, "move", { x: 2500, y: -3000 }));
    expect(doc.require<ViewParams>(el.id).params.marker).toEqual({ x: 2500, y: -3000 });
  });

  it("a callout's head bubble drags on its own and moves with the callout", () => {
    const { doc, ids } = box();
    const plan = floorPlanFor(doc, ids.levels.ground)!;
    const c = doc.transact("C", (tx) => createCallout(tx, doc, plan.id, { x: 0, y: 0 }, { x: 2000, y: 2000 }));
    expect(elementGrips(doc, c).map((g) => g.key)).toEqual(["cmin", "cmax", "head"]);
    doc.transact("Drag", (tx) => dragGrip(tx, doc, c.id, "head", { x: -1500, y: 2500 }));
    expect(calloutHeadPosition(doc.require<ViewParams>(c.id).params)).toEqual({ x: -1500, y: 2500 });
    doc.transact("Move", (tx) => dragGrip(tx, doc, c.id, "cmax", { x: 3000, y: 3000 }));
    expect(calloutHeadPosition(doc.require<ViewParams>(c.id).params)).toEqual({ x: -1500, y: 2500 });
  });

  it("grid ends slide along the grid; the angle never changes", () => {
    const { doc } = box();
    const g = doc.transact("G", (tx) => createGrid(tx, doc, { x: 0, y: -1000 }, { x: 0, y: 4000 }, "Z"));
    doc.transact("Drag", (tx) => dragGrip(tx, doc, g.id, "end", { x: 700, y: 6000 }));
    expect(doc.require<{ end: Vec2 }>(g.id).params.end).toEqual({ x: 0, y: 6000 });
  });
});

describe("3D shape handles: top and base", () => {
  it("drag a wall's top and base; unconnected walls keep their top when the base moves", async () => {
    const { Document, applyResidentialTemplate, createWall, setVerticalEdge, verticalHandles, wallExtent } = await import("../src/index.ts");
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const w = doc.transact("W", (tx) => createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 4000, y: 0 }, ids.levels.ground, { height: 2400 }));
    expect(verticalHandles(doc, w)!.top).toBe(2400);
    doc.transact("Top", (tx) => setVerticalEdge(tx, doc, w.id, "top", 3100));
    expect(wallExtent(doc, doc.require(w.id) as never)).toEqual({ bottom: 0, top: 3100 });
    doc.transact("Base", (tx) => setVerticalEdge(tx, doc, w.id, "base", 300));
    expect(wallExtent(doc, doc.require(w.id) as never)).toEqual({ bottom: 300, top: 3100 });
    // Base can't pass the top.
    doc.transact("Base", (tx) => setVerticalEdge(tx, doc, w.id, "base", 5000));
    expect(wallExtent(doc, doc.require(w.id) as never)).toEqual({ bottom: 3090, top: 3100 });
  });
});

describe("3D shape handles: floors, ceilings, roofs, families", () => {
  it("one handle moves the element to the height dragged to", async () => {
    const { Document, applyResidentialTemplate, createFloor, setVerticalEdge, verticalHandles } = await import("../src/index.ts");
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const sq = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }];
    const f = doc.transact("F", (tx) => createFloor(tx, ids.floorTypes.timber, ids.levels.ground, sq));
    const h = verticalHandles(doc, f)!;
    expect(h.at).toEqual({ x: 2000, y: 1500 });
    expect(h.top).toBe(0);
    expect(h.bottom).toBeNull();
    doc.transact("Up", (tx) => setVerticalEdge(tx, doc, f.id, "top", 450));
    expect(doc.require<{ offset: number }>(f.id).params.offset).toBe(450);
    expect(() => doc.transact("Bad", (tx) => setVerticalEdge(tx, doc, f.id, "base", 0))).toThrow(/no base handle/);
  });
});

describe("3D shape handles: sills", () => {
  it("a window's handle sets its sill; it must stay inside the wall", async () => {
    const { Document, applyResidentialTemplate, createWall, createWindow, setVerticalEdge, verticalHandles } = await import("../src/index.ts");
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const w = doc.transact("W", (tx) => createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 4000, y: 0 }, ids.levels.ground, { height: 2700 }));
    const win = doc.transact("N", (tx) => createWindow(tx, doc, Object.values(ids.windowTypes)[0]!, w.id, 2000));
    const h = verticalHandles(doc, win)!;
    expect(h.at.x).toBeCloseTo(2000);
    doc.transact("Sill", (tx) => setVerticalEdge(tx, doc, win.id, "base", 1000));
    expect(doc.require<{ sillHeight: number }>(win.id).params.sillHeight).toBe(1000);
    expect(() => doc.transact("Too high", (tx) => setVerticalEdge(tx, doc, win.id, "base", 2600))).toThrow();
  });
});

describe("temporary dimensions for doors and windows", () => {
  it("clearances run to the nearest wall faces; typing one moves the door", async () => {
    const { Document, applyResidentialTemplate, createWall, createDoor, hostedClearances, setHostedClearance, wallThickness } = await import("../src/index.ts");
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const w = doc.transact("W", (tx) => createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 6000, y: 0 }, ids.levels.ground, { height: 2400 }));
    // A partition teeing in at 4000.
    const p = doc.transact("P", (tx) => createWall(tx, ids.wallTypes.interior, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, ids.levels.ground, { height: 2400 }));
    const d = doc.transact("D", (tx) => createDoor(tx, doc, ids.doorTypes.single860, w.id, 2000));
    const c = hostedClearances(doc, d)!;
    const half = c.half;
    expect(c.left.stop).toBe(0);
    expect(c.left.dist).toBeCloseTo(2000 - half);
    const face = 4000 - wallThickness(doc, p as never) / 2;
    expect(c.right.stop).toBeCloseTo(face);
    doc.transact("Dim", (tx) => setHostedClearance(tx, doc, d.id, "right", 100));
    expect(doc.require<{ position: number }>(d.id).params.position).toBeCloseTo(face - 100 - half, 0);
  });
});

describe("temporary dimensions for walls", () => {
  it("distances to parallel walls either side; typing one moves the wall across", async () => {
    const { Document, applyResidentialTemplate, createWall, wallClearances, setWallClearance } = await import("../src/index.ts");
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const t = ids.wallTypes.interior;
    const a = doc.transact("A", (tx) => createWall(tx, t, { x: 0, y: 0 }, { x: 6000, y: 0 }, ids.levels.ground, { height: 2400 }));
    const m = doc.transact("M", (tx) => createWall(tx, t, { x: 0, y: 3000 }, { x: 6000, y: 3000 }, ids.levels.ground, { height: 2400 }));
    doc.transact("B", (tx) => createWall(tx, t, { x: 0, y: 7000 }, { x: 6000, y: 7000 }, ids.levels.ground, { height: 2400 }));
    const c = wallClearances(doc, m as never);
    expect(c.left?.dist).toBe(4000);
    expect(c.right?.dist).toBe(3000);
    expect(c.right?.otherId).toBe(a.id);
    doc.transact("Move", (tx) => setWallClearance(tx, doc, m.id, "right", 2500));
    expect(doc.require<{ start: { y: number } }>(m.id).params.start.y).toBeCloseTo(2500);
  });
});

describe("temporary dimensions for columns", () => {
  it("distances to the nearest grid each way; typing one moves the column", async () => {
    const { Document, applyResidentialTemplate, createGrid, createColumn, ensureStructuralTypes, pointClearances, setPointClearance } = await import("../src/index.ts");
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const [g1] = doc.transact("G", (tx) => [createGrid(tx, doc, { x: 0, y: -1000 }, { x: 0, y: 9000 }, "1"), createGrid(tx, doc, { x: -1000, y: 0 }, { x: 9000, y: 0 }, "A")]);
    const types = doc.transact("T", (tx) => ensureStructuralTypes(tx, doc));
    const colType = (Array.isArray(types) ? types : Object.values(types as object)).flat().map((t: { id?: string }) => t?.id ?? t).find((id) => doc.get(id as string)?.params && (doc.get(id as string)!.params as { kind?: string }).kind === "column") as string | undefined;
    const tid = colType ?? doc.byCategory("StructuralType")[0]!.id;
    const c = doc.transact("C", (tx) => createColumn(tx, doc, tid, ids.levels.ground, ids.levels.first, { x: 600, y: 450 }));
    const cl = pointClearances(doc, c);
    expect(cl.map((x) => x.dist).sort((a, b) => a - b)).toEqual([450, 600]);
    doc.transact("Move", (tx) => setPointClearance(tx, doc, c.id, g1!.id, 1000));
    expect(doc.require<{ position: Vec2 }>(c.id).params.position.x).toBeCloseTo(1000);
  });
});

describe("clearance stops", () => {
  it("corner walls' inside faces and crossing walls stop it; walls upstairs don't", async () => {
    const { Document, applyResidentialTemplate, createWall, createDoor, hostedClearances, wallThickness } = await import("../src/index.ts");
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const t = ids.wallTypes.exterior;
    const g = ids.levels.ground;
    const host = doc.transact("H", (tx) => createWall(tx, t, { x: 0, y: 0 }, { x: 8000, y: 0 }, g, { height: 2400 }));
    const corner = doc.transact("C", (tx) => createWall(tx, t, { x: 0, y: 0 }, { x: 0, y: 4000 }, g, { height: 2400 }));
    const cross = doc.transact("X", (tx) => createWall(tx, ids.wallTypes.interior, { x: 5000, y: -2000 }, { x: 5000, y: 2000 }, g, { height: 2400 }));
    // Upstairs, teeing onto the same line at 3000: not on this storey.
    doc.transact("U", (tx) => createWall(tx, ids.wallTypes.interior, { x: 3000, y: 0 }, { x: 3000, y: 3000 }, ids.levels.first, { height: 2400 }));
    const d = doc.transact("D", (tx) => createDoor(tx, doc, ids.doorTypes.single860, host.id, 2000));
    const c = hostedClearances(doc, d)!;
    expect(c.left.stop).toBeCloseTo(wallThickness(doc, corner as never) / 2);
    expect(c.right.stop).toBeCloseTo(5000 - wallThickness(doc, cross as never) / 2);
  });
});

describe("permanent dimensions to columns", () => {
  it("an elementPoint reference follows the column", async () => {
    const { Document, applyResidentialTemplate, createGrid, createColumn, ensureStructuralTypes, createDimension, dimensionLayout, floorPlanFor, transformElements, translation } = await import("../src/index.ts");
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const g = doc.transact("G", (tx) => createGrid(tx, doc, { x: 0, y: -1000 }, { x: 0, y: 9000 }, "1"));
    doc.transact("T", (tx) => ensureStructuralTypes(tx, doc));
    const tid = doc.byCategory("StructuralType")[0]!.id;
    const c = doc.transact("C", (tx) => createColumn(tx, doc, tid, ids.levels.ground, ids.levels.first, { x: 600, y: 450 }));
    const plan = floorPlanFor(doc, ids.levels.ground)!;
    const dim = doc.transact("D", (tx) => createDimension(tx, doc, plan.id, [{ kind: "datum", id: g.id, pick: { x: 0, y: 450 } }, { kind: "elementPoint", id: c.id }], { x: 300, y: 1000 }));
    expect(dimensionLayout(doc, doc.require(dim.id) as never).values[0]).toBeCloseTo(600);
    doc.transact("M", (tx) => transformElements(tx, doc, [c.id], translation({ x: 400, y: 0 })));
    expect(dimensionLayout(doc, doc.require(dim.id) as never).values[0]).toBeCloseTo(1000);
  });
});
