import { describe, expect, it } from "vitest";
import { Document, createLevel, createRamp, createStairRailings, ensureRailingType, ensureRampType, railingPath, rampLayout } from "@open-bim/core";
import { SimpleKernel, boundingBox, meshVolume } from "../src/index.ts";

function site() {
  const doc = new Document();
  const [ground, deck] = doc.transact("Levels", (tx) => [createLevel(tx, "Ground", 0), createLevel(tx, "Deck", 600)]);
  return { doc, ground: ground!.id, deck: deck!.id };
}

describe("ramps", () => {
  it("share the rise over the runs, with a landing at the turn, and check 1:12", () => {
    const { doc, ground, deck } = site();
    const ramp = doc.transact("Ramp", (tx) =>
      createRamp(tx, doc, ensureRampType(tx, doc), ground, deck, [
        { start: { x: 0, y: 0 }, end: { x: 4800, y: 0 } },
        { start: { x: 5400, y: 600 }, end: { x: 5400, y: 3000 } },
      ]),
    );
    const L = rampLayout(doc, ramp);
    expect(L.runs[0]!.z1).toBeCloseTo(400);
    expect(L.runs[1]!.z1).toBeCloseTo(600);
    expect(L.slope).toBeCloseTo(12);
    expect(L.checks[0]!.ok).toBe(true);
    expect(L.landings).toHaveLength(1);
    const m = new SimpleKernel().build(doc, ramp)!;
    expect(meshVolume(m)).toBeGreaterThan(0);
    expect(boundingBox(m).max[2]).toBeCloseTo(600);
    // Railings follow the ramp surface.
    const rails = doc.transact("Rails", (tx) => createStairRailings(tx, doc, ensureRailingType(tx, doc), ramp));
    const path = railingPath(doc, rails[0]!);
    expect(path[0]!.z).toBeCloseTo(0);
    expect(path.at(-1)!.z).toBeCloseTo(600);
  });

  it("flags ramps steeper than 1:12", () => {
    const { doc, ground, deck } = site();
    const ramp = doc.transact("Ramp", (tx) => createRamp(tx, doc, ensureRampType(tx, doc), ground, deck, [{ start: { x: 0, y: 0 }, end: { x: 4000, y: 0 } }]));
    expect(rampLayout(doc, ramp).checks[0]!.ok).toBe(false);
  });
});
