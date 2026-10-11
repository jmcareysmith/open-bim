import { describe, expect, it } from "vitest";
import { Document, applyResidentialTemplate, createGrid, createReferencePlane } from "@open-bim/core";
import { GRID_BUBBLE_RADIUS, SimpleKernel } from "../src/index.ts";

describe("grid line work", () => {
  it("draws the grid line plus a labelled bubble beyond each end", () => {
    const doc = new Document();
    applyResidentialTemplate(doc);
    const g = doc.transact("Grid", (tx) => createGrid(tx, doc, { x: 0, y: 0 }, { x: 0, y: 5000 }, "A"));
    const k = new SimpleKernel();

    expect(k.build(doc, g)).toBeNull();
    const lines = k.buildLines(doc, g)!;
    expect(Array.from(lines.segments.slice(0, 6))).toEqual([0, 0, 0, 0, 5000, 0]);
    expect(lines.segments.length % 6).toBe(0);
    const r = GRID_BUBBLE_RADIUS;
    expect(lines.labels).toEqual([
      { text: "A", position: [0, -r, 0] },
      { text: "A", position: [0, 5000 + r, 0] },
    ]);
    // Bubble points sit on the circle
    for (let i = 6; i < lines.segments.length; i += 3) {
      const y = lines.segments[i + 1]!;
      const cy = y < 2500 ? -r : 5000 + r;
      expect(Math.hypot(lines.segments[i]!, y - cy)).toBeCloseTo(r, 2);
    }
  });

  it("has no line work for walls", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    expect(new SimpleKernel().buildLines(doc, doc.require(ids.levels.ground))).toBeNull();
  });
});

describe("reference plane line work", () => {
  it("is a single dashed segment, labelled only when named", () => {
    const doc = new Document();
    applyResidentialTemplate(doc);
    const [plain, named] = doc.transact("RP", (tx) => [
      createReferencePlane(tx, doc, { x: 0, y: 0 }, { x: 1000, y: 0 }),
      createReferencePlane(tx, doc, { x: 0, y: 500 }, { x: 0, y: 1500 }, "Centre"),
    ]);
    const k = new SimpleKernel();
    const a = k.buildLines(doc, plain!)!;
    expect(a.dashed).toBe(true);
    expect(Array.from(a.segments)).toEqual([0, 0, 0, 1000, 0, 0]);
    expect(a.labels).toEqual([]);
    expect(k.buildLines(doc, named!)!.labels).toEqual([{ text: "Centre", position: [0, 1800, 0] }]);
  });
});
