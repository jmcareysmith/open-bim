import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createWall,
  createWallOpening,
  positionAlongWall,
  wallCuts,
  type ChangeSet,
  type Vec2,
  type WallOpeningParams,
} from "../src/index.ts";

const p = (x: number, y: number): Vec2 => ({ x, y });

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const wall = doc.transact("W", (tx) =>
    createWall(tx, ids.wallTypes.interior, p(0, 0), p(4000, 0), ids.levels.first, { height: 2400 }),
  );
  const changes: ChangeSet[] = [];
  doc.on((c) => changes.push(c));
  return { doc, ids, wall, changes };
}

describe("wall openings", () => {
  it("cut their host in wall coordinates, with absolute heights", () => {
    const { doc, wall } = setup();
    const o = doc.transact("O", (tx) => createWallOpening(tx, doc, wall.id, 1500, { width: 1000, sillHeight: 900, height: 1200 }));
    expect(wallCuts(doc, wall)).toEqual([{ id: o.id, u0: 1000, u1: 2000, z0: 2700 + 900, z1: 2700 + 2100 }]);
  });

  it("regenerate their host when added, changed or removed", () => {
    const { doc, wall, changes } = setup();
    const o = doc.transact("O", (tx) => createWallOpening(tx, doc, wall.id, 1500));
    expect(changes.at(-1)!.regenerate).toContain(wall.id);
    doc.transact("Widen", (tx) => tx.update<WallOpeningParams>(o.id, { width: 1200 }));
    expect(changes.at(-1)!.regenerate).toContain(wall.id);
    doc.transact("Remove", (tx) => tx.delete(o.id));
    expect(changes.at(-1)!.regenerate).toContain(wall.id);
    expect(wallCuts(doc, wall)).toEqual([]);
  });

  it("are deleted with their host", () => {
    const { doc, wall } = setup();
    const o = doc.transact("O", (tx) => createWallOpening(tx, doc, wall.id, 1500));
    doc.transact("Delete wall", (tx) => tx.delete(wall.id));
    expect(doc.has(o.id)).toBe(false);
    doc.undo();
    expect(doc.has(o.id)).toBe(true);
  });

  it("must fit inside the wall", () => {
    const { doc, wall } = setup();
    const make = (pos: number, o: Partial<WallOpeningParams>) => () =>
      doc.transact("O", (tx) => createWallOpening(tx, doc, wall.id, pos, o));
    expect(make(300, { width: 900 })).toThrow(/past the end/);
    expect(make(2000, { height: 2500 })).toThrow(/taller/);
    expect(make(2000, { width: 0 })).toThrow(/positive/);
    expect(make(2000, { sillHeight: -10 })).toThrow(/below/);
    const { ids } = { ids: doc.byCategory("Level") };
    expect(() => doc.transact("O", (tx) => createWallOpening(tx, doc, ids[0]!.id, 100))).toThrow(/hosted by a wall/);
  });

  it("place along the wall from a picked point", () => {
    const { wall } = setup();
    expect(positionAlongWall(wall, p(1234, 300))).toBe(1234);
    expect(positionAlongWall(wall, p(-50, 0))).toBe(0);
    expect(positionAlongWall(wall, p(9000, 0))).toBe(4000);
  });
});
