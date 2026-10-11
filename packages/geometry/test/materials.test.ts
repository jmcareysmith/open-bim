import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createFloor,
  createSection,
  createWall,
  materialByName,
  viewFrame,
  type Vec2,
} from "@open-bim/core";
import { SimpleKernel, extrudePolygon, hatch, layerRegions, patternFamilies, planFrame, planLinework } from "../src/index.ts";

const p = (x: number, y: number): Vec2 => ({ x, y });
const area = (l: Vec2[]) => Math.abs(l.reduce((s, q, i) => s + q.x * l[(i + 1) % l.length]!.y - l[(i + 1) % l.length]!.x * q.y, 0) / 2);
const totalLength = (seg: number[]) => {
  let s = 0;
  for (let i = 0; i < seg.length; i += 4) s += Math.hypot(seg[i + 2]! - seg[i]!, seg[i + 3]! - seg[i + 1]!);
  return s;
};

function model() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  return { doc, ids, k: new SimpleKernel() };
}

describe("patterns", () => {
  it("hatches a square with evenly spaced lines, holes excluded", () => {
    const sq = [p(0, 0), p(1000, 0), p(1000, 1000), p(0, 1000)];
    const lines = hatch([sq], [{ angle: 0, spacing: 100 }]);
    expect(lines.length / 4).toBe(9); // y = 100..900; lines along the boundary itself are skipped
    expect(totalLength(lines)).toBeCloseTo(9000);
    const hole = [p(250, 250), p(750, 250), p(750, 750), p(250, 750)];
    expect(totalLength(hatch([sq, hole], [{ angle: 0, spacing: 100 }]))).toBeCloseTo(9000 - 5 * 500);
  });

  it("anchors dashes to the origin so neighbouring regions line up", () => {
    const a = hatch([[p(0, 0), p(100, 0), p(100, 10), p(0, 10)]], [{ angle: 0, spacing: 20, offset: 5, dash: [10, 10] }]);
    expect(a).toEqual([0, 5, 10, 5, 20, 5, 30, 5, 40, 5, 50, 5, 60, 5, 70, 5, 80, 5, 90, 5]);
  });

  it("scales drafting patterns with the view but not model patterns", () => {
    expect(patternFamilies("diagonal", 100)![0]!.spacing).toBe(150);
    expect(patternFamilies("diagonal", 50)![0]!.spacing).toBe(75);
    expect(patternFamilies("weatherboard", 50)![0]!.spacing).toBe(150);
    expect(patternFamilies("solid", 100)).toBeNull();
  });
});

describe("layer regions", () => {
  it("split a cut exterior wall into its five layers in plan, exterior on the left", () => {
    const { doc, ids, k } = model();
    const w = doc.transact("W", (tx) => createWall(tx, ids.wallTypes.exterior, p(0, 0), p(4000, 0), ids.levels.ground, { height: 2400 }));
    const [lw] = planLinework([{ id: w.id, mesh: k.build(doc, w)! }], { bottom: 0, cut: 1200 });
    const regions = layerRegions(doc, w, lw!.cutLoops, planFrame(1200));
    expect(regions.map((r) => Math.round(area(r.loop) / 4000))).toEqual([18, 20, 1, 90, 10]);
    expect(regions[0]!.materialId).toBe(materialByName(doc, "Weatherboard")!.id);
    // Weatherboard is the outermost strip on the left (+y) side.
    expect(Math.min(...regions[0]!.loop.map((q) => q.y))).toBeCloseTo(139 / 2 - 18);
  });

  it("split a floor cut in a section into top-down layers", () => {
    const { doc, ids } = model();
    const f = doc.transact("F", (tx) =>
      createFloor(tx, ids.floorTypes.timber, ids.levels.first, [p(0, 0), p(4000, 0), p(4000, 3000), p(0, 3000)]),
    );
    const s = doc.transact("S", (tx) => createSection(tx, doc, p(-500, 1500), p(4500, 1500)));
    // The floor's cut in the section: x along the view, y = Z from 2440 to 2700.
    const regions = layerRegions(doc, f, [[p(500, 2440), p(4500, 2440), p(4500, 2700), p(500, 2700)]], viewFrame(s));
    expect(regions.map((r) => Math.round(area(r.loop) / 4000))).toEqual([20, 240]);
    expect(regions[0]!.materialId).toBe(materialByName(doc, "Plywood")!.id);
  });
});

describe("surface patterns", () => {
  it("are drawn on faces facing the viewer and hidden behind nearer surfaces", () => {
    const face = extrudePolygon([p(0, 0), p(3000, 0), p(3000, 1000), p(0, 1000)], [], 0, 100); // top face at z = 100
    const cover = extrudePolygon([p(0, 0), p(1500, 0), p(1500, 1000), p(0, 1000)], [], 200, 300);
    const [lw] = planLinework(
      [
        { id: "face", mesh: face, surface: [{ angle: 90, spacing: 150 }] },
        { id: "cover", mesh: cover },
      ],
      { bottom: 0, cut: 1200 },
    );
    // Vertical lines every 150 mm, 1000 long; only those right of the cover (x > 1500) show.
    const xs = new Set<number>();
    for (let i = 0; i < lw!.surface.length; i += 4) xs.add(Math.round(lw!.surface[i]!));
    expect([...xs].sort((a, b) => a - b)).toEqual([1650, 1800, 1950, 2100, 2250, 2400, 2550, 2700, 2850]);
    expect(totalLength(lw!.surface)).toBeCloseTo(9 * 1000, 0);
  });
});
