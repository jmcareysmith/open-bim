import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  arcInfo,
  arcLength,
  arcPoints,
  createGrid,
  createWall,
  createWallOpening,
  dragGrip,
  elementGrips,
  flipWall,
  positionAlongWall,
  tangentLine,
  wallJoins,
  setGridCurve,
  setWallCurve,
  type Vec2,
  type Wall,
  createStackedWallType,
} from "@open-bim/core";
import { OcctKernel, SimpleKernel, boundingBox, joinedWallFootprint, meshVolume } from "../src/index.ts";

const p = (x: number, y: number): Vec2 => ({ x, y });
const T = 110; // interior wall thickness

describe("curved walls and grids", () => {
  it("arc maths: a semicircle and a shallow arc", () => {
    const a = arcInfo(p(0, 0), p(4000, 0), 2000)!;
    expect(a.radius).toBeCloseTo(2000);
    expect(a.center.x).toBeCloseTo(2000);
    expect(a.center.y).toBeCloseTo(0);
    expect(arcLength(p(0, 0), p(4000, 0), 2000)).toBeCloseTo(Math.PI * 2000);
    // Bowing left of start → end goes through (2000, 2000).
    const pts = arcPoints(p(0, 0), p(4000, 0), 2000);
    expect(Math.max(...pts.map((q) => q.y))).toBeCloseTo(2000, 0);
    // Bowing right goes below.
    expect(Math.min(...arcPoints(p(0, 0), p(4000, 0), -500).map((q) => q.y))).toBeCloseTo(-500, 0);
    expect(arcInfo(p(0, 0), p(4000, 0), 0)).toBeNull();
  });

  it("a curved wall is its band along the arc; doors and curtains are refused", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const w = doc.transact("W", (tx) => createWall(tx, ids.wallTypes.interior, p(0, 0), p(4000, 0), ids.levels.ground, { height: 2400 })) as Wall;
    doc.transact("Curve", (tx) => setWallCurve(tx, doc, w.id, 2000));
    const m = new SimpleKernel().build(doc, doc.require(w.id))!;
    // Semicircle of radius 2000: area = π·R·t.
    // (5° chords: a hair under the true arc.)
    expect(meshVolume(m) / (Math.PI * 2000 * T * 2400)).toBeCloseTo(1, 2);
    const bb = boundingBox(m);
    expect(bb.max[1]).toBeCloseTo(2000 + T / 2, 0);
    expect(() => doc.transact("Too much", (tx) => setWallCurve(tx, doc, w.id, 2500))).toThrow(/semicircle/);
    // Back to straight.
    doc.transact("Straight", (tx) => setWallCurve(tx, doc, w.id, null));
    expect(boundingBox(new SimpleKernel().build(doc, doc.require(w.id))!).max[1]).toBeCloseTo(T / 2);
    const cw = doc.transact("CW", (tx) => createWall(tx, ids.wallTypes.curtain, p(0, 5000), p(4000, 5000), ids.levels.ground, { height: 2400 }));
    // Curtain walls curve too: the grid runs along the arc, panels flat between grid lines.
    doc.transact("Curve CW", (tx) => setWallCurve(tx, doc, cw.id, 1000));
    const cm = new SimpleKernel().build(doc, doc.require(cw.id))!;
    const arc = arcInfo(p(0, 5000), p(4000, 5000), 1000)!;
    const P = cm.positions;
    let maxOff = 0;
    for (let i = 0; i < P.length; i += 3) maxOff = Math.max(maxOff, Math.abs(Math.hypot(P[i]! - arc.center.x, P[i + 1]! - arc.center.y) - arc.radius));
    // Every vertex within the mullion depth of the arc (nothing left on the chord).
    expect(maxOff).toBeLessThan(120);
    expect(boundingBox(cm).max[1]).toBeGreaterThan(5000 + 900);
  });

  it("stacked walls curve: each segment narrowed radially about the arc", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const st = doc.transact("Type", (tx) => createStackedWallType(tx, doc, "Stack", [{ typeId: ids.wallTypes.exterior, height: 1000 }, { typeId: ids.wallTypes.interior, height: 0 }]));
    const w = doc.transact("W", (tx) => createWall(tx, st.id, p(0, 0), p(4000, 0), ids.levels.ground, { height: 2400 }));
    doc.transact("C", (tx) => setWallCurve(tx, doc, w.id, 800));
    const m = new SimpleKernel().build(doc, doc.require(w.id))!;
    const arc = arcInfo(p(0, 0), p(4000, 0), 800)!;
    const P = m.positions;
    // Below 1000 the exterior type (139), above it the interior (110): radial spread per band.
    const all = (z0: number, z1: number) => {
      const rs: number[] = [];
      for (let i = 0; i < P.length; i += 3) if (P[i + 2]! >= z0 - 0.5 && P[i + 2]! <= z1 + 0.5) rs.push(Math.hypot(P[i]! - arc.center.x, P[i + 1]! - arc.center.y));
      return Math.max(...rs) - Math.min(...rs);
    };
    expect(all(0, 1000)).toBeCloseTo(139, 0);
    expect(all(2400, 2400)).toBeCloseTo(110, 0);
  });

  it("curved walls host openings square to the arc; clicks project onto it; flips keep the shape; the bow grip bends it", async () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const w = doc.transact("W", (tx) => createWall(tx, ids.wallTypes.interior, p(0, 0), p(4000, 0), ids.levels.ground, { height: 2400 })) as Wall;
    doc.transact("Curve", (tx) => setWallCurve(tx, doc, w.id, 2000));
    const arc = () => doc.require(w.id) as Wall;
    // Half way round the semicircle is its top, (2000, 2000).
    expect(positionAlongWall(arc(), p(2000, 2600))).toBeCloseTo(Math.PI * 1000, 0);
    const t = tangentLine(arc(), Math.PI * 1000);
    expect(t.start.x + t.dir.x * Math.PI * 1000).toBeCloseTo(2000, 3);
    expect(t.start.y + t.dir.y * Math.PI * 1000).toBeCloseTo(2000, 3);
    expect(Math.abs(t.dir.x)).toBeCloseTo(1, 6);
    const occt = await OcctKernel.create();
    const before = meshVolume(occt.build(doc, arc())!);
    doc.transact("Opening", (tx) => createWallOpening(tx, doc, w.id, Math.PI * 1000, { width: 900, height: 2100 }));
    expect(meshVolume(occt.build(doc, arc())!)).toBeLessThan(before - 900 * 2000 * T * 0.9);
    // Flipped: same arc, same place for the opening.
    const bb0 = boundingBox(new SimpleKernel().build(doc, arc())!);
    doc.transact("Flip", (tx) => flipWall(tx, doc, w.id));
    const bb1 = boundingBox(new SimpleKernel().build(doc, arc())!);
    expect(bb1.max[1]).toBeCloseTo(bb0.max[1], 3);
    expect(bb1.min[1]).toBeCloseTo(bb0.min[1], 3);
    // The middle grip: drag it to bow less.
    const bow = elementGrips(doc, arc()).find((g) => g.key === "bow")!;
    expect(bow.point.y).toBeCloseTo(2000, 3);
    doc.transact("Bow", (tx) => dragGrip(tx, doc, w.id, "bow", p(2000, 800)));
    expect(Math.abs(arc().params.curve!)).toBe(800);
  }, 60_000);

  it("curved grids draw along their arc with bubbles at the ends", () => {
    const doc = new Document();
    applyResidentialTemplate(doc);
    const g = doc.transact("G", (tx) => createGrid(tx, doc, p(0, 0), p(10000, 0), "R1"));
    doc.transact("Curve", (tx) => setGridCurve(tx, doc, g.id, 2000));
    const lines = new SimpleKernel().buildLines(doc, doc.require(g.id), 100)!;
    const ys: number[] = [];
    for (let i = 1; i < lines.segments.length; i += 3) ys.push(lines.segments[i]!);
    expect(Math.max(...ys)).toBeGreaterThan(1900);
    expect(lines.labels.map((l) => l.text)).toEqual(["R1", "R1"]);
  });

  it("curved walls corner-join straight ones end to end, mitred on the end tangent", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const [arc, straight] = doc.transact("W", (tx) => [
      createWall(tx, ids.wallTypes.interior, p(0, 0), p(4000, 0), ids.levels.ground, { height: 2400 }),
      createWall(tx, ids.wallTypes.interior, p(4000, 0), p(4000, 3000), ids.levels.ground, { height: 2400 }),
    ]);
    // Bow right (down), so the arc leaves (4000, 0) heading up-ish and meets the straight wall at an angle.
    doc.transact("Curve", (tx) => setWallCurve(tx, doc, arc!.id, -800));
    expect(wallJoins(doc, doc.require(arc!.id) as Wall).end?.kind).toBe("corner");
    const fa = joinedWallFootprint(doc, doc.require(arc!.id) as Wall);
    const fb = joinedWallFootprint(doc, doc.require(straight!.id) as Wall);
    // The two footprints share their cut points at the joint (no gap, no overlap there).
    const shared = fa.filter((q) => fb.some((r) => Math.hypot(q.x - r.x, q.y - r.y) < 1e-6));
    expect(shared.length).toBe(2);
    // And the straight wall's end is no longer square.
    const square = fb.filter((q) => Math.abs(q.y) < 1e-6).length;
    expect(square).toBeLessThan(2);
  });
});
