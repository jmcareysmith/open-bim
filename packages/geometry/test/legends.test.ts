import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createKeynoteLegend,
  createLegend,
  createLegendComponent,
  createTag,
  createWall,
  floorPlanFor,
  parseKeynoteFile,
  setKeynoteTable,
  wallThickness,
  type KeynoteLegend,
} from "@open-bim/core";
import { SimpleKernel, buildLegendLines, viewDrawing } from "../src/index.ts";

describe("legends", () => {
  it("legend components draw their type, and follow type edits", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const legend = doc.transact("Legend", (tx) => createLegend(tx, doc));
    expect(legend.name).toBe("Legend 1");
    const c = doc.transact("C", (tx) => createLegendComponent(tx, doc, legend.id, ids.wallTypes.exterior, { x: 0, y: 0 }));
    const lines = buildLegendLines(doc, c)!;
    const ys = [];
    for (let i = 1; i < lines.segments.length; i += 3) ys.push(lines.segments[i]!);
    // The swatch is as deep as the wall type is thick.
    const w = doc.transact("W", (tx) =>
      createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 1000, y: 0 }, ids.levels.ground, { topLevelId: ids.levels.first }),
    );
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(wallThickness(doc, w));
    expect(lines.labels[0]!.text).toBe(doc.require(ids.wallTypes.exterior).name);

    const door = doc.transact("D", (tx) => createLegendComponent(tx, doc, legend.id, ids.doorTypes.single810, { x: 0, y: -500 }));
    expect(buildLegendLines(doc, door)!.segments.length).toBeGreaterThan(0);
    // Only types; and only in legends.
    expect(() => doc.transact("X", (tx) => createLegendComponent(tx, doc, legend.id, ids.levels.ground, { x: 0, y: 0 }))).toThrow();
    const plan = floorPlanFor(doc, ids.levels.ground)!;
    expect(() => doc.transact("X", (tx) => createLegendComponent(tx, doc, plan.id, ids.wallTypes.exterior, { x: 0, y: 0 }))).toThrow(/legend views/);

    // Legend drawings contain only the legend's own content.
    const d = viewDrawing(doc, new SimpleKernel(), legend);
    expect(d.strokes.every((s) => s.id === c.id || s.id === door.id)).toBe(true);
    expect(d.bounds.max.x).toBeGreaterThan(d.bounds.min.x);
  });

  it("keynote legends list the keynotes tagged in a view", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    doc.transact("K", (tx) => setKeynoteTable(tx, doc, parseKeynoteFile("E20\tBevel-back weatherboard\r\nB10\tTimber framing\r\n")));
    const wall = doc.transact("W", (tx) =>
      createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 4000, y: 0 }, ids.levels.ground, { topLevelId: ids.levels.first }),
    );
    doc.transact("Keynote", (tx) => tx.update(wall.id, { keynote: "E20" }));
    const plan = floorPlanFor(doc, ids.levels.ground)!;
    const legend = doc.transact("Legend", (tx) => createLegend(tx, doc));
    const kl = doc.transact("KL", (tx) => createKeynoteLegend(tx, doc, legend.id, { x: 0, y: 0 }, plan.id));
    const texts = () => buildLegendLines(doc, doc.require(kl.id) as KeynoteLegend)!.labels.map((l) => l.text);
    expect(texts()).toContain("(no keynotes tagged)");
    let regenerated = false;
    doc.on((c) => {
      regenerated ||= c.regenerate.includes(kl.id);
    });
    doc.transact("Tag", (tx) => createTag(tx, doc, plan.id, wall.id, { x: 2000, y: -500 }, { kind: "keynote" }));
    expect(regenerated).toBe(true);
    expect(texts()).toEqual(["Keynote Legend", "E20", "Bevel-back weatherboard"]);
  });
});
