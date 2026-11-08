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
  it("frame through the wall, architraves both faces, a closed 40 mm leaf and handles", () => {
    const { doc, ids, wall, k } = setup();
    const d = doc.transact("D", (tx) => createDoor(tx, doc, ids.doorTypes.single810, wall.id, 2000));
    const m = k.build(doc, d)!;
    const jambs = 2 * 30 * T * 2010;
    const head = 810 * T * 30;
    const leaf = 810 * 40 * 1980;
    // 70 × 18 architraves: two legs and a head each side.
    const arch = 2 * (2 * 70 * 18 * 2080 + 870 * 18 * 70);
    const handles = 2 * (20 * 50 * 20 + 130 * 20 * 18);
    expect(meshVolume(m)).toBeCloseTo(jambs + head + leaf + arch + handles, -3);
    // Architraves stand 70 past the opening and 18 off each face.
    expect(boundingBox(m)).toEqual({ min: [2000 - 435 - 70, -80, 0], max: [2000 + 435 + 70, 80, 2080] }); // handles stand 80 off the leaf centre
    // Trim, timber and metal colours.
    expect(m.colors).toBeDefined();
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
    // A sill sits just under the frame, standing 40 out from the exterior face.
    expect(bb.min[2]).toBe(875);
    expect(bb.max[2]).toBe(2100);
    expect(bb.min[1]).toBeCloseTo(-50); // 100 deep frame inside a 110 wall
    expect(bb.max[1]).toBeCloseTo(55 + 40);
    // Wider than 1000: two sashes either side of a mullion, each with its own glass.
    expect(m.glass!.count).toBe(2 * 36);
    expect(m.glass!.start + m.glass!.count).toBe(m.indices.length);
  });
});

describe("window plan symbol", () => {
  it("draws jambs, frame faces and glass, plan-only", () => {
    const { doc, ids, wall, k } = setup();
    const w = doc.transact("Win", (tx) => createWindow(tx, doc, ids.windowTypes.w1200x1200, wall.id, 2000));
    const lines = k.buildLines(doc, w)!;
    expect(lines.planOnly).toBe(true);
    expect(lines.segments.length).toBe(5 * 6);
    expect(Array.from(lines.segments.slice(24, 30))).toEqual([1400, 0, 10, 2600, 0, 10]); // glass on the location line
  });
});
