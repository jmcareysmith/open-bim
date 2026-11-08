import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  ceilingPlanFor,
  createCeiling,
  createCeilingPlan,
  createFloor,
  createWall,
  viewRange,
  type Vec2,
  type View,
} from "@open-bim/core";
import { SimpleKernel, viewDrawing } from "../src/index.ts";

const p = (x: number, y: number): Vec2 => ({ x, y });

describe("reflected ceiling plans", () => {
  it("look up from 2300: ceilings and walls show, the floor slab doesn't", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const box = [p(0, 0), p(5000, 0), p(5000, 4000), p(0, 4000)];
    doc.transact("Model", (tx) => {
      box.forEach((a, i) => createWall(tx, ids.wallTypes.interior, a, box[(i + 1) % 4]!, ids.levels.ground, { topLevelId: ids.levels.first }));
      createFloor(tx, ids.floorTypes.slab, ids.levels.ground, [p(-2000, -2000), p(9000, -2000), p(9000, 8000), p(-2000, 8000)]);
      createCeiling(tx, ids.ceilingTypes.plasterboard, ids.levels.ground, [p(100, 100), p(4900, 100), p(4900, 3900), p(100, 3900)]);
    });
    const rcp = doc.transact("RCP", (tx) => createCeilingPlan(tx, doc, ids.levels.ground));
    expect(ceilingPlanFor(doc, ids.levels.ground)?.id).toBe(rcp.id);
    const r = viewRange(doc, rcp as View);
    expect(r).toMatchObject({ cut: 2300, up: true, top: 2700 });
    const d = viewDrawing(doc, new SimpleKernel(), rcp as never);
    const ids_ = (kind: string) => new Set(d.strokes.filter((s) => s.kind === kind && s.segments.length).map((s) => s.id));
    const cats = (set: Set<string | undefined>) => new Set([...set].map((id) => (id ? doc.get(id)?.category : undefined)));
    // Walls cut at 2300; the ceiling seen above; the slab (and its 9000 m edge) nowhere.
    expect(cats(ids_("cut")).has("Wall")).toBe(true);
    expect(cats(ids_("beyond")).has("Ceiling")).toBe(true);
    const all = new Set(d.strokes.map((s) => (s.id ? doc.get(s.id)?.category : undefined)));
    expect(all.has("Floor")).toBe(false);
    // Plan coordinates are not mirrored.
    expect(d.bounds.max.x).toBeLessThan(9000);
  });
});
