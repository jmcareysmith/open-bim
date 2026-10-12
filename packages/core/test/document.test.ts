import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createFloor,
  createWall,
  floorExtent,
  wallExtent,
  wallLength,
  wallThickness,
  type ChangeSet,
  type LevelParams,
  type Wall,
} from "../src/index.ts";

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  return { doc, ids };
}

describe("template", () => {
  it("creates levels and types", () => {
    const { doc, ids } = setup();
    expect(doc.require<LevelParams>(ids.levels.first).params.elevation).toBe(2700);
    expect(doc.byCategory("WallType")).toHaveLength(3);
    expect(doc.canUndo).toBe(true);
  });
});

describe("walls", () => {
  it("computes length, thickness and extent", () => {
    const { doc, ids } = setup();
    const wall = doc.transact("Wall", (tx) =>
      createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 3000, y: 4000 }, ids.levels.ground, {
        topLevelId: ids.levels.first,
      }),
    );
    expect(wallLength(wall)).toBe(5000);
    expect(wallThickness(doc, wall)).toBe(139);
    expect(wallExtent(doc, wall)).toEqual({ bottom: 0, top: 2700 });
  });

  it("uses unconnected height when no top level", () => {
    const { doc, ids } = setup();
    const wall = doc.transact("Wall", (tx) =>
      createWall(tx, ids.wallTypes.interior, { x: 0, y: 0 }, { x: 1000, y: 0 }, ids.levels.first, {
        baseOffset: 100,
        height: 2000,
      }),
    );
    expect(wallExtent(doc, wall)).toEqual({ bottom: 2800, top: 4800 });
  });

  it("rejects zero-length walls and missing levels", () => {
    const { doc, ids } = setup();
    expect(() =>
      doc.transact("Bad", (tx) => createWall(tx, ids.wallTypes.interior, { x: 1, y: 1 }, { x: 1, y: 1 }, ids.levels.ground)),
    ).toThrow(/non-zero/);
    expect(() =>
      doc.transact("Bad", (tx) => createWall(tx, ids.wallTypes.interior, { x: 0, y: 0 }, { x: 1, y: 0 }, "nope")),
    ).toThrow(/missing/);
  });
});

describe("floors", () => {
  it("hangs below the level by its thickness", () => {
    const { doc, ids } = setup();
    const floor = doc.transact("Floor", (tx) =>
      createFloor(tx, ids.floorTypes.timber, ids.levels.first, [
        { x: 0, y: 0 },
        { x: 5000, y: 0 },
        { x: 5000, y: 4000 },
      ]),
    );
    expect(floorExtent(doc, floor)).toEqual({ top: 2700, bottom: 2440 });
  });
});

describe("transactions", () => {
  it("undoes and redoes", () => {
    const { doc, ids } = setup();
    const id = doc.transact("Wall", (tx) =>
      createWall(tx, ids.wallTypes.interior, { x: 0, y: 0 }, { x: 1000, y: 0 }, ids.levels.ground),
    ).id;
    doc.transact("Move", (tx) => tx.update(id, { end: { x: 2000, y: 0 } }));
    expect(wallLength(doc.require(id) as Wall)).toBe(2000);

    doc.undo();
    expect(wallLength(doc.require(id) as Wall)).toBe(1000);
    doc.undo();
    expect(doc.has(id)).toBe(false);
    doc.redo();
    doc.redo();
    expect(wallLength(doc.require(id) as Wall)).toBe(2000);
  });

  it("rolls back on error", () => {
    const { doc, ids } = setup();
    const before = doc.size;
    expect(() =>
      doc.transact("Fails", (tx) => {
        tx.update(ids.levels.ground, { elevation: 999 });
        createWall(tx, ids.wallTypes.interior, { x: 0, y: 0 }, { x: 1000, y: 0 }, ids.levels.ground);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(doc.size).toBe(before);
    expect(doc.require<LevelParams>(ids.levels.ground).params.elevation).toBe(0);
  });

  it("new edits clear redo", () => {
    const { doc, ids } = setup();
    doc.transact("A", (tx) => tx.update(ids.levels.roof, { elevation: 6000 }));
    doc.undo();
    expect(doc.canRedo).toBe(true);
    doc.transact("B", (tx) => tx.update(ids.levels.roof, { elevation: 6100 }));
    expect(doc.canRedo).toBe(false);
  });

  it("stored state is isolated from returned objects after commit", () => {
    const { doc, ids } = setup();
    doc.transact("A", (tx) => tx.update(ids.levels.roof, { elevation: 6000 }));
    doc.undo();
    doc.redo();
    expect(doc.require<LevelParams>(ids.levels.roof).params.elevation).toBe(6000);
  });
});

describe("regeneration", () => {
  it("changing a level regenerates walls and floors on it", () => {
    const { doc, ids } = setup();
    const { wall, floor } = doc.transact("Model", (tx) => ({
      wall: createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 1000, y: 0 }, ids.levels.ground, {
        topLevelId: ids.levels.first,
      }),
      floor: createFloor(tx, ids.floorTypes.slab, ids.levels.ground, [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 1000 },
      ]),
    }));
    let last: ChangeSet | undefined;
    doc.on((c) => (last = c));

    doc.transact("Raise first floor", (tx) => tx.update(ids.levels.first, { elevation: 3000 }));
    expect(last?.modified).toEqual([ids.levels.first]);
    expect(last?.regenerate).toContain(wall.id);
    expect(last?.regenerate).not.toContain(floor.id);
    expect(wallExtent(doc, doc.require(wall.id) as Wall).top).toBe(3000);
  });

  it("changing a type regenerates its instances", () => {
    const { doc, ids } = setup();
    const wall = doc.transact("W", (tx) =>
      createWall(tx, ids.wallTypes.interior, { x: 0, y: 0 }, { x: 1000, y: 0 }, ids.levels.ground),
    );
    let last: ChangeSet | undefined;
    doc.on((c) => (last = c));
    doc.transact("Thicker", (tx) =>
      tx.update(ids.wallTypes.interior, {
        layers: [{ function: "structure", material: "Concrete", thickness: 200 }],
      }),
    );
    expect(last?.regenerate).toContain(wall.id);
    expect(wallThickness(doc, doc.require(wall.id) as Wall)).toBe(200);
  });
});

describe("delete", () => {
  it("deleting a level deletes hosted walls, undo restores both", () => {
    const { doc, ids } = setup();
    const wall = doc.transact("W", (tx) =>
      createWall(tx, ids.wallTypes.interior, { x: 0, y: 0 }, { x: 1000, y: 0 }, ids.levels.first),
    );
    doc.transact("Delete level", (tx) => tx.delete(ids.levels.first));
    expect(doc.has(wall.id)).toBe(false);
    doc.undo();
    expect(doc.has(wall.id)).toBe(true);
    expect(doc.has(ids.levels.first)).toBe(true);
  });
});

describe("serialisation", () => {
  it("round-trips through JSON", () => {
    const { doc, ids } = setup();
    doc.transact("W", (tx) =>
      createWall(tx, ids.wallTypes.interior, { x: 0, y: 0 }, { x: 1000, y: 0 }, ids.levels.ground),
    );
    const json = JSON.parse(JSON.stringify(doc.toJSON()));
    const copy = Document.fromJSON(json);
    expect(copy.size).toBe(doc.size);
    expect(copy.toJSON()).toEqual(doc.toJSON());
  });

  it("rejects unknown categories", () => {
    expect(() =>
      Document.fromJSON({ format: "open-bim", version: 1, elements: [{ id: "x", category: "Spaceship", params: {} }] }),
    ).toThrow(/Unknown category/);
  });
});

describe("remote changes", () => {
  it("applies remote edits without undo, and drops local steps that touch them", () => {
    const { doc, ids } = setup();
    const a = doc.transact("Wall A", (tx) => createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 3000, y: 0 }, ids.levels.ground));
    const b = doc.transact("Wall B", (tx) => createWall(tx, ids.wallTypes.exterior, { x: 0, y: 2000 }, { x: 3000, y: 2000 }, ids.levels.ground));
    const sets: ChangeSet[] = [];
    doc.on((c) => sets.push(c));
    const moved = { ...doc.require(a.id), params: { ...doc.require<Wall["params"]>(a.id).params, end: { x: 5000, y: 0 } } };
    doc.applyRemote("Remote", [moved]);
    expect(wallLength(doc.require(a.id) as Wall)).toBe(5000);
    expect(sets[0]).toMatchObject({ remote: true, modified: [a.id] });
    // "Wall B" survives; "Wall A" and everything older are gone from the undo stack.
    expect(doc.undoName).toBe("Wall B");
    doc.undo();
    expect(doc.has(b.id)).toBe(false);
    expect(doc.canUndo).toBe(false);
    doc.applyRemote("Remote", [], [a.id]);
    expect(doc.has(a.id)).toBe(false);
  });

  it("reports orphans left by concurrent edits", () => {
    const { doc, ids } = setup();
    const w = doc.transact("Wall", (tx) => createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 3000, y: 0 }, ids.levels.ground));
    expect(doc.orphans()).toEqual([]);
    doc.applyRemote("Remote", [], [ids.wallTypes.exterior]);
    expect(doc.orphans()).toEqual([w.id]);
  });
});

describe("undo history", () => {
  it("clearHistory leaves the model as it is but with nothing to undo or redo", () => {
    const { doc } = setup();
    expect(doc.canUndo).toBe(true);
    const before = doc.toJSON();
    doc.clearHistory();
    expect(doc.canUndo).toBe(false);
    expect(doc.undo()).toBe(false);
    expect(doc.toJSON()).toEqual(before);
  });
});
