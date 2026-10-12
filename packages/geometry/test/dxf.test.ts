import { describe, expect, it } from "vitest";
import { Document, applyResidentialTemplate, createWall, floorPlanFor } from "@open-bim/core";
import { SimpleKernel, drawingDxf, parseDxf, viewDrawing } from "../src/index.ts";

describe("DXF", () => {
  it("exports a plan with layers by category and reads back the same line work", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    doc.transact("W", (tx) => createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 5000, y: 0 }, ids.levels.ground, { topLevelId: ids.levels.first }));
    const d = viewDrawing(doc, new SimpleKernel(), floorPlanFor(doc, ids.levels.ground)!);
    const dxf = drawingDxf(d, doc);
    expect(dxf).toContain("AC1009");
    expect(dxf).toMatch(/\r\nWall-Cut\r\n/);
    const back = parseDxf(dxf);
    const n = d.strokes.reduce((s, x) => s + x.segments.length, 0) + d.fills.reduce((s, f) => s + f.loops.reduce((a, l) => a + l.length * 4, 0), 0);
    expect(back.segments.length).toBe(n);
    expect(back.scale).toBe(1);
    expect(back.layers).toContain("Wall-Cut");
  });

  it("reads units, blocks, circles, arcs and text", () => {
    const g = (pairs: [number, string | number][]) => pairs.map(([c, v]) => `${c}\n${v}`).join("\n");
    const dxf = [
      g([[0, "SECTION"], [2, "HEADER"], [9, "$INSUNITS"], [70, 1], [0, "ENDSEC"]]),
      g([[0, "SECTION"], [2, "BLOCKS"], [0, "BLOCK"], [2, "TICK"], [10, 0], [20, 0], [0, "LINE"], [8, "0"], [10, 0], [20, 0], [11, 1], [21, 0], [0, "ENDBLK"], [0, "ENDSEC"]]),
      g([
        [0, "SECTION"], [2, "ENTITIES"],
        [0, "INSERT"], [8, "A"], [2, "TICK"], [10, 10], [20, 0], [50, 90],
        [0, "CIRCLE"], [8, "B"], [10, 0], [20, 0], [40, 1],
        [0, "ARC"], [8, "B"], [10, 0], [20, 0], [40, 2], [50, 0], [51, 90],
        [0, "TEXT"], [8, "T"], [10, 5], [20, 5], [40, 0.1], [1, "Kitchen"],
        [0, "ENDSEC"], [0, "EOF"],
      ]),
    ].join("\n");
    const c = parseDxf(dxf);
    expect(c.scale).toBe(25.4);
    // The inserted tick, rotated 90° at (10, 0) inches: (254, 0) → (254, 25.4) mm.
    expect(c.segments.slice(0, 4).map((v) => Math.round(v * 10) / 10)).toEqual([254, 0, 254, 25.4]);
    expect(c.segments.length / 4).toBe(1 + 32 + 8);
    expect(c.texts[0]).toMatchObject({ text: "Kitchen", x: 127, y: 127 });
    expect(c.texts[0]!.size).toBeCloseTo(2.54);
  });
});

describe("CAD import element", () => {
  it("places DXF line work in a view, drawn with its offset, only in that view", async () => {
    const { createCadImport } = await import("@open-bim/core");
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const plan = floorPlanFor(doc, ids.levels.ground)!;
    const other = floorPlanFor(doc, ids.levels.first)!;
    const content = parseDxf("0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nSite\n10\n0\n20\n0\n11\n20000\n21\n0\n0\nENDSEC\n0\nEOF\n");
    const imp = doc.transact("Import", (tx) => createCadImport(tx, doc, plan.id, content, "site.dxf"));
    doc.transact("Move", (tx) => tx.update(imp.id, { offset: { x: 100, y: 50 } }));
    const k = new SimpleKernel();
    const strokes = viewDrawing(doc, k, plan).strokes.filter((s) => s.id === imp.id);
    expect(strokes[0]!.segments).toEqual([100, 50, 20100, 50]);
    expect(viewDrawing(doc, k, other).strokes.some((s) => s.id === imp.id)).toBe(false);
    const v3d = doc.all().find((e) => (e.params as { kind?: string }).kind === "3d")!;
    expect(() => doc.transact("X", (tx) => createCadImport(tx, doc, v3d.id, content, "x"))).toThrow(/plans/);
  });
});

describe("DXF in shared coordinates", () => {
  it("writes plans in map metres", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    doc.transact("W", (tx) => createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 5000, y: 0 }, ids.levels.ground, { topLevelId: ids.levels.first }));
    const d = viewDrawing(doc, new SimpleKernel(), floorPlanFor(doc, ids.levels.ground)!);
    const loc = { epsg: 2193, eastings: 1756000, northings: 5920000, height: 0, rotation: 0 };
    const back = parseDxf(drawingDxf(d, doc, { shared: loc }));
    expect(back.scale).toBe(1000);
    const xs = back.segments.filter((_, i) => i % 2 === 0);
    // Back in mm after the $INSUNITS = metres scale: around 1 756 000 000 mm east.
    expect(Math.min(...xs)).toBeGreaterThan(1755990 * 1000);
    expect(Math.max(...xs)).toBeLessThan(1756010 * 1000);
  });
});
