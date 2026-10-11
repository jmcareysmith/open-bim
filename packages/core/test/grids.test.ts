import { describe, expect, it } from "vitest";
import {
  Cat,
  Document,
  applyResidentialTemplate,
  closestPointOnDatum,
  createGrid,
  datumIntersection,
  incrementGridName,
  nextGridName,
  renameGrid,
  type Grid,
  type Vec2,
} from "../src/index.ts";

const p = (x: number, y: number): Vec2 => ({ x, y });

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const grid = (a: Vec2, b: Vec2, name?: string) => doc.transact("Grid", (tx) => createGrid(tx, doc, a, b, name));
  return { doc, ids, grid };
}

describe("grid names", () => {
  it.each([
    ["1", "2"],
    ["9", "10"],
    ["A", "B"],
    ["H", "J"],
    ["I", "J"],
    ["N", "P"],
    ["Z", "AA"],
    ["AZ", "BA"],
    ["a", "b"],
    ["A9", "A10"],
    ["Grid-", "Grid-1"],
  ])("%s → %s", (from, to) => expect(incrementGridName(from)).toBe(to));

  it("continues the latest series and skips names in use", () => {
    const { doc, grid } = setup();
    expect(nextGridName(doc)).toBe("1");
    expect(grid(p(0, 0), p(0, 1000)).name).toBe("1");
    grid(p(1000, 0), p(1000, 1000), "3");
    grid(p(0, 0), p(1000, 0), "A");
    expect(grid(p(0, 500), p(1000, 500)).name).toBe("B");
    grid(p(0, 900), p(1000, 900), "2");
    expect(nextGridName(doc)).toBe("4"); // "3" is taken
  });

  it("rejects duplicate names on create and rename", () => {
    const { doc, grid } = setup();
    const a = grid(p(0, 0), p(0, 1000), "A");
    const b = grid(p(1000, 0), p(1000, 1000), "B");
    expect(() => grid(p(2000, 0), p(2000, 1000), "A")).toThrow(/already in use/);
    expect(() => doc.transact("Rename", (tx) => renameGrid(tx, doc, b.id, "A"))).toThrow(/already in use/);
    doc.transact("Rename", (tx) => renameGrid(tx, doc, a.id, "A")); // own name is fine
    expect(doc.require(b.id).name).toBe("B");
  });
});

describe("grids", () => {
  it("are datums: deleting a level leaves them, undo removes them", () => {
    const { doc, ids, grid } = setup();
    const g = grid(p(0, 0), p(0, 5000));
    doc.transact("Delete level", (tx) => tx.delete(ids.levels.roof));
    expect(doc.has(g.id)).toBe(true);
    doc.undo();
    doc.undo();
    expect(doc.has(g.id)).toBe(false);
  });

  it("survive save and load", () => {
    const { doc, grid } = setup();
    const g = grid(p(0, 0), p(0, 5000), "A");
    const copy = Document.fromJSON(JSON.parse(JSON.stringify(doc.toJSON())));
    expect(copy.require<Grid["params"]>(g.id)).toMatchObject({ name: "A", params: { start: p(0, 0), end: p(0, 5000) } });
    expect(copy.byCategory(Cat.Grid)).toHaveLength(1);
  });

  it("rejects zero-length grids", () => {
    const { grid } = setup();
    expect(() => grid(p(5, 5), p(5, 5))).toThrow(/non-zero/);
  });

  it("intersect within their extents only", () => {
    const { grid } = setup();
    const v = grid(p(4000, -1000), p(4000, 9000));
    const h = grid(p(-1000, 5000), p(11000, 5000));
    const short = grid(p(0, 0), p(1000, 0));
    expect(datumIntersection(v, h)).toEqual(p(4000, 5000));
    expect(datumIntersection(v, short)).toBeNull();
    expect(closestPointOnDatum(v, p(4300, 2000))).toEqual(p(4000, 2000));
    expect(closestPointOnDatum(v, p(4000, 20000))).toEqual(p(4000, 9000));
  });
});
