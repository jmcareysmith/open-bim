import { beforeAll, describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createWallOpening,
  createWall,
  setWallSweeps,
  setWallProfile,
  gableProfile,
  sweepProfileNames,
  wallSweeps,
  type Vec2,
  type Wall,
} from "@open-bim/core";
import { OcctKernel, SimpleKernel, boundingBox, meshVolume, wallSweepSolids } from "../src/index.ts";

const p = (x: number, y: number): Vec2 => ({ x, y });
const T = 110; // interior wall type thickness

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const wall = doc.transact("W", (tx) => createWall(tx, ids.wallTypes.interior, p(0, 0), p(4000, 0), ids.levels.ground, { height: 2400 })) as Wall;
  return { doc, ids, wall };
}

let occt: OcctKernel;
beforeAll(async () => {
  occt = await OcctKernel.create();
}, 60_000);

describe("wall sweeps and reveals", () => {
  it("a type skirting runs along its face on every wall of the type", () => {
    const { doc, ids, wall } = setup();
    doc.transact("Sweep", (tx) => setWallSweeps(tx, doc, ids.wallTypes.interior, [{ kind: "sweep", profile: "Skirting 90 x 12", side: "interior", height: 0 }]));
    expect(wallSweeps(doc, doc.require(wall.id) as Wall)).toHaveLength(1);
    const { sweeps } = wallSweepSolids(doc, doc.require(wall.id) as Wall);
    expect(sweeps).toHaveLength(1);
    const b = boundingBox(sweeps[0]!);
    // Interior face is on the right of start → end (y < 0), 12 mm proud, 90 mm high, the wall's length.
    expect(b.min[1]).toBeCloseTo(-T / 2 - 12, 3);
    expect(b.max[1]).toBeCloseTo(-T / 2, 3);
    expect(b.max[2] - b.min[2]).toBeCloseTo(90, 3);
    expect(b.max[0] - b.min[0]).toBeCloseTo(4000, 3);
    expect(meshVolume(sweeps[0]!)).toBeGreaterThan(0);
    // The wall's mesh carries it.
    const mesh = new SimpleKernel().build(doc, doc.require(wall.id))!;
    expect(boundingBox(mesh).min[1]).toBeCloseTo(-T / 2 - 12, 3);
  });

  it("sweeps stop at openings they cross; an instance sweep can run over part of the wall", () => {
    const { doc, wall } = setup();
    doc.transact("Opening", (tx) => createWallOpening(tx, doc, wall.id, 2000, { width: 900, sillHeight: 0, height: 2100 }));
    doc.transact("Sweeps", (tx) =>
      setWallSweeps(tx, doc, wall.id, [
        { kind: "sweep", profile: "Skirting 90 x 12", side: "exterior", height: 0 },
        { kind: "sweep", profile: "Chair Rail 60 x 20", side: "exterior", height: 2200, from: 500, to: 1500 },
      ]),
    );
    const { sweeps } = wallSweepSolids(doc, doc.require(wall.id) as Wall);
    // Skirting in two pieces either side of the opening; the chair rail above it in one.
    expect(sweeps).toHaveLength(3);
    const rail = boundingBox(sweeps[2]!);
    expect(rail.min[0]).toBeCloseTo(500, 3);
    expect(rail.max[0]).toBeCloseTo(1500, 3);
    expect(rail.min[1]).toBeCloseTo(T / 2, 3);
  });

  it("rejects bad sweeps", () => {
    const { doc, wall } = setup();
    expect(() => doc.transact("Bad", (tx) => setWallSweeps(tx, doc, wall.id, [{ kind: "sweep", profile: "x", side: "exterior", height: 0, from: 10, to: 5 }]))).toThrow(/end after/);
    expect(sweepProfileNames("reveal").length).toBeGreaterThan(0);
  });

  it("reveals cut a groove into the wall (OCCT)", () => {
    const { doc, wall } = setup();
    const before = meshVolume(occt.build(doc, doc.require(wall.id))!);
    doc.transact("Reveal", (tx) => setWallSweeps(tx, doc, wall.id, [{ kind: "reveal", profile: "Reveal 20 x 20", side: "exterior", height: 1200 }]));
    const after = meshVolume(occt.build(doc, doc.require(wall.id))!);
    expect(before - after).toBeCloseTo(20 * 20 * 4000, -3);
  });

  it("Edit Profile: a gable-end wall is its outline through its thickness, openings still cut", () => {
    const { doc, wall } = setup();
    doc.transact("Profile", (tx) => setWallProfile(tx, doc, wall.id, gableProfile(4000, 2400, 4000)));
    const area = 4000 * 2400 + (4000 * 1600) / 2;
    const simple = new SimpleKernel().build(doc, doc.require(wall.id))!;
    expect(meshVolume(simple)).toBeCloseTo(area * T, -4);
    expect(boundingBox(simple).max[2]).toBeCloseTo(4000, 3);
    doc.transact("Opening", (tx) => createWallOpening(tx, doc, wall.id, 2000, { width: 1000, sillHeight: 0, height: 2000 }));
    expect(meshVolume(occt.build(doc, doc.require(wall.id))!)).toBeCloseTo((area - 1000 * 2000) * T, -4);
    expect(() => doc.transact("Bad", (tx) => setWallProfile(tx, doc, wall.id, [p(0, 0), p(1, 1)]))).toThrow(/3 points/);
    doc.transact("Reset", (tx) => setWallProfile(tx, doc, wall.id, null));
    expect(boundingBox(new SimpleKernel().build(doc, doc.require(wall.id))!).max[2]).toBeCloseTo(2400, 3);
  });
});
