import { describe, expect, it } from "vitest";
import {
  Document,
  applyFamilyTemplate,
  applyResidentialTemplate,
  createExtrusion,
  loadFamily,
  placeFamilyInstance,
  type NumPt,
} from "@open-bim/core";
import { SimpleKernel, boundingBox, meshVolume } from "../src/index.ts";

const rect = (x0: string | number, y0: string | number, x1: string | number, y1: string | number): NumPt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

describe("family instance geometry", () => {
  it("places the family mesh on its level, rotated", () => {
    const fam = new Document();
    applyFamilyTemplate(fam, "Furniture");
    fam.transact("Top", (tx) => createExtrusion(tx, rect("-Width/2", 0, "Width/2", "Depth"), { start: "Height - 30", end: "Height" }));
    const project = new Document();
    const ids = applyResidentialTemplate(project);
    const def = project.transact("Load", (tx) => loadFamily(tx, project, fam, "Table"));
    const inst = project.transact("Place", (tx) =>
      placeFamilyInstance(tx, project, def.id, "Default", { levelId: ids.levels.first, position: { x: 5000, y: 2000 }, rotation: Math.PI / 2 }),
    );
    const m = new SimpleKernel().build(project, inst)!;
    expect(meshVolume(m)).toBeCloseTo(1200 * 600 * 30, -2);
    const bb = boundingBox(m);
    // Rotated 90 degrees: width now runs along Y, depth towards -X.
    expect(bb.min[0]).toBeCloseTo(5000 - 600);
    expect(bb.max[0]).toBeCloseTo(5000);
    expect(bb.min[1]).toBeCloseTo(2000 - 600);
    expect(bb.max[1]).toBeCloseTo(2000 + 600);
    expect(bb.max[2]).toBeCloseTo(2700 + 750);
  });
});
