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
  setGridCurve,
  setWallCurve,
  type Vec2,
  type Wall,
} from "@open-bim/core";
import { SimpleKernel, boundingBox, meshVolume } from "../src/index.ts";

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
    expect(() => doc.transact("Door", (tx) => createWallOpening(tx, doc, w.id, 2000))).toThrow(/Curved walls/);
    // Back to straight.
    doc.transact("Straight", (tx) => setWallCurve(tx, doc, w.id, null));
    expect(boundingBox(new SimpleKernel().build(doc, doc.require(w.id))!).max[1]).toBeCloseTo(T / 2);
    const cw = doc.transact("CW", (tx) => createWall(tx, ids.wallTypes.curtain, p(0, 5000), p(4000, 5000), ids.levels.ground, { height: 2400 }));
    expect(() => doc.transact("Curve CW", (tx) => setWallCurve(tx, doc, cw.id, 500))).toThrow(/straight for now/);
  });

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
});
