import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createRailing,
  createStair,
  createStairRailings,
  ensureRailingType,
  ensureStairType,
  railingPath,
  type StairParams,
} from "@open-bim/core";
import { SimpleKernel, boundingBox, meshVolume } from "../src/index.ts";

describe("railings", () => {
  it("sketched railings: 1 m high, balusters close enough for the 100 mm gap", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const r = doc.transact("R", (tx) =>
      createRailing(tx, doc, ensureRailingType(tx, doc), ids.levels.first, [
        { x: 0, y: 0 },
        { x: 3000, y: 0 },
        { x: 3000, y: 1200 },
      ]),
    );
    const m = new SimpleKernel().build(doc, r)!;
    expect(meshVolume(m)).toBeGreaterThan(0);
    const bb = boundingBox(m);
    expect(bb.max[2]).toBeCloseTo(2700 + 1000);
    expect(bb.min[2]).toBeCloseTo(2700);
    // 3000 mm at 120 mm centres: 25 bays, each 100 mm clear between 20 mm balusters.
    const boxes = m.positions.length / 3 / 24;
    expect(boxes).toBe(2 + (25 + 10 + 1));
  });

  it("stair railings follow the pitch on both sides and go with the stair", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const { stair, rails } = doc.transact("S", (tx) => {
      const stair = createStair(tx, doc, ensureStairType(tx, doc), ids.levels.ground, ids.levels.first, [{ start: { x: 0, y: 0 }, end: { x: 4000, y: 0 } }]);
      return { stair, rails: createStairRailings(tx, doc, ensureRailingType(tx, doc), stair) };
    });
    const [left, right] = rails.map((r) => railingPath(doc, r));
    expect(left![0]!.y).toBeCloseTo(400);
    expect(right![0]!.y).toBeCloseTo(-400);
    expect(left![0]!.z).toBeCloseTo(180);
    expect(left!.at(-1)!.z).toBeCloseTo(2700);
    expect(left!.at(-1)!.x).toBeCloseTo(14 * 280);
    doc.transact("Move", (tx) => tx.update<StairParams>(stair.id, { runs: [{ start: { x: 1000, y: 0 }, end: { x: 5000, y: 0 } }] }));
    expect(railingPath(doc, doc.require(rails[0]!.id) as never)[0]!.x).toBeCloseTo(1000);
    doc.transact("Delete", (tx) => tx.delete(stair.id));
    expect(doc.has(rails[0]!.id)).toBe(false);
  });
});
