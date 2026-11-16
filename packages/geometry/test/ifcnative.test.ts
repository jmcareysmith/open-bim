import { describe, expect, it } from "vitest";
import { Document, applyResidentialTemplate, createDirectShape, wallThickness, type FloorParams, type Vec2, type Wall, type WallParams } from "@open-bim/core";
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

describe("IFC names, marks and colours", () => {
  it("keeps the imported name and Mark, and gives new types a material of the shape's colour", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const ds = doc.transact("I", (tx) =>
      createDirectShape(
        tx,
        { levelId: ids.levels.ground, ifcClass: "IfcWall", globalId: "w", ...box(rect(0, 0, 4000, 333), 0, 2700), color: 0x8a3324, properties: { "Identity Data.Mark": "W-07" } },
        "Basic Wall:Brick 333",
      ).id,
    );
    const { created } = doc.transact("C", (tx) => convertDirectShapes(tx, doc, [ds]));
    const w = doc.require(created[0]!);
    expect(w.name).toBe("Basic Wall:Brick 333");
    expect((w.params as { mark?: string }).mark).toBe("W-07");
    const t = doc.require<{ layers: { materialId?: string }[] }>(w.typeId!);
    expect(t.name).toBe("Imported Wall 333");
    const m = doc.require<{ color: number }>(t.params.layers[0]!.materialId!);
    expect(m.params.color).toBe(0x8a3324);
  });
});

describe("roof slabs", () => {
  it("a sloped IfcSlab (a roof part) becomes a mono-pitch roof, not a floor", async () => {
    const { createRoof } = await import("@open-bim/core");
    const { SimpleKernel } = await import("../src/index.ts");
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    // A lean-to: only the first edge slopes (25°), the rest are gables/verges.
    const r = doc.transact("R", (tx) => createRoof(tx, ids.roofTypes.steel, ids.levels.ground, rect(0, 0, 6000, 4000), { slopes: [(25 * Math.PI) / 180, null, null, null], baseOffset: 2400 }));
    const m = new SimpleKernel().build(doc, r)!;
    const ds = doc.transact("I", (tx) => {
      tx.delete(r.id);
      return createDirectShape(tx, { levelId: ids.levels.ground, ifcClass: "IfcSlab", globalId: "s", positions: [...m.positions], indices: [...m.indices], color: 0x666666, properties: {} }).id;
    });
    const floors = doc.byCategory("Floor").length;
    doc.transact("C", (tx) => convertDirectShapes(tx, doc, [ds]));
    expect(doc.byCategory("Floor")).toHaveLength(floors);
    const roofs = doc.byCategory<{ slopes: (number | null)[] }>("Roof");
    expect(roofs).toHaveLength(1);
    expect(roofs[0]!.params.slopes.filter((s) => s !== null).map((s) => Math.round((s! * 180) / Math.PI))).toEqual([25]);
  });
});

describe("curved walls from IFC", () => {
  it("recovers an arc wall's ends, bow and thickness from its mesh", async () => {
    const { createWall, setWallCurve, wallThickness } = await import("@open-bim/core");
    const { SimpleKernel } = await import("../src/index.ts");
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const w0 = doc.transact("W", (tx) => createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 8000, y: 0 }, ids.levels.ground, { height: 2700 }));
    doc.transact("C", (tx) => setWallCurve(tx, doc, w0.id, 1500));
    const t = wallThickness(doc, doc.require(w0.id) as never);
    const m = new SimpleKernel().build(doc, doc.require(w0.id))!;
    const ds = doc.transact("I", (tx) => {
      tx.delete(w0.id);
      return createDirectShape(tx, { levelId: ids.levels.ground, ifcClass: "IfcWall", globalId: "a", positions: [...m.positions], indices: [...m.indices], color: 0x999999, properties: {} }).id;
    });
    const r = doc.transact("C", (tx) => convertDirectShapes(tx, doc, [ds]));
    expect(r.skipped).toEqual([]);
    const w = doc.byCategory<{ start: { x: number; y: number }; end: { x: number; y: number }; curve?: number }>("Wall").at(-1)!;
    const ends = [w.params.start, w.params.end].sort((a, b) => a.x - b.x);
    expect(ends[0]!.x).toBeCloseTo(0, 0);
    expect(ends[0]!.y).toBeCloseTo(0, 0);
    expect(ends[1]!.x).toBeCloseTo(8000, 0);
    expect(Math.abs(w.params.curve!)).toBeCloseTo(1500, 0);
    // Bows the same way (towards +y).
    const midY = (w.params.start.y + w.params.end.y) / 2 + Math.sign(w.params.end.x - w.params.start.x) * w.params.curve!;
    expect(midY).toBeCloseTo(1500, 0);
    expect(wallThickness(doc, w as never)).toBeCloseTo(t, 0);
  });
});

describe("stairs from IFC", () => {
  it("recovers a straight stair's run, risers, going and width from its mesh", async () => {
    const { createStair, ensureStairType, stairLayout } = await import("@open-bim/core");
    const { SimpleKernel } = await import("../src/index.ts");
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const st = doc.transact("S", (tx) => createStair(tx, doc, ensureStairType(tx, doc), ids.levels.ground, ids.levels.first, [{ start: { x: 1000, y: 500 }, end: { x: 5000, y: 500 } }]));
    const before = stairLayout(doc, doc.require(st.id) as never);
    const m = new SimpleKernel().build(doc, doc.require(st.id))!;
    const ds = doc.transact("I", (tx) => {
      tx.delete(st.id);
      return createDirectShape(tx, { levelId: ids.levels.ground, ifcClass: "IfcStair", globalId: "s", positions: [...m.positions], indices: [...m.indices], color: 0x999999, properties: {} }).id;
    });
    const r = doc.transact("C", (tx) => convertDirectShapes(tx, doc, [ds]));
    expect(r.skipped).toEqual([]);
    const s2 = doc.byCategory("Stair")[0]!;
    const after = stairLayout(doc, s2 as never);
    expect(after.risers).toBe(before.risers);
    expect(after.going).toBeCloseTo(before.going, 0);
    expect(after.height).toBeCloseTo(before.height, 0);
    const run = (s2.params as { runs: { start: { x: number; y: number } }[] }).runs[0]!;
    expect(run.start.x).toBeCloseTo(1000, -1);
    expect(run.start.y).toBeCloseTo(500, -1);
    expect((doc.get(s2.typeId!)!.params as { width: number }).width).toBeCloseTo(900, -1);
  });
});

describe("railings from IFC", () => {
  it("recovers a level railing's path and height from its top rail", async () => {
    const { createRailing, ensureRailingType } = await import("@open-bim/core");
    const { SimpleKernel } = await import("../src/index.ts");
    for (const path of [
      [{ x: 0, y: 0 }, { x: 4000, y: 0 }],
      [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }],
    ]) {
      const doc = new Document();
      const ids = applyResidentialTemplate(doc);
      const r0 = doc.transact("R", (tx) => createRailing(tx, doc, ensureRailingType(tx, doc), ids.levels.ground, path));
      const m = new SimpleKernel().build(doc, doc.require(r0.id))!;
      const ds = doc.transact("I", (tx) => {
        tx.delete(r0.id);
        return createDirectShape(tx, { levelId: ids.levels.ground, ifcClass: "IfcRailing", globalId: "r", positions: [...m.positions], indices: [...m.indices], color: 0x999999, properties: {} }).id;
      });
      const res = doc.transact("C", (tx) => convertDirectShapes(tx, doc, [ds]));
      expect(res.skipped).toEqual([]);
      const r = doc.byCategory<{ path: { x: number; y: number }[] }>("Railing")[0]!;
      const got = r.params.path.map((q) => [Math.round(q.x), Math.round(q.y)]);
      const want = path.map((q) => [q.x, q.y]);
      expect([got, [...got].reverse()].map((g) => JSON.stringify(g))).toContain(JSON.stringify(want));
      expect((doc.get(r.typeId!)!.params as { height: number }).height).toBe(1000);
    }
  });
});

describe("stairs with landings from IFC", () => {
  it("recovers an L stair's two runs round a landing", async () => {
    const { createStair, ensureStairType, stairLayout } = await import("@open-bim/core");
    const { SimpleKernel } = await import("../src/index.ts");
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const st = doc.transact("S", (tx) =>
      createStair(tx, doc, ensureStairType(tx, doc), ids.levels.ground, ids.levels.first, [
        { start: { x: 0, y: 0 }, end: { x: 1680, y: 0 } },
        { start: { x: 2130, y: 450 }, end: { x: 2130, y: 2000 } },
      ]),
    );
    const before = stairLayout(doc, doc.require(st.id) as never);
    const m = new SimpleKernel().build(doc, doc.require(st.id))!;
    const ds = doc.transact("I", (tx) => {
      tx.delete(st.id);
      return createDirectShape(tx, { levelId: ids.levels.ground, ifcClass: "IfcStair", globalId: "s", positions: [...m.positions], indices: [...m.indices], color: 0x999999, properties: {} }).id;
    });
    const r = doc.transact("C", (tx) => convertDirectShapes(tx, doc, [ds]));
    expect(r.skipped).toEqual([]);
    const after = stairLayout(doc, doc.byCategory("Stair")[0] as never);
    expect(after.risers).toBe(before.risers);
    expect(after.runs.map((x) => x.treads)).toEqual(before.runs.map((x) => x.treads));
    expect(after.landings).toHaveLength(before.landings.length);
    for (let i = 0; i < 2; i++) {
      expect(after.runs[i]!.start.x).toBeCloseTo(before.runs[i]!.start.x, -1);
      expect(after.runs[i]!.start.y).toBeCloseTo(before.runs[i]!.start.y, -1);
    }
  });
});

describe("curtain walls from IFC panels", () => {
  it("panels in one plane become a curtain wall with grid lines where they meet; mullions go with them", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const lvl = ids.levels.ground;
    const mk = (ifcClass: string, mesh: { positions: number[]; indices: number[] }) =>
      doc.transact("I", (tx) => createDirectShape(tx, { levelId: lvl, ifcClass, globalId: ifcClass, ...mesh, color: 0x88aacc, properties: {} }).id);
    const panels: string[] = [];
    for (const [u0, u1] of [[0, 1175], [1225, 2375], [2425, 3600]] as const) {
      for (const [z0, z1] of [[0, 1475], [1525, 3000]] as const) panels.push(mk("IfcPlate", box(rect(u0, -12, u1, 12), z0, z1)));
    }
    const mullion = mk("IfcMember", box(rect(1175, -50, 1225, 50), 0, 3000));
    const r = doc.transact("C", (tx) => convertDirectShapes(tx, doc, panels));
    expect(r.created).toHaveLength(1);
    const w = doc.require<{ start: Vec2; end: Vec2; height: number; curtainEdits?: { uLines?: number[]; zLines?: number[] } }>(r.created[0]!);
    expect(Math.abs(w.params.end.x - w.params.start.x)).toBeCloseTo(3600, 0);
    expect(w.params.height).toBeCloseTo(3000, 0);
    const u = w.params.curtainEdits!.uLines!;
    const lines = w.params.start.x < w.params.end.x ? u : u.map((x) => 3600 - x).sort((a, b) => a - b);
    expect(lines).toEqual([1200, 2400]);
    expect(w.params.curtainEdits!.zLines).toEqual([1500]);
    expect(doc.get(mullion)).toBeUndefined();
    expect(doc.byCategory("DirectShape")).toHaveLength(0);
  });
});

describe("furniture and equipment from IFC", () => {
  it("makes one family per distinct shape (turned copies share it) and places instances where the shapes were", async () => {
    const { SimpleKernel, boundingBox } = await import("../src/index.ts");
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const lvl = ids.levels.ground;
    const turn = (m: { positions: number[]; indices: number[] }, a: number, dx: number, dy: number) => {
      const p = [...m.positions];
      for (let i = 0; i < p.length; i += 3) {
        const [x, y] = [p[i]!, p[i + 1]!];
        p[i] = x * Math.cos(a) - y * Math.sin(a) + dx;
        p[i + 1] = x * Math.sin(a) + y * Math.cos(a) + dy;
      }
      return { positions: p, indices: m.indices };
    };
    // A "chair": seat box plus a back, so it isn't symmetric.
    const seat = box(rect(-250, -250, 250, 250), 0, 450);
    const back = box(rect(-250, 200, 250, 250), 450, 900);
    const chair = { positions: [...seat.positions, ...back.positions], indices: [...seat.indices, ...back.indices.map((i) => i + seat.positions.length / 3)] };
    const mk = (ifcClass: string, name: string, mesh: { positions: number[]; indices: number[] }) =>
      doc.transact("I", (tx) => createDirectShape(tx, { levelId: lvl, ifcClass, globalId: name, ...mesh, color: 0x996633, properties: {} }, name).id);
    const a = mk("IfcFurniture", "Chair-Desk:Chair-Desk:1001", turn(chair, 0, 1000, 1000));
    const b = mk("IfcFurniture", "Chair-Desk:Chair-Desk:1002", turn(chair, Math.PI / 2, 3000, 1000));
    const t = mk("IfcFurniture", "Table-Round:900:1003", box(rect(4500, 500, 5400, 1400), 0, 750));
    const want = [a, b, t].map((id) => boundingBox(new SimpleKernel().build(doc, doc.require(id))!));
    const r = doc.transact("C", (tx) => convertDirectShapes(tx, doc, [a, b, t]));
    expect(r.created).toHaveLength(3);
    expect(doc.byCategory("FamilyDef").filter((d) => (d.params as { category: string }).category === "Furniture").map((d) => d.name).sort()).toEqual(["Chair-Desk:Chair-Desk", "Table-Round:900"]);
    r.created.forEach((id, i) => {
      const bb = boundingBox(new SimpleKernel().build(doc, doc.require(id))!);
      const w = want[[a, b, t].indexOf([a, b, t][i]!)]!;
      for (let k = 0; k < 3; k++) {
        expect(bb.min[k]).toBeCloseTo(w.min[k]!, 0);
        expect(bb.max[k]).toBeCloseTo(w.max[k]!, 0);
      }
    });
  });
});

describe("stair railings from IFC", () => {
  it("sloped railings over a converted stair become its left and right railings", async () => {
    const { createStair, ensureStairType, createStairRailings, ensureRailingType } = await import("@open-bim/core");
    const { SimpleKernel } = await import("../src/index.ts");
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const st = doc.transact("S", (tx) => createStair(tx, doc, ensureStairType(tx, doc), ids.levels.ground, ids.levels.first, [{ start: { x: 1000, y: 500 }, end: { x: 5000, y: 500 } }]));
    const rails = doc.transact("R", (tx) => createStairRailings(tx, doc, ensureRailingType(tx, doc), doc.require(st.id) as never));
    const k = new SimpleKernel();
    const shapes = doc.transact("I", (tx) => {
      const out = [st, ...rails].map((e) => {
        const m = k.build(doc, doc.require(e.id))!;
        const cls = e.category === "Stair" ? "IfcStair" : "IfcRailing";
        return { cls, m };
      });
      for (const r of rails) tx.delete(r.id);
      tx.delete(st.id);
      return out.map(({ cls, m }) => createDirectShape(tx, { levelId: ids.levels.ground, ifcClass: cls, globalId: cls, positions: [...m.positions], indices: [...m.indices], color: 0x999999, properties: {} }).id);
    });
    // Railings listed first: they still find the stair converted after them.
    const r = doc.transact("C", (tx) => convertDirectShapes(tx, doc, [shapes[1]!, shapes[2]!, shapes[0]!]));
    expect(r.skipped).toEqual([]);
    const stair = doc.byCategory("Stair")[0]!;
    const hosted = doc.byCategory<{ hostId: string | null; side: string }>("Railing").filter((x) => x.params.hostId === stair.id);
    expect(hosted.map((x) => x.params.side).sort()).toEqual(["left", "right"]);
  });
});

describe("winder stairs from IFC", () => {
  it("recovers an L stair with winders at the turn", async () => {
    const { createStair, ensureStairType, stairLayout } = await import("@open-bim/core");
    const { SimpleKernel } = await import("../src/index.ts");
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const st = doc.transact("S", (tx) => {
      const s = createStair(tx, doc, ensureStairType(tx, doc), ids.levels.ground, ids.levels.first, [
        { start: { x: 0, y: 0 }, end: { x: 1680, y: 0 } },
        { start: { x: 2130, y: 450 }, end: { x: 2130, y: 2000 } },
      ]);
      tx.update(s.id, { winders: 3 });
      return s;
    });
    const before = stairLayout(doc, doc.require(st.id) as never);
    expect(before.winders.length).toBe(3);
    const m = new SimpleKernel().build(doc, doc.require(st.id))!;
    const ds = doc.transact("I", (tx) => {
      tx.delete(st.id);
      return createDirectShape(tx, { levelId: ids.levels.ground, ifcClass: "IfcStair", globalId: "s", positions: [...m.positions], indices: [...m.indices], color: 0x999999, properties: {} }).id;
    });
    const r = doc.transact("C", (tx) => convertDirectShapes(tx, doc, [ds]));
    expect(r.skipped).toEqual([]);
    const s2 = doc.byCategory("Stair")[0]!;
    expect((s2.params as { winders?: number }).winders).toBe(3);
    const after = stairLayout(doc, s2 as never);
    expect(after.risers).toBe(before.risers);
    expect(after.runs.map((x) => x.treads)).toEqual(before.runs.map((x) => x.treads));
  });
});

describe("gable walls from IFC", () => {
  it("a wall whose top isn't level gets its elevation outline as its profile", async () => {
    const { createWall, setWallProfile, gableProfile } = await import("@open-bim/core");
    const { SimpleKernel, boundingBox, meshVolume } = await import("../src/index.ts");
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const w0 = doc.transact("W", (tx) => createWall(tx, ids.wallTypes.interior, { x: 0, y: 0 }, { x: 6000, y: 0 }, ids.levels.ground, { height: 2400 }));
    doc.transact("P", (tx) => setWallProfile(tx, doc, w0.id, gableProfile(6000, 2400, 4000)));
    const m = new SimpleKernel().build(doc, doc.require(w0.id))!;
    const vol = meshVolume(m);
    const ds = doc.transact("I", (tx) => {
      tx.delete(w0.id);
      return createDirectShape(tx, { levelId: ids.levels.ground, ifcClass: "IfcWall", globalId: "g", positions: [...m.positions], indices: [...m.indices], color: 0x999999, properties: {} }).id;
    });
    const r = doc.transact("C", (tx) => convertDirectShapes(tx, doc, [ds]));
    const w = doc.require(r.created[0]!);
    expect((w.params as { profile?: unknown[] }).profile?.length).toBe(5);
    const m2 = new SimpleKernel().build(doc, w)!;
    expect(meshVolume(m2)).toBeCloseTo(vol, -4);
    expect(boundingBox(m2).max[2]).toBeCloseTo(4000, 0);
  });
});

describe("imported walls join", () => {
  it("corner and tee walls snap their ends onto each other's centrelines", async () => {
    const { createWall, wallJoins } = await import("@open-bim/core");
    const { SimpleKernel } = await import("../src/index.ts");
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const [a0, b0, c0] = doc.transact("W", (tx) => [
      createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 6000, y: 0 }, ids.levels.ground, { height: 2700 }),
      createWall(tx, ids.wallTypes.exterior, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, ids.levels.ground, { height: 2700 }),
      createWall(tx, ids.wallTypes.interior, { x: 3000, y: 0 }, { x: 3000, y: 4000 }, ids.levels.ground, { height: 2700 }),
    ]);
    const k = new SimpleKernel();
    const meshes = [a0!, b0!, c0!].map((w) => k.build(doc, doc.require(w.id))!);
    const shapes = doc.transact("I", (tx) => {
      for (const w of [a0!, b0!, c0!]) tx.delete(w.id);
      return meshes.map((m, i) => createDirectShape(tx, { levelId: ids.levels.ground, ifcClass: "IfcWall", globalId: `w${i}`, positions: [...m.positions], indices: [...m.indices], color: 0x999999, properties: {} }).id);
    });
    const r = doc.transact("C", (tx) => convertDirectShapes(tx, doc, shapes));
    const [a, b, c] = r.created.map((id) => doc.require<WallParams>(id) as Wall);
    const has = (w: Wall, x: number, y: number) => [w.params.start, w.params.end].some((q) => Math.hypot(q.x - x, q.y - y) < 1);
    expect(has(a!, 6000, 0) && has(b!, 6000, 0)).toBe(true);
    expect(has(c!, 3000, 0)).toBe(true);
    const j = wallJoins(doc, a!);
    expect(Object.values(j).some((x) => x?.kind === "corner")).toBe(true);
    expect(Object.values(wallJoins(doc, c!)).some((x) => x?.kind === "tee")).toBe(true);
  });
});

describe("exterior and interior walls from IFC", () => {
  it("walls of one thickness get exterior/interior types from IsExternal", async () => {
    const { wallFunction } = await import("@open-bim/core");
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const mk = (y: number, ext: string) =>
      doc.transact("I", (tx) => createDirectShape(tx, { levelId: ids.levels.ground, ifcClass: "IfcWall", globalId: `w${y}`, ...box(rect(0, y, 4000, y + 177), 0, 2700), color: 0x999999, properties: { "Pset_WallCommon.IsExternal": ext } }).id);
    const a = mk(0, "T");
    const b = mk(3000, "F");
    const r = doc.transact("C", (tx) => convertDirectShapes(tx, doc, [a, b]));
    const types = r.created.map((id) => doc.require(doc.require(id).typeId!));
    expect(types[0]!.id).not.toBe(types[1]!.id);
    expect(types.map((t) => wallFunction(t))).toEqual(["exterior", "interior"]);
  });
});
