import { describe, expect, it } from "vitest";
import { Document, applyResidentialTemplate, createPointCloud, createSection, floorPlanFor, parseAsciiPoints } from "@open-bim/core";
import { SimpleKernel, viewDrawing } from "../src/index.ts";

describe("point clouds on drawings", () => {
  it("plans show points between the view depth and the cut, as coloured squares; sections those beyond the line", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    // Centred on the origin: (-1,-1) at 0.5 m red, (1,1) at 2 m (above the 1200 cut) blue.
    const raw = parseAsciiPoints("-1 -1 0.5 255 0 0\n1 1 2 0 0 255\n");
    const pc = doc.transact("PC", (tx) => createPointCloud(tx, doc, raw, "scan", "centre"));
    const plan = viewDrawing(doc, new SimpleKernel(), floorPlanFor(doc, ids.levels.ground)!);
    const fills = plan.fills.filter((f) => f.id === pc.id);
    expect(fills).toHaveLength(1);
    expect(fills[0]!.color).toBe(0xff0000);
    const sq = fills[0]!.loops[0]!;
    expect(sq[0]).toEqual({ x: -1000 - 25, y: -1000 - 25 }); // 0.5 mm at 1:100
    // A section along y = 0 looking north (+y) sees only the (1, 1) point.
    const s = doc.transact("S", (tx) => createSection(tx, doc, { x: -5000, y: 0 }, { x: 5000, y: 0 }));
    const sec = viewDrawing(doc, new SimpleKernel(), s).fills.filter((f) => f.id === pc.id);
    expect(sec).toHaveLength(1);
    expect(sec[0]!.color).toBe(0x0000ff);
  });
});
