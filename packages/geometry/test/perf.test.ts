import { describe, it } from "vitest";
import { createSection, floorPlanFor, type View, type WallParams } from "@open-bim/core";
import { bigModel } from "./bigmodel.ts";
import { SimpleKernel, viewDrawing } from "../src/index.ts";

// Speed check on a big model (run with PERF=1 npx vitest run packages/geometry/test/perf.test.ts):
// a grid of rooms per storey with doors and windows, timing the model build, an edit and drawings.

const perf = process.env.PERF ? it : it.skip;

const time = <T>(label: string, fn: () => T): T => {
  const t = performance.now();
  const r = fn();
  console.log(`${label}: ${(performance.now() - t).toFixed(0)} ms`);
  return r;
};

describe("performance", () => {
  perf("big model: build, edit, plan and section", () => {
    const { doc, lvls } = time("model (12×12 rooms × 3 storeys)", () => bigModel(12, 3));
    console.log(`elements: ${doc.all().length}`);
    const k = new SimpleKernel();
    time("all meshes", () => doc.all().forEach((e) => k.build(doc, e)));
    const w = doc.byCategory<WallParams>("Wall")[5]!;
    time("edit one wall", () => doc.transact("Move", (tx) => tx.update<WallParams>(w.id, { end: { x: w.params.end.x + 100, y: w.params.end.y } })));
    const plan = floorPlanFor(doc, lvls[0]!)! as View;
    time("plan drawing", () => viewDrawing(doc, k, plan));
    time("plan drawing again", () => viewDrawing(doc, k, plan));
    const s = doc.transact("S", (tx) => createSection(tx, doc, { x: -1000, y: 6000 }, { x: 50000, y: 6000 }));
    time("section drawing", () => viewDrawing(doc, k, doc.require(s.id) as View));
  });
});
