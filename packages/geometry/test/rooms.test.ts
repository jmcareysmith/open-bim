import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createRoom,
  createRoomSeparator,
  createWall,
  floorPlanFor,
  wallThickness,
  type Room,
  type Vec2,
  type WallParams,
} from "@open-bim/core";
import { SimpleKernel, roomBoundary, viewDrawing } from "../src/index.ts";

function box(doc: Document, ids: ReturnType<typeof applyResidentialTemplate>, w: number, d: number) {
  const pts: Vec2[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: d },
    { x: 0, y: d },
  ];
  return doc.transact("Walls", (tx) =>
    pts.map((p, i) => createWall(tx, ids.wallTypes.interior, p, pts[(i + 1) % 4]!, ids.levels.ground, { topLevelId: ids.levels.first })),
  );
}

describe("rooms", () => {
  it("bound by wall finish faces, and follow the walls", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const walls = box(doc, ids, 4000, 3000);
    const t = wallThickness(doc, walls[0]!);
    const room = doc.transact("Room", (tx) => createRoom(tx, doc, ids.levels.ground, { x: 2000, y: 1500 }, { name: "Bedroom" }));
    expect(room.params.number).toBe("1");
    const b = roomBoundary(doc, room)!;
    expect(b.area).toBeCloseTo((4000 - t) * (3000 - t), -1);
    expect(b.perimeter).toBeCloseTo(2 * (4000 - t + 3000 - t), 0);

    // Move the east wall out 1 m: the room grows (its west and east walls are joined at corners).
    doc.transact("Move", (tx) => {
      tx.update<WallParams>(walls[1]!.id, { start: { x: 5000, y: 0 }, end: { x: 5000, y: 3000 } });
      tx.update<WallParams>(walls[0]!.id, { end: { x: 5000, y: 0 } });
      tx.update<WallParams>(walls[2]!.id, { start: { x: 5000, y: 3000 } });
    });
    expect(roomBoundary(doc, doc.require(room.id) as Room)!.area).toBeCloseTo((5000 - t) * (3000 - t), -1);
  });

  it("separation lines split open space; unenclosed rooms have no boundary", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    box(doc, ids, 6000, 3000);
    const [a, b] = doc.transact("Rooms", (tx) => [
      createRoom(tx, doc, ids.levels.ground, { x: 1000, y: 1500 }, { name: "Kitchen" }),
      createRoom(tx, doc, ids.levels.ground, { x: 5000, y: 1500 }, { name: "Living" }),
    ]);
    const whole = roomBoundary(doc, a!)!.area;
    expect(roomBoundary(doc, b!)!.area).toBeCloseTo(whole);
    doc.transact("Sep", (tx) => createRoomSeparator(tx, doc, ids.levels.ground, { x: 2000, y: -500 }, { x: 2000, y: 3500 }));
    const ka = roomBoundary(doc, a!)!.area;
    const la = roomBoundary(doc, b!)!.area;
    expect(ka + la).toBeCloseTo(whole, -4);
    expect(ka).toBeLessThan(la);

    const out = doc.transact("Outside", (tx) => createRoom(tx, doc, ids.levels.ground, { x: 8000, y: 1500 }));
    expect(roomBoundary(doc, out)).toBeNull();
    // A room on the first floor isn't bounded by ground-floor walls.
    const up = doc.transact("Up", (tx) => createRoom(tx, doc, ids.levels.first, { x: 1000, y: 1500 }));
    expect(roomBoundary(doc, up)).toBeNull();
  });

  it("walls set not to bound rooms are ignored", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    box(doc, ids, 6000, 3000);
    const mid = doc.transact("Mid", (tx) =>
      createWall(tx, ids.wallTypes.interior, { x: 3000, y: 0 }, { x: 3000, y: 3000 }, ids.levels.ground, { topLevelId: ids.levels.first }),
    );
    const r = doc.transact("Room", (tx) => createRoom(tx, doc, ids.levels.ground, { x: 1000, y: 1500 }));
    const half = roomBoundary(doc, r)!.area;
    doc.transact("Not bounding", (tx) => tx.update<WallParams>(mid.id, { roomBounding: false }));
    expect(roomBoundary(doc, r)!.area).toBeGreaterThan(half * 1.9);
  });

  it("tags appear only in plans of the room's level", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    box(doc, ids, 4000, 3000);
    doc.transact("Room", (tx) => createRoom(tx, doc, ids.levels.ground, { x: 2000, y: 1500 }, { name: "Lounge" }));
    const k = new SimpleKernel();
    const texts = (lvl: string) => viewDrawing(doc, k, floorPlanFor(doc, lvl)!).texts.map((t) => t.text);
    expect(texts(ids.levels.ground)).toContain("Lounge");
    expect(texts(ids.levels.ground).some((t) => t.endsWith("m²"))).toBe(true);
    expect(texts(ids.levels.first)).not.toContain("Lounge");
  });
});

describe("area plans", () => {
  it("GFA to the outside face, NLA to the inside face of external walls", async () => {
    const { createAreaPlan, createArea, createAreaBoundary } = await import("@open-bim/core");
    const { areaLoopsFromWalls, areaBoundary } = await import("../src/index.ts");
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const walls = box(doc, ids, 6000, 4000);
    const t = wallThickness(doc, walls[0]!);
    // An internal wall doesn't change either area.
    doc.transact("Mid", (tx) =>
      createWall(tx, ids.wallTypes.interior, { x: 3000, y: 0 }, { x: 3000, y: 4000 }, ids.levels.ground, { topLevelId: ids.levels.first }),
    );
    const areaOf = (scheme: "gross" | "rentable") => {
      const plan = doc.transact("Plan", (tx) => createAreaPlan(tx, doc, ids.levels.ground, scheme));
      const loops = areaLoopsFromWalls(doc, ids.levels.ground, scheme);
      expect(loops).toHaveLength(1);
      expect(loops[0]).toHaveLength(4);
      const area = doc.transact("Bounds", (tx) => {
        loops[0]!.forEach((a, i) => createAreaBoundary(tx, doc, plan.id, a, loops[0]![(i + 1) % 4]!));
        return createArea(tx, doc, plan.id, { x: 1000, y: 1000 });
      });
      return { plan, a: areaBoundary(doc, area)!.area };
    };
    const gross = areaOf("gross");
    const nla = areaOf("rentable");
    expect(gross.plan.name).toBe("Ground Floor GFA");
    expect(gross.a).toBeCloseTo((6000 + t) * (4000 + t), -3);
    expect(nla.a).toBeCloseTo((6000 - t) * (4000 - t), -3);
  });

  it("areas only exist in area plans, and draw only there", async () => {
    const { createAreaPlan, createArea } = await import("@open-bim/core");
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const plan = floorPlanFor(doc, ids.levels.ground)!;
    expect(() => doc.transact("A", (tx) => createArea(tx, doc, plan.id, { x: 0, y: 0 }))).toThrow(/area plans/);
    const ap = doc.transact("AP", (tx) => createAreaPlan(tx, doc, ids.levels.ground, "gross"));
    doc.transact("A", (tx) => createArea(tx, doc, ap.id, { x: 0, y: 0 }, { name: "Level 0" }));
    doc.transact("Room", (tx) => createRoom(tx, doc, ids.levels.ground, { x: 0, y: 0 }, { name: "Lounge" }));
    const k = new SimpleKernel();
    const texts = (v: typeof plan) => viewDrawing(doc, k, v).texts.map((t) => t.text);
    expect(texts(ap)).toContain("Level 0");
    expect(texts(ap)).not.toContain("Lounge");
    expect(texts(plan)).not.toContain("Level 0");
  });
});
