import { describe, expect, it } from "vitest";
import {
  Cat,
  Document,
  applyResidentialTemplate,
  createWall,
  wallJoins,
  type ChangeSet,
  type LayeredTypeParams,
  type Vec2,
  type Wall,
} from "../src/index.ts";

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const type = doc.transact("Type", (tx) =>
    tx.create<LayeredTypeParams>(Cat.WallType, {
      layers: [{ function: "structure", material: "Concrete", thickness: 100 }],
    }),
  ).id;
  const wall = (a: Vec2, b: Vec2, level = ids.levels.ground) =>
    doc.transact("Wall", (tx) => createWall(tx, type, a, b, level, { topLevelId: null, height: 2400 }));
  const changes: ChangeSet[] = [];
  doc.on((c) => changes.push(c));
  return { doc, ids, wall, changes };
}

const p = (x: number, y: number): Vec2 => ({ x, y });

describe("wall join detection", () => {
  it("joins two walls sharing an endpoint (L)", () => {
    const { doc, wall } = setup();
    const a = wall(p(0, 0), p(1000, 0));
    const b = wall(p(0, 0), p(0, 1000));
    expect(wallJoins(doc, a)).toEqual({ start: { kind: "corner", others: [{ wallId: b.id, end: "start" }] }, end: null });
  });

  it("treats a wall ending on another wall's side as a tee", () => {
    const { doc, wall } = setup();
    const through = wall(p(0, 0), p(2000, 0));
    const stem = wall(p(1000, 1000), p(1000, 30)); // stops inside the through wall
    expect(wallJoins(doc, stem).end).toEqual({ kind: "tee", wallId: through.id });
    expect(wallJoins(doc, through)).toEqual({ start: null, end: null });
  });

  it("does not tee walls that stop short, run parallel, or sit on another storey", () => {
    const { doc, ids, wall } = setup();
    wall(p(0, 0), p(2000, 0));
    const short = wall(p(1000, 1000), p(1000, 100));
    const parallel = wall(p(500, 20), p(1500, 20));
    const upstairs = wall(p(500, 1000), p(500, 0), ids.levels.first);
    expect(wallJoins(doc, short).end).toBeNull();
    expect(wallJoins(doc, parallel)).toEqual({ start: null, end: null });
    expect(wallJoins(doc, upstairs).end).toBeNull();
  });
});

describe("wall join regeneration", () => {
  it("moving a wall regenerates the walls it joins, before and after the move", () => {
    const { doc, wall, changes } = setup();
    const a = wall(p(0, 0), p(1000, 0));
    const b = wall(p(0, 0), p(0, 1000));
    const c = wall(p(5000, 0), p(5000, 1000));

    doc.transact("Move", (tx) => tx.update<Wall["params"]>(b.id, { start: p(5000, 0), end: p(4000, 0) }));
    const regen = changes.at(-1)!.regenerate;
    expect(regen).toContain(a.id); // left behind
    expect(regen).toContain(c.id); // newly joined

    doc.undo();
    expect(changes.at(-1)!.regenerate).toEqual(expect.arrayContaining([a.id, b.id, c.id]));
  });

  it("deleting a wall regenerates its neighbours, including walls teeing into it", () => {
    const { doc, wall, changes } = setup();
    const through = wall(p(0, 0), p(2000, 0));
    const corner = wall(p(0, 0), p(0, 1000));
    const stem = wall(p(1000, 1000), p(1000, 0));
    doc.transact("Delete", (tx) => tx.delete(through.id));
    expect(changes.at(-1)!.regenerate.sort()).toEqual([corner.id, stem.id].sort());
  });

  it("changing a wall type regenerates walls joined to its instances", () => {
    const { doc, ids, wall, changes } = setup();
    const stem = wall(p(1000, 1000), p(1000, 0));
    const ext = doc.transact("Ext", (tx) =>
      createWall(tx, ids.wallTypes.exterior, p(0, 0), p(2000, 0), ids.levels.ground, { height: 2400 }),
    );
    doc.transact("Thicker", (tx) =>
      tx.update<LayeredTypeParams>(ids.wallTypes.exterior, {
        layers: [{ function: "structure", material: "Concrete", thickness: 300 }],
      }),
    );
    expect(changes.at(-1)!.regenerate).toEqual(expect.arrayContaining([ext.id, stem.id]));
  });
});
