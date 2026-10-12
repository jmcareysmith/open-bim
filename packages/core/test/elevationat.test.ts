import { describe, expect, it } from "vitest";
import { Document, applyResidentialTemplate, createElevationAt, createWall, viewFrame, type Vec2 } from "../src/index.ts";

describe("Elevation tool: one elevation at a point", () => {
  it("looks square at the nearest wall and spans the model", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const pts: Vec2[] = [
      { x: 0, y: 0 },
      { x: 8000, y: 0 },
      { x: 8000, y: 6000 },
      { x: 0, y: 6000 },
    ];
    doc.transact("Walls", (tx) => pts.forEach((p, i) => createWall(tx, ids.wallTypes.interior, p, pts[(i + 1) % 4]!, ids.levels.ground)));
    // South of the building: looks north.
    const s = doc.transact("E", (tx) => createElevationAt(tx, doc, { x: 4000, y: -3000 }));
    const f = viewFrame(s);
    expect(f.dir[0]).toBeCloseTo(0);
    expect(f.dir[1]).toBeCloseTo(1);
    const line = s.params.line!;
    expect(Math.min(line.start.x, line.end.x)).toBeCloseTo(-1000);
    expect(Math.max(line.start.x, line.end.x)).toBeCloseTo(9000);
    expect(s.params.farClip).toBeCloseTo(12000); // 9 m to the far wall, plus 3 m
    expect(s.name).toBe("Elevation 1");
    // East of it: looks west; names count up.
    const e = doc.transact("E", (tx) => createElevationAt(tx, doc, { x: 11000, y: 3000 }));
    expect(viewFrame(e).dir[0]).toBeCloseTo(-1);
    expect(e.name).toBe("Elevation 2");
  });

  it("needs walls to look at", () => {
    const doc = new Document();
    applyResidentialTemplate(doc);
    expect(() => doc.transact("E", (tx) => createElevationAt(tx, doc, { x: 0, y: 0 }))).toThrow(/walls/);
  });
});
