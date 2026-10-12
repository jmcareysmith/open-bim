import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createCallout,
  createGrid,
  createSection,
  createWall,
  floorPlanFor,
  type Vec2,
  type ViewParams,
} from "@open-bim/core";
import { SimpleKernel, cropLinework, sectionAnnotations, sectionLinework } from "../src/index.ts";

const p = (x: number, y: number): Vec2 => ({ x, y });
const loopArea = (l: Vec2[]) => Math.abs(l.reduce((s, q, i) => s + q.x * l[(i + 1) % l.length]!.y - l[(i + 1) % l.length]!.x * q.y, 0) / 2);

function model() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const k = new SimpleKernel();
  const wall = (a: Vec2, b: Vec2) =>
    doc.transact("W", (tx) => createWall(tx, ids.wallTypes.interior, a, b, ids.levels.ground, { height: 2700 }));
  return { doc, ids, k, wall };
}

describe("section linework", () => {
  it("cuts walls crossing the line, projects walls beyond, ignores walls in front", () => {
    const { doc, k, wall } = model();
    const crossing = wall(p(5000, 0), p(5000, 8000));
    const beyond = wall(p(1000, 6000), p(4000, 6000));
    const front = wall(p(1000, 2000), p(4000, 2000));
    // Looking north along y = 4000.
    const s = doc.transact("S", (tx) => createSection(tx, doc, p(0, 4000), p(10000, 4000)));
    const items = [crossing, beyond, front].map((w) => ({ id: w.id, mesh: k.build(doc, w)! }));
    const lw = sectionLinework(items, s);

    const cut = lw.find((l) => l.id === crossing.id)!;
    expect(cut.cutLoops).toHaveLength(1);
    expect(loopArea(cut.cutLoops[0]!)).toBeCloseTo(110 * 2700, -1);
    const xs = cut.cutLoops[0]!.map((q) => q.x);
    expect(Math.min(...xs)).toBeCloseTo(4945);

    const far = lw.find((l) => l.id === beyond.id)!;
    expect(far.cutLoops).toEqual([]);
    let len = 0;
    for (let i = 0; i < far.projection.length; i += 4) len += Math.hypot(far.projection[i + 2]! - far.projection[i]!, far.projection[i + 3]! - far.projection[i + 1]!);
    expect(len).toBeCloseTo(2 * (3000 + 2700), 0); // its face outline

    expect(lw.find((l) => l.id === front.id)).toBeUndefined();
  });

  it("crops linework to a rectangle", () => {
    const lw = cropLinework(
      { id: "x", cutLoops: [[p(-100, 0), p(100, 0), p(100, 100), p(-100, 100)]], projection: [-500, 50, 500, 50] },
      { min: p(0, 0), max: p(1000, 1000) },
    );
    expect(loopArea(lw.cutLoops[0]!)).toBeCloseTo(100 * 100);
    expect(lw.projection).toEqual([0, 50, 500, 50]);
  });
});

describe("section annotations", () => {
  it("draws every level in the crop and the grids the section crosses", () => {
    const { doc } = model();
    doc.transact("G", (tx) => {
      createGrid(tx, doc, p(2000, -1000), p(2000, 9000), "1");
      createGrid(tx, doc, p(-1000, 1000), p(11000, 1000), "A"); // parallel: not shown
    });
    const s = doc.transact("S", (tx) => createSection(tx, doc, p(0, 4000), p(10000, 4000)));
    const a = sectionAnnotations(doc, s);
    expect(a.labels.map((l) => l.text)).toEqual(["Ground Floor  0", "First Floor  2700", "Roof  5400", "1"]);
    // Grid line is vertical at x = 2000 from crop bottom to top.
    const segs = Array.from(a.segments);
    const vertical = [];
    for (let i = 0; i < segs.length; i += 6) if (segs[i] === 2000 && segs[i + 3] === 2000) vertical.push(segs.slice(i, i + 6));
    expect(vertical[0]).toEqual([2000, -1000, 0, 2000, 8400, 0]);
  });
});

describe("view markers in plan", () => {
  it("sections, elevations and callouts draw plan-only symbols; plans and 3D views don't", () => {
    const { doc, ids, k } = model();
    const s = doc.transact("S", (tx) => createSection(tx, doc, p(0, 4000), p(10000, 4000)));
    const c = doc.transact("C", (tx) => createCallout(tx, doc, floorPlanFor(doc, ids.levels.ground)!.id, p(0, 0), p(2000, 2000)));
    expect(k.buildLines(doc, s)!.planOnly).toBe(true);
    expect(k.buildLines(doc, s)!.labels[0]!.text).toBe("1"); // bubbles show the view number;
    // Callout boxes and section lines are dashed by default (real dashes), solid when set so.
    const segs = (id: string) => k.buildLines(doc, doc.require(id))!.segments.length / 6;
    const dashed = segs(c.id);
    doc.transact("Solid", (tx) => tx.update<ViewParams>(c.id, { markerLine: "solid" }));
    expect(segs(c.id)).toBeLessThan(dashed);
    // Section ends carry solid bars.
    expect(k.buildLines(doc, s)!.fill?.loops.length).toBeGreaterThanOrEqual(3);
    expect(k.buildLines(doc, floorPlanFor(doc, ids.levels.ground)!)).toBeNull();
  });
});
