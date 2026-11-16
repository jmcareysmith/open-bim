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
  it("turns a boxy IfcWall into a wall with a native window, and an IfcSlab into a floor", () => {
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
    // The imported window becomes a native window of the matching 1200 x 1200 type, at its sill.
    const win2 = doc.byCategory("Window").find((o) => (o.params as { hostId: string }).hostId === walls[0]!.id)!;
    expect(doc.get(win2.typeId!)!.params).toMatchObject({ width: 1200, height: 1200 });
    expect((win2.params as { sillHeight: number }).sillHeight).toBeCloseTo(900);
    const floors = doc.byCategory<FloorParams>("Floor");
    const f = floors.find((x) => x.params.boundary.length === 6)!;
    expect(f).toBeDefined();
    expect(f.params.offset).toBeCloseTo(0);
    expect(doc.get(wall)).toBeUndefined();
    expect(doc.get(win)).toBeUndefined();
  });
});

describe("IFC columns and beams to native", () => {
  it("makes columns (rectangular, turned to the long side; round) and beams with matching sections", async () => {
    const { columnExtent } = await import("@open-bim/core");
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const lvl = ids.levels.ground;
    const mk = (ifcClass: string, mesh: { positions: number[]; indices: number[] }) =>
      doc.transact("I", (tx) => createDirectShape(tx, { levelId: lvl, ifcClass, globalId: ifcClass, ...mesh, color: 0x999999, properties: {} }).id);
    // 300 across x, 500 along y; base 0, top 2700 (the first floor level).
    const rect = mk("IfcColumn", box([{ x: 850, y: 750 }, { x: 1150, y: 750 }, { x: 1150, y: 1250 }, { x: 850, y: 1250 }], 0, 2700));
    const circle = Array.from({ length: 24 }, (_, i) => ({ x: 5000 + 200 * Math.cos((i / 24) * 2 * Math.PI), y: 1000 + 200 * Math.sin((i / 24) * 2 * Math.PI) }));
    const round = mk("IfcColumn", box(circle, 0, 2700));
    const beam = mk("IfcBeam", box([{ x: 1000, y: 950 }, { x: 5000, y: 950 }, { x: 5000, y: 1050 }, { x: 1000, y: 1050 }], 2400, 2700));
    const r = doc.transact("C", (tx) => convertDirectShapes(tx, doc, [rect, round, beam]));
    expect(r.skipped).toEqual([]);
    const cols = doc.byCategory("Column");
    expect(cols).toHaveLength(2);
    const rc = cols.find((c) => Math.abs((c.params as { position: { x: number } }).position.x - 1000) < 1)!;
    expect(doc.get(rc.typeId!)!.params).toMatchObject({ shape: "rect", b: 300, d: 500 });
    expect(columnExtent(doc, rc as never)).toEqual({ bottom: 0, top: 2700 });
    const cc = cols.find((c) => c !== rc)!;
    expect(doc.get(cc.typeId!)!.params).toMatchObject({ shape: "circle", d: 400 });
    const b = doc.byCategory("Beam")[0]!;
    expect(doc.get(b.typeId!)!.params).toMatchObject({ shape: "rect", b: 100, d: 300 });
    expect((b.params as { offset: number }).offset).toBeCloseTo(2700);
  });
});

describe("IFC roofs to native", () => {
  it("recovers a hip roof's footprint and slopes, and a gable roof's gables, from their meshes", async () => {
    const { createRoof, SimpleKernelImport } = { ...(await import("@open-bim/core")), SimpleKernelImport: (await import("../src/index.ts")).SimpleKernel };
    const deg = (d: number) => (d * Math.PI) / 180;
    for (const slopes of [[30, 30, 30, 30], [30, null, 30, null]] as const) {
      const doc = new Document();
      const ids = applyResidentialTemplate(doc);
      const b = [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 6000 }, { x: 0, y: 6000 }];
      const r = doc.transact("R", (tx) => createRoof(tx, ids.roofTypes.steel, ids.levels.ground, b, { slopes: slopes.map((s) => (s === null ? null : deg(s))), baseOffset: 2700 }));
      const m = new SimpleKernelImport().build(doc, r)!;
      const ds = doc.transact("I", (tx) => {
        tx.delete(r.id);
        return createDirectShape(tx, { levelId: ids.levels.ground, ifcClass: "IfcRoof", globalId: "r", positions: [...m.positions], indices: [...m.indices], color: 0x999999, properties: {} }).id;
      });
      const res = doc.transact("C", (tx) => convertDirectShapes(tx, doc, [ds]));
      expect(res.skipped).toEqual([]);
      const roof = doc.byCategory<{ boundary: { x: number; y: number }[]; slopes: (number | null)[]; baseOffset: number }>("Roof")[0]!;
      expect(roof.params.boundary).toHaveLength(4);
      expect(roof.params.baseOffset).toBeCloseTo(2700, 0);
      const got = roof.params.slopes.map((s) => (s === null ? null : Math.round((s * 180) / Math.PI)));
      // Same edges (the footprint may start at another corner): compare as sorted lists.
      expect(got.map(String).sort()).toEqual(slopes.map(String).sort());
      expect(doc.get(roof.typeId!)!.id).toBe(ids.roofTypes.steel);
    }
  });
});
