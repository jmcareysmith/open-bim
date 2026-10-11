import { describe, expect, it } from "vitest";
import { Document, applyResidentialTemplate, createDoor, createWall, createWindow, type DoorParams, type Vec2 } from "@open-bim/core";
import { SimpleKernel, boundingBox, meshVolume } from "../src/index.ts";

const p = (x: number, y: number): Vec2 => ({ x, y });
const T = 110;

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const wall = doc.transact("W", (tx) => createWall(tx, ids.wallTypes.interior, p(0, 0), p(4000, 0), ids.levels.ground, { height: 2400 }));
  return { doc, ids, wall, k: new SimpleKernel() };
}

describe("door geometry", () => {
  it("frame through the wall plus a closed 40 mm leaf", () => {
    const { doc, ids, wall, k } = setup();
    const d = doc.transact("D", (tx) => createDoor(tx, doc, ids.doorTypes.single810, wall.id, 2000));
    const m = k.build(doc, d)!;
    const jambs = 2 * 30 * T * 2010;
    const head = 810 * T * 30;
    const leaf = 810 * 40 * 1980;
    expect(meshVolume(m)).toBeCloseTo(jambs + head + leaf, -3);
    expect(boundingBox(m)).toEqual({ min: [2000 - 435, -55, 0], max: [2000 + 435, 55, 2010] });
  });

  it("draws its swing in plan only, on the facing side, hinged per hand", () => {
    const { doc, ids, wall, k } = setup();
    const d = doc.transact("D", (tx) => createDoor(tx, doc, ids.doorTypes.single810, wall.id, 2000));
    const lines = k.buildLines(doc, d)!;
    expect(lines.planOnly).toBe(true);
    // Open leaf: from the hinge (wall-start side) out 810 to the left face side (+y).
    expect(Array.from(lines.segments.slice(0, 6))).toEqual([1595, 55, 10, 1595, 865, 10]);
    doc.transact("Flip", (tx) => tx.update<DoorParams>(d.id, { facingFlipped: true, handFlipped: true }));
    const flipped = k.buildLines(doc, doc.require(d.id))!;
    expect(Array.from(flipped.segments.slice(0, 6))).toEqual([2405, -55, 10, 2405, -865, 10]);
  });
});

describe("window geometry", () => {
  it("frame centred in the wall with glass, at its sill", () => {
    const { doc, ids, wall, k } = setup();
    const w = doc.transact("Win", (tx) => createWindow(tx, doc, ids.windowTypes.w1200x1200, wall.id, 2000));
    const m = k.build(doc, w)!;
    const bb = boundingBox(m);
    expect(bb.min[2]).toBe(900);
    expect(bb.max[2]).toBe(2100);
    expect(bb.min[1]).toBeCloseTo(-50); // 100 deep frame inside a 110 wall
    const frame = (2 * 50 * 1200 + 2 * 1100 * 50) * 100;
    const glass = 1100 * 1100 * 10;
    expect(meshVolume(m)).toBeCloseTo(frame + glass, -3);
  });
});
