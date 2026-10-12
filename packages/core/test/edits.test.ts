import { describe, expect, it } from "vitest";
import {
  Cat,
  Document,
  alignElement,
  applyResidentialTemplate,
  createDoor,
  createGrid,
  createWall,
  elementLine,
  nearestLine,
  offsetElements,
  splitElement,
  trimExtend,
  trimToCorner,
  wallThickness,
  type DoorParams,
  type Wall,
  type WallParams,
} from "../src/index.ts";

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const wall = (a: [number, number], b: [number, number]) =>
    doc.transact("Wall", (tx) => createWall(tx, ids.wallTypes.interior, { x: a[0], y: a[1] }, { x: b[0], y: b[1] }, ids.levels.ground));
  return { doc, ids, wall };
}
const P = (doc: Document, id: string) => doc.require<WallParams>(id).params;

describe("trim / extend", () => {
  it("trims two walls to a corner, keeping the clicked parts", () => {
    const { doc, wall } = setup();
    const a = wall([0, 0], [5000, 0]); // runs past the corner at x = 4000
    const b = wall([4000, -1000], [4000, 3000]); // starts below the corner
    doc.transact("Trim", (tx) => trimToCorner(tx, doc, a.id, { x: 1000, y: 0 }, b.id, { x: 4000, y: 2000 }));
    expect(P(doc, a.id).end).toEqual({ x: 4000, y: 0 });
    expect(P(doc, b.id).start).toEqual({ x: 4000, y: 0 });
  });

  it("extends a wall to a grid; doors keep their place when the start moves", () => {
    const { doc, ids, wall } = setup();
    const w = wall([1000, 0], [4000, 0]);
    const door = doc.transact("Door", (tx) => createDoor(tx, doc, ids.doorTypes.single810, w.id, 1500)); // at x = 2500
    const g = doc.transact("Grid", (tx) => createGrid(tx, doc, { x: 0, y: -5000 }, { x: 0, y: 5000 }));
    doc.transact("Extend", (tx) => trimExtend(tx, doc, w.id, { x: 3000, y: 0 }, elementLine(g)));
    expect(P(doc, w.id).start).toEqual({ x: 0, y: 0 });
    expect(doc.require<DoorParams>(door.id).params.position).toBeCloseTo(2500);
    // Trimming through the door is refused.
    const cut = doc.transact("Grid", (tx) => createGrid(tx, doc, { x: 2600, y: -5000 }, { x: 2600, y: 5000 }));
    expect(() => doc.transact("Trim", (tx) => trimExtend(tx, doc, w.id, { x: 3500, y: 0 }, elementLine(cut)))).toThrow(/cut a door/);
  });

  it("parallel lines can't be trimmed to each other", () => {
    const { doc, wall } = setup();
    const a = wall([0, 0], [1000, 0]);
    const b = wall([0, 500], [1000, 500]);
    expect(() => doc.transact("Trim", (tx) => trimToCorner(tx, doc, a.id, { x: 0, y: 0 }, b.id, { x: 0, y: 500 }))).toThrow(/parallel/);
  });
});

describe("split", () => {
  it("splits a wall in two; doors past the cut move to the new wall", () => {
    const { doc, ids, wall } = setup();
    const w = wall([0, 0], [6000, 0]);
    const d1 = doc.transact("Door", (tx) => createDoor(tx, doc, ids.doorTypes.single810, w.id, 1000));
    const d2 = doc.transact("Door", (tx) => createDoor(tx, doc, ids.doorTypes.single810, w.id, 5000));
    const second = doc.transact("Split", (tx) => splitElement(tx, doc, w.id, { x: 3000, y: 40 }));
    expect(P(doc, w.id).end).toEqual({ x: 3000, y: 0 });
    expect(P(doc, second).start).toEqual({ x: 3000, y: 0 });
    expect(P(doc, second).end).toEqual({ x: 6000, y: 0 });
    expect(doc.require<DoorParams>(d1.id).params.hostId).toBe(w.id);
    expect(doc.require<DoorParams>(d2.id).params).toMatchObject({ hostId: second, position: 2000 });
    expect(() => doc.transact("Split", (tx) => splitElement(tx, doc, w.id, { x: 1100, y: 0 }))).toThrow(/through a door/);
    expect(() => doc.transact("Split", (tx) => splitElement(tx, doc, w.id, { x: 0, y: 0 }))).toThrow(/inside/);
  });
});

describe("align / offset", () => {
  it("aligns a wall face to a grid; the picked face lands on it", () => {
    const { doc, wall } = setup();
    const w = wall([0, 0], [0, 3000]);
    const g = doc.transact("Grid", (tx) => createGrid(tx, doc, { x: 1000, y: -5000 }, { x: 1000, y: 5000 }));
    const half = wallThickness(doc, w as Wall) / 2;
    // Pick the wall's east face (x = +half).
    doc.transact("Align", (tx) => alignElement(tx, doc, elementLine(g), w.id, { x: half - 1, y: 1500 }));
    expect(P(doc, w.id).start.x).toBeCloseTo(1000 - half);
    const face = nearestLine(doc, doc.require(w.id), { x: 1000, y: 0 })!;
    expect(face.point.x).toBeCloseTo(1000);
    // Not parallel → refused.
    const g2 = doc.transact("Grid", (tx) => createGrid(tx, doc, { x: -5000, y: 0 }, { x: 5000, y: 100 }));
    expect(() => doc.transact("Align", (tx) => alignElement(tx, doc, elementLine(g2), w.id, { x: 0, y: 0 }))).toThrow(/parallel/);
  });

  it("offset copies a wall to the side of the cursor", () => {
    const { doc, wall } = setup();
    const w = wall([0, 0], [4000, 0]);
    const [copy] = doc.transact("Offset", (tx) => offsetElements(tx, doc, [w.id], 600, { x: 2000, y: -50 }));
    expect(P(doc, copy!).start).toEqual({ x: 0, y: -600 });
    expect(doc.byCategory(Cat.Wall)).toHaveLength(2);
    doc.transact("Offset", (tx) => offsetElements(tx, doc, [w.id], 600, { x: 2000, y: 50 }, false));
    expect(P(doc, w.id).start).toEqual({ x: 0, y: 600 });
  });
});
