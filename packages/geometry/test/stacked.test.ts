import { describe, expect, it } from "vitest";
import { Document, applyResidentialTemplate, createStackedWallType, createWall, stackSegments, wallThickness } from "@open-bim/core";
import { SimpleKernel, boundingBox, meshVolume } from "../src/index.ts";

describe("stacked walls", () => {
  it("stack member types bottom to top, the variable one filling the height", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const st = doc.transact("Type", (tx) =>
      createStackedWallType(tx, doc, "Stacked - Block base, weatherboard over", [
        { typeId: ids.wallTypes.interior, height: 900 },
        { typeId: ids.wallTypes.exterior, height: 0 },
      ]),
    );
    const w = doc.transact("W", (tx) => createWall(tx, st.id, { x: 0, y: 0 }, { x: 4000, y: 0 }, ids.levels.ground, { topLevelId: ids.levels.first }));
    const segs = stackSegments(doc, w);
    expect(segs.map((s) => [s.bottom, s.top])).toEqual([
      [0, 900],
      [900, 2700],
    ]);
    // The stack takes its thickest member's thickness for joins.
    expect(wallThickness(doc, w)).toBe(139);
    const m = new SimpleKernel().build(doc, w)!;
    expect(m.colors).toBeDefined();
    const vol = meshVolume(m);
    expect(vol).toBeCloseTo(4000 * (110 * 900 + 139 * 1800), -4);
    expect(boundingBox(m).max[2]).toBeCloseTo(2700);
    expect(() =>
      doc.transact("Bad", (tx) => createStackedWallType(tx, doc, "x", [{ typeId: ids.wallTypes.interior, height: 900 }, { typeId: ids.wallTypes.exterior, height: 900 }])),
    ).toThrow(/variable/);
    // Member types can't be deleted while stacked.
    expect(() => doc.transact("Del", (tx) => tx.delete(ids.wallTypes.interior))).toThrow();
  });
});
