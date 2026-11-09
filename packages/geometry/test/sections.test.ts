import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createCallout,
  viewCrop,
  type View,
  createGrid,
  createSection,
  createWall,
  floorPlanFor,
  type Vec2,
  type ViewParams,
} from "@open-bim/core";
import { SimpleKernel, buildViewMarker, cropLinework, sectionAnnotations, sectionLinework, sectionPoints } from "../src/index.ts";

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

  it("jogged sections cut each segment on its own plane", () => {
    const { doc, k, wall } = model();
    // A short wall at y 5000..5500 lies beyond the straight line; a jog 1200 deep at x 6000 cuts it.
    const near = wall(p(2000, 4500), p(2000, 5500));
    const far = wall(p(8000, 4500), p(8000, 5500));
    const s = doc.transact("S", (tx) => createSection(tx, doc, p(0, 4000), p(10000, 4000)));
    doc.transact("Jog", (tx) => tx.update<ViewParams>(s.id, { jogs: [{ at: 6000, depth: 1000 }] }));
    const items = [near, far].map((w) => ({ id: w.id, mesh: k.build(doc, w)! }));
    const lw = sectionLinework(items, doc.get(s.id) as typeof s);
    // Left segment (depth 0) sees the near wall beyond; right segment (depth 1000, y = 5000) cuts the far wall.
    expect(lw.find((l) => l.id === near.id)!.cutLoops).toEqual([]);
    const cut = lw.find((l) => l.id === far.id)!;
    expect(cut.cutLoops).toHaveLength(1);
    expect(loopArea(cut.cutLoops[0]!)).toBeCloseTo(110 * 2700, -1);
  });

  it("keeps the points between the cut and the far clip, inside the crop", () => {
    const { doc } = model();
    const s = doc.transact("S", (tx) => createSection(tx, doc, p(0, 4000), p(10000, 4000)));
    // Looking north (+y): in front (y 3000), beyond (y 6000), past the far clip (y 20000), off to the side (x -500).
    const pts = new Float32Array([1000, 3000, 500, 2000, 6000, 1500, 3000, 20000, 500, -500, 6000, 500]);
    const r = sectionPoints(pts, s);
    expect(r.keep).toEqual([1]);
    expect(Array.from(r.xy)).toEqual([2000, 1500]);
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
    // Filled: the head's pointer and a bar at the tail, pointing the way the view looks (+Y here).
    const loops = k.buildLines(doc, s)!.fill!.loops;
    expect(loops).toHaveLength(2);
    const bar = loops[1]!;
    expect(Math.min(...bar.map((q) => q.y))).toBeCloseTo(4000);
    expect(Math.max(...bar.map((q) => q.y))).toBeCloseTo(4600);
    expect(bar.every((q) => Math.abs(q.x - 10000) < 50)).toBe(true);
    // Marks scale with the view: at 1:50 the bar is half as long.
    const half = k.buildLines(doc, s, 50)!.fill!.loops[1]!;
    expect(Math.max(...half.map((q) => q.y))).toBeCloseTo(4300);
    expect(k.buildLines(doc, floorPlanFor(doc, ids.levels.ground)!)).toBeNull();
  });
  it("detail callouts of a section are sections on the same cut, boxed in their parent", () => {
    const { doc } = model();
    const s = doc.transact("S", (tx) => createSection(tx, doc, p(0, 4000), p(10000, 4000)));
    // Box from 2000..4000 along, 2000..3200 high.
    const c = doc.transact("C", (tx) => createCallout(tx, doc, s.id, p(4000, 3200), p(2000, 2000))) as View;
    expect(c.params.kind).toBe("section");
    expect(c.params.parentId).toBe(s.id);
    expect(c.params.line).toEqual({ start: p(2000, 4000), end: p(4000, 4000) });
    expect(viewCrop(c)).toEqual({ min: p(0, 2000), max: p(2000, 3200) });
    // The parent draws the box; plans don't show the callout.
    const a = sectionAnnotations(doc, doc.require(s.id) as View);
    const segs = Array.from(a.segments);
    let found = false;
    for (let i = 0; i < segs.length; i += 6) if (segs[i] === 2000 && segs[i + 1] === 2000 && segs[i + 3] === 4000 && segs[i + 4] === 2000) found = true;
    expect(found).toBe(true);
    expect(buildViewMarker(doc, c)).toBeNull();
  });
});
