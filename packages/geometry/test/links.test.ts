import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createLink,
  createWall,
  ensureProjectSettings,
  linkDocument,
  reloadLink,
  type Link,
  bindLink,
  createSchedule,
  createDoor,
  type WallParams,
  type LinkParams,
} from "@open-bim/core";
import { SimpleKernel, boundingBox, scheduleTable } from "../src/index.ts";

function neighbour(at: { e: number; n: number }) {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  doc.transact("W", (tx) => {
    createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 4000, y: 0 }, ids.levels.ground, { topLevelId: ids.levels.first });
    const s = ensureProjectSettings(tx, doc);
    tx.update(s.id, { location: { epsg: 2193, eastings: at.e, northings: at.n, height: 0, rotation: 0 } });
  });
  return doc;
}

describe("links", () => {
  it("draws the linked project origin to origin, or by shared coordinates, plus an offset", () => {
    const host = new Document();
    host.transact("Loc", (tx) => {
      const s = ensureProjectSettings(tx, host);
      tx.update(s.id, { location: { epsg: 2193, eastings: 1756000, northings: 5920000, height: 0, rotation: 0 } });
    });
    const json = neighbour({ e: 1756020, n: 5920005 }).toJSON();
    const link = host.transact("Link", (tx) => createLink(tx, json, "C:/jobs/neighbour.obim"));
    expect(link.name).toBe("neighbour.obim");
    const k = new SimpleKernel();
    const box = () => boundingBox(k.build(host, host.require(link.id))!);
    expect(box().min[0]).toBeCloseTo(0, 0);
    host.transact("Shared", (tx) => tx.update<LinkParams>(link.id, { positioning: "shared" }));
    // 20 m east, 5 m north of the host's survey point.
    expect(box().min[0]).toBeCloseTo(20000, 0);
    expect(box().min[1]).toBeLessThan(5000);
    expect(box().max[1]).toBeGreaterThan(5000);
    host.transact("Move", (tx) => tx.update<LinkParams>(link.id, { offset: { x: 1000, y: 0, z: 500 } }));
    expect(box().min[0]).toBeCloseTo(21000, 0);
    expect(box().min[2]).toBeCloseTo(500, 0);
  });

  it("reloads a new snapshot", () => {
    const host = new Document();
    const before = neighbour({ e: 0, n: 0 });
    const link = host.transact("Link", (tx) => createLink(tx, before.toJSON(), "n.obim"));
    expect(linkDocument(link).byCategory("Wall")).toHaveLength(1);
    const after = neighbour({ e: 0, n: 0 });
    const ids = after.byCategory("WallType")[0]!.id;
    after.transact("More", (tx) => createWall(tx, ids, { x: 0, y: 3000 }, { x: 4000, y: 3000 }, after.byCategory("Level")[0]!.id, { height: 2400 }));
    host.transact("Reload", (tx) => reloadLink(tx, link.id, after.toJSON()));
    expect(linkDocument(host.require(link.id) as Link).byCategory("Wall")).toHaveLength(2);
    expect(() => host.transact("Bad", (tx) => createLink(tx, { format: "x" } as never, "x"))).toThrow(/Open-BIM project/);
  });
  it("draws in one link colour, or the linked model's own material colours", () => {
    const host = new Document();
    applyResidentialTemplate(host);
    const link = host.transact("Link", (tx) => createLink(tx, neighbour({ e: 0, n: 0 }).toJSON(), "n.obim"));
    const k = new SimpleKernel();
    expect(k.build(host, link)!.colors).toBeUndefined();
    host.transact("Colours", (tx) => tx.update<LinkParams>(link.id, { materialColours: true }));
    const m = k.build(host, host.require(link.id))!;
    expect(m.colors).toBeDefined();
    expect(m.colors!.length).toBe(m.positions.length);
    // The weatherboard wall's colour (0xe4e0d4) is among them.
    const c = Array.from(m.colors!.slice(0, 3)).map((v) => Math.round(v * 255));
    expect(c).toEqual([0xe4, 0xe0, 0xd4]);
  });
});

describe("links in schedules and Bind Link", () => {
  it("schedules include linked elements when asked", () => {
    const host = new Document();
    const ids = applyResidentialTemplate(host);
    host.transact("W", (tx) => createWall(tx, ids.wallTypes.exterior, { x: 0, y: 5000 }, { x: 3000, y: 5000 }, ids.levels.ground, { topLevelId: ids.levels.first }));
    host.transact("Link", (tx) => createLink(tx, neighbour({ e: 0, n: 0 }).toJSON(), "n.obim"));
    const s = host.transact("S", (tx) => createSchedule(tx, host, "Wall"));
    expect(scheduleTable(host, s).rows.length).toBe(1);
    host.transact("Inc", (tx) => tx.update(s.id, { includeLinks: true }));
    expect(scheduleTable(host, host.require(s.id) as typeof s).rows.length).toBe(2);
  });

  it("binds a link: its walls and doors become the project's, moved, on matching levels, sharing types by name", () => {
    const n = neighbour({ e: 0, n: 0 });
    const wall = n.byCategory<WallParams>("Wall")[0]!;
    const doorType = n.byCategory("DoorType")[0]!;
    n.transact("D", (tx) => createDoor(tx, n, doorType.id, wall.id, 2000));
    const host = new Document();
    const ids = applyResidentialTemplate(host);
    const link = host.transact("Link", (tx) => createLink(tx, n.toJSON(), "n.obim"));
    host.transact("Move", (tx) => tx.update<LinkParams>(link.id, { offset: { x: 10000, y: 0, z: 0 }, rotation: Math.PI / 2 }));
    const before = host.all().length;
    const nLevels = host.byCategory("Level").length;
    const box = boundingBox(new SimpleKernel().build(host, host.require(link.id))!);
    host.transact("Bind", (tx) => bindLink(tx, host, host.require(link.id) as Link));
    expect(host.get(link.id)).toBeUndefined();
    const walls = host.byCategory<WallParams>("Wall");
    expect(walls).toHaveLength(1);
    expect(walls[0]!.params.end.x).toBeCloseTo(10000);
    expect(walls[0]!.params.end.y).toBeCloseTo(4000);
    expect(walls[0]!.params.baseLevelId).toBe(ids.levels.ground);
    expect(walls[0]!.typeId).toBe(ids.wallTypes.exterior);
    expect(host.byCategory("Door")).toHaveLength(1);
    expect(host.byCategory("Level")).toHaveLength(nLevels);
    // Wall + door; no duplicate types or materials.
    expect(host.all().length).toBe(before - 1 + 2);
    const after = boundingBox(new SimpleKernel().build(host, walls[0]!)!);
    expect(after.min[1]).toBeCloseTo(box.min[1], 0);
  });
});

