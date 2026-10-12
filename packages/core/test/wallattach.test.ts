import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  attachWall,
  attachedTopAt,
  createCeiling,
  createFloor,
  createRoof,
  createWall,
  detachWall,
  floorExtent,
  roofBaseElevation,
  wallExtent,
  wallTopBreaks,
  type ChangeSet,
  type Floor,
  type LevelParams,
  type Roof,
  type RoofParams,
  type Vec2,
  type Wall,
} from "../src/index.ts";

const box: Vec2[] = [
  { x: 0, y: 0 },
  { x: 8000, y: 0 },
  { x: 8000, y: 6000 },
  { x: 0, y: 6000 },
];
const SLOPE = (25 * Math.PI) / 180;

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const first = doc.require<LevelParams>(ids.levels.first).params.elevation;
  // Walls without a top level: 2400 high unless attached.
  const walls = doc.transact("Walls", (tx) => box.map((p, i) => createWall(tx, ids.wallTypes.interior, p, box[(i + 1) % 4]!, ids.levels.ground, { height: 2400 }))) as Wall[];
  // Gable roof on the ground level at 2400: long edges (y = 0, y = 6000) sloped, ends gabled.
  const roof = doc.transact("Roof", (tx) => createRoof(tx, ids.roofTypes.steel, ids.levels.ground, box, { slopes: [SLOPE, null, SLOPE, null], baseOffset: 2400 })) as Roof;
  return { doc, ids, walls, roof, first };
}

describe("wall attach", () => {
  it("a gable-end wall's top follows the roof underside, kinked at the ridge", () => {
    const { doc, walls, roof } = setup();
    const gable = walls[1]!; // x = 8000, from y = 0 to y = 6000
    doc.transact("Attach", (tx) => attachWall(tx, doc, gable.id, "top", roof.id));
    const w = doc.require(gable.id) as Wall;
    const breaks = wallTopBreaks(doc, w);
    expect(breaks).toHaveLength(3);
    expect(breaks[1]).toBeCloseTo(3000, 0); // ridge over the middle
    const base = roofBaseElevation(doc, roof);
    const ridge = base + 3000 * Math.tan(SLOPE);
    expect(attachedTopAt(doc, w, { x: 8000, y: 3000 })).toBeCloseTo(ridge, 3);
    expect(attachedTopAt(doc, w, { x: 8000, y: 0 })).toBeCloseTo(base, 3);
    expect(wallExtent(doc, w).top).toBeCloseTo(ridge, 3);
    // An eave wall sits flat under the eave.
    doc.transact("Attach", (tx) => attachWall(tx, doc, walls[0]!.id, "top", roof.id));
    expect(wallTopBreaks(doc, doc.require(walls[0]!.id) as Wall)).toEqual([0, 8000]);
  });

  it("changing the roof regenerates attached walls; detach or delete restores the wall's own height", () => {
    const { doc, walls, roof } = setup();
    doc.transact("Attach", (tx) => attachWall(tx, doc, walls[1]!.id, "top", roof.id));
    let regen: string[] = [];
    doc.on((c: ChangeSet) => (regen = c.regenerate));
    doc.transact("Raise roof", (tx) => tx.update<RoofParams>(roof.id, { baseOffset: 2700 }));
    expect(regen).toContain(walls[1]!.id);
    doc.transact("Detach", (tx) => detachWall(tx, doc, walls[1]!.id, "top"));
    expect(wallExtent(doc, doc.require(walls[1]!.id) as Wall).top).toBeCloseTo(2400);
    doc.transact("Attach", (tx) => attachWall(tx, doc, walls[1]!.id, "top", roof.id));
    doc.transact("Delete roof", (tx) => tx.delete(roof.id));
    expect(regen).toContain(walls[1]!.id);
    expect(doc.has(walls[1]!.id)).toBe(true);
    expect(wallExtent(doc, doc.require(walls[1]!.id) as Wall).top).toBeCloseTo(2400);
  });

  it("tops attach to floor and ceiling undersides; bases to a floor's top", () => {
    const { doc, ids, walls, first } = setup();
    const slab = doc.transact("Floor", (tx) => createFloor(tx, ids.floorTypes.slab, ids.levels.first, box)) as Floor;
    doc.transact("Attach", (tx) => attachWall(tx, doc, walls[2]!.id, "top", slab.id));
    expect(wallExtent(doc, doc.require(walls[2]!.id) as Wall).top).toBeCloseTo(floorExtent(doc, slab).bottom);
    expect(floorExtent(doc, slab).top).toBeCloseTo(first);

    const ground = doc.transact("Floor", (tx) => createFloor(tx, ids.floorTypes.slab, ids.levels.ground, box, { offset: 100 })) as Floor;
    doc.transact("Base", (tx) => attachWall(tx, doc, walls[3]!.id, "base", ground.id));
    expect(wallExtent(doc, doc.require(walls[3]!.id) as Wall).bottom).toBeCloseTo(100);

    const ceiling = doc.transact("Ceiling", (tx) => createCeiling(tx, ids.ceilingTypes.plasterboard, ids.levels.ground, box, { offset: 2100 }));
    doc.transact("Attach", (tx) => attachWall(tx, doc, walls[3]!.id, "top", ceiling.id));
    expect(wallExtent(doc, doc.require(walls[3]!.id) as Wall).top).toBeCloseTo(2100);
  });

  it("refuses the wrong targets and inside-out walls", () => {
    const { doc, ids, walls, roof } = setup();
    expect(() => doc.transact("A", (tx) => attachWall(tx, doc, walls[0]!.id, "base", roof.id))).toThrow(/base attaches to a floor/);
    expect(() => doc.transact("A", (tx) => attachWall(tx, doc, walls[0]!.id, "top", walls[1]!.id))).toThrow(/roof, floor or ceiling/);
    const low = doc.transact("Floor", (tx) => createFloor(tx, ids.floorTypes.slab, ids.levels.ground, box, { offset: -500 })) as Floor;
    expect(() => doc.transact("A", (tx) => attachWall(tx, doc, walls[0]!.id, "top", low.id))).toThrow(/below its base/);
  });
});
