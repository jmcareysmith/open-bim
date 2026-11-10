import { describe, expect, it } from "vitest";
import { Document, applyResidentialTemplate, createDirectShape, wallThickness, type FloorParams, type Wall, type WallParams } from "@open-bim/core";
import { convertDirectShapes, extrudePolygon } from "../src/index.ts";

const box = (pts: { x: number; y: number }[], z0: number, z1: number) => {
  const m = extrudePolygon(pts, [], z0, z1);
  return { positions: [...m.positions], indices: [...m.indices] };
};
const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

describe("IFC shapes to native elements", () => {
  it("turns a boxy IfcWall into a wall with an opening for its window, and an IfcSlab into a floor", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const lvl = ids.levels.ground;
    const mk = (ifcClass: string, mesh: { positions: number[]; indices: number[] }) =>
      doc.transact("I", (tx) => createDirectShape(tx, { levelId: lvl, ifcClass, globalId: ifcClass, ...mesh, color: 0x999999, properties: {} }).id);
    const wall = mk("IfcWall", box(rect(0, -95, 5000, 95), 0, 2700));
    const win = mk("IfcWindow", box(rect(2000, -40, 3200, 40), 900, 2100));
    // L-shaped slab, 200 thick, top at 0.
    const slab = mk("IfcSlab", box([{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 3000 }, { x: 3000, y: 3000 }, { x: 3000, y: 5000 }, { x: 0, y: 5000 }], -200, 0));
    const res = doc.transact("Convert", (tx) => convertDirectShapes(tx, doc, [wall, slab, win]));
    expect(res.skipped).toEqual([win]);
    const walls = doc.byCategory<WallParams>("Wall").filter((w) => w.params.start.y === 0 && Math.abs(w.params.end.x - w.params.start.x) > 4999);
    expect(walls).toHaveLength(1);
    expect(wallThickness(doc, walls[0] as Wall)).toBeCloseTo(190);
    expect(walls[0]!.params.height).toBeCloseTo(2700);
    const opening = doc.byCategory("WallOpening").find((o) => (o.params as { hostId: string }).hostId === walls[0]!.id)!;
    expect((opening.params as { width: number }).width).toBeCloseTo(1200);
    expect((opening.params as { sillHeight: number }).sillHeight).toBeCloseTo(900);
    const floors = doc.byCategory<FloorParams>("Floor");
    const f = floors.find((x) => x.params.boundary.length === 6)!;
    expect(f).toBeDefined();
    expect(f.params.offset).toBeCloseTo(0);
    expect(doc.get(wall)).toBeUndefined();
    expect(doc.get(win)).toBeDefined();
  });
});
