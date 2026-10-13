import { describe, expect, it } from "vitest";
import {
  Document,
  annotationView,
  applyResidentialTemplate,
  createDetailLine,
  createDimension,
  createFilledRegion,
  createGrid,
  createSection,
  createTextNote,
  createWall,
  dimensionLayout,
  floorPlanFor,
  modelTextSize,
  polygonArea,
  views,
  type Dimension,
  type Vec2,
  type ViewParams,
  type WallParams,
} from "../src/index.ts";

const p = (x: number, y: number): Vec2 => ({ x, y });

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const plan = floorPlanFor(doc, ids.levels.ground)!;
  const wall = (a: Vec2, b: Vec2) =>
    doc.transact("W", (tx) => createWall(tx, ids.wallTypes.interior, a, b, ids.levels.ground, { height: 2400 }));
  return { doc, ids, plan, wall };
}

describe("detail elements", () => {
  it("belong to a view and go with it", () => {
    const { doc, plan } = setup();
    const line = doc.transact("L", (tx) => createDetailLine(tx, doc, plan.id, p(0, 0), p(1000, 0)));
    const region = doc.transact("R", (tx) =>
      createFilledRegion(tx, doc, plan.id, [p(0, 0), p(0, 500), p(500, 500), p(500, 0)]),
    );
    const text = doc.transact("T", (tx) => createTextNote(tx, doc, plan.id, p(200, 200), "LOUNGE"));
    expect(annotationView(line)).toBe(plan.id);
    expect(polygonArea(region.params.boundary)).toBeGreaterThan(0); // normalised to counter-clockwise
    doc.transact("Delete view", (tx) => tx.delete(plan.id));
    for (const el of [line, region, text]) expect(doc.has(el.id)).toBe(false);
  });

  it("are rejected in 3D views and when degenerate", () => {
    const { doc, plan } = setup();
    const v3d = views(doc).find((v) => v.params.kind === "3d")!;
    expect(() => doc.transact("L", (tx) => createDetailLine(tx, doc, v3d.id, p(0, 0), p(1, 0)))).toThrow(/3D/);
    expect(() => doc.transact("L", (tx) => createDetailLine(tx, doc, plan.id, p(0, 0), p(0, 0)))).toThrow(/non-zero/);
    expect(() => doc.transact("T", (tx) => createTextNote(tx, doc, plan.id, p(0, 0), "  "))).toThrow(/empty/);
  });

  it("text is sized on paper and scaled by the view", () => {
    const { doc, plan } = setup();
    expect(modelTextSize(doc, plan.id, 2.5)).toBe(250);
    doc.transact("Scale", (tx) => tx.update<ViewParams>(plan.id, { scale: 50 }));
    expect(modelTextSize(doc, plan.id, 2.5)).toBe(125);
  });
});

describe("dimensions", () => {
  it("measure between wall faces and grids, and follow them when they move", () => {
    const { doc, plan, wall } = setup();
    const a = wall(p(0, 0), p(0, 5000)); // runs north: its left face is at x = -55
    const b = wall(p(3600, 0), p(3600, 5000));
    const g = doc.transact("G", (tx) => createGrid(tx, doc, p(6000, -1000), p(6000, 6000), "3"));
    const dim = doc.transact("D", (tx) =>
      createDimension(
        tx,
        doc,
        plan.id,
        [
          { kind: "wallFace", id: a.id, side: "right", pick: p(55, 2000) },
          { kind: "wallFace", id: b.id, side: "left", pick: p(3545, 2000) },
          { kind: "datum", id: g.id, pick: p(6000, 2000) },
        ],
        p(0, 2500),
      ),
    );
    expect(dimensionLayout(doc, dim).values.map(Math.round)).toEqual([3490, 2455]);

    doc.transact("Move", (tx) => tx.update<WallParams>(b.id, { start: p(4000, 0), end: p(4000, 5000) }));
    const moved = dimensionLayout(doc, doc.require(dim.id) as Dimension);
    expect(moved.values.map(Math.round)).toEqual([3890, 2055]);
    expect(moved.ticks.every((t) => Math.abs(t.y - 2500) < 1e-9)).toBe(true); // dimension line stays put
  });

  it("is deleted with a referenced element", () => {
    const { doc, plan, wall } = setup();
    const a = wall(p(0, 0), p(0, 5000));
    const b = wall(p(3000, 0), p(3000, 5000));
    const dim = doc.transact("D", (tx) =>
      createDimension(tx, doc, plan.id, [
        { kind: "wallFace", id: a.id, side: "centre", pick: p(0, 1000) },
        { kind: "wallFace", id: b.id, side: "centre", pick: p(3000, 1000) },
      ], p(0, 1500)),
    );
    expect(dimensionLayout(doc, dim).values).toEqual([3000]);
    doc.transact("Delete", (tx) => tx.delete(b.id));
    expect(doc.has(dim.id)).toBe(false);
  });

  it("rejects non-parallel references and single references", () => {
    const { doc, plan, wall } = setup();
    const a = wall(p(0, 0), p(0, 5000));
    const c = wall(p(0, 6000), p(4000, 6000));
    const ref = (id: string, pick: Vec2) => ({ kind: "wallFace" as const, id, side: "centre" as const, pick });
    expect(() => doc.transact("D", (tx) => createDimension(tx, doc, plan.id, [ref(a.id, p(0, 1))], p(0, 0)))).toThrow(/two/);
    expect(() =>
      doc.transact("D", (tx) => createDimension(tx, doc, plan.id, [ref(a.id, p(0, 1)), ref(c.id, p(1, 6000))], p(0, 0))),
    ).toThrow(/parallel/);
  });

  it("dimension levels in a section", () => {
    const { doc, ids } = setup();
    const s = doc.transact("S", (tx) => createSection(tx, doc, p(0, 0), p(5000, 0)));
    const dim = doc.transact("D", (tx) =>
      createDimension(tx, doc, s.id, [
        { kind: "level", id: ids.levels.ground, pick: p(1000, 0) },
        { kind: "level", id: ids.levels.first, pick: p(1000, 2700) },
      ], p(1000, 0)),
    );
    expect(dimensionLayout(doc, dim).values).toEqual([2700]);
  });
});

describe("dimensions in sections and elevations", () => {
  it("wall faces and grids where the section crosses them, and levels, stay live", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    // A wall running north at x = 3000 (interior type, 110 thick), a grid at x = 0, a section along y = 1000.
    const w = doc.transact("W", (tx) => createWall(tx, ids.wallTypes.interior, p(3000, 0), p(3000, 5000), ids.levels.ground, { height: 2400 }));
    const g = doc.transact("G", (tx) => createGrid(tx, doc, p(0, -1000), p(0, 6000), "A"));
    const s = doc.transact("S", (tx) => createSection(tx, doc, p(-1000, 1000), p(6000, 1000)));
    const dim = doc.transact("D", (tx) =>
      createDimension(tx, doc, s.id, [{ kind: "datum", id: g.id, pick: p(1000, 500) }, { kind: "wallFace", id: w.id, side: "centre", pick: p(4000, 500) }], p(2000, -500)),
    );
    expect(dimensionLayout(doc, dim).values[0]).toBeCloseTo(3000);
    expect(dim.params.dir.x).toBeCloseTo(1);
    expect(dim.params.dir.y).toBeCloseTo(0);
    doc.transact("Move", (tx) => tx.update<WallParams>(w.id, { start: p(3500, 0), end: p(3500, 5000) }));
    expect(dimensionLayout(doc, doc.require(dim.id) as Dimension).values[0]).toBeCloseTo(3500);
    // Levels measure up the drawing.
    const lv = doc.transact("L", (tx) =>
      createDimension(tx, doc, s.id, [{ kind: "level", id: ids.levels.ground, pick: p(0, 0) }, { kind: "level", id: ids.levels.first, pick: p(0, 2700) }], p(-500, 0)),
    );
    expect(lv.params.dir.x).toBeCloseTo(0);
    expect(lv.params.dir.y).toBeCloseTo(1);
    expect(dimensionLayout(doc, lv).values[0]).toBeCloseTo(2700);
    // A wall running along the section doesn't cross it.
    const along = doc.transact("W2", (tx) => createWall(tx, ids.wallTypes.interior, p(0, 3000), p(5000, 3000), ids.levels.ground, { height: 2400 }));
    expect(() => doc.transact("Bad", (tx) => createDimension(tx, doc, s.id, [{ kind: "datum", id: g.id, pick: p(0, 0) }, { kind: "wallFace", id: along.id, side: "centre", pick: p(1, 1) }], p(0, 0)))).toThrow(/doesn't cross/);
  });
});
