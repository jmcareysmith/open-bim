import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createDetailLine,
  createDimension,
  createFilledRegion,
  createTextNote,
  createInsulation,
  type TextNoteParams,
  createWall,
  floorPlanFor,
  type Vec2,
  type ViewParams,
} from "@open-bim/core";
import { SimpleKernel } from "../src/index.ts";

const p = (x: number, y: number): Vec2 => ({ x, y });

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const plan = floorPlanFor(doc, ids.levels.ground)!;
  return { doc, ids, plan, k: new SimpleKernel() };
}

describe("annotation line work", () => {
  it("dimensions show their values and scale their text with the view", () => {
    const { doc, ids, plan, k } = setup();
    const w = (x: number) =>
      doc.transact("W", (tx) => createWall(tx, ids.wallTypes.interior, p(x, 0), p(x, 4000), ids.levels.ground, { height: 2400 }));
    const a = w(0);
    const b = w(3600);
    const dim = doc.transact("D", (tx) =>
      createDimension(tx, doc, plan.id, [
        { kind: "wallFace", id: a.id, side: "centre", pick: p(0, 1000) },
        { kind: "wallFace", id: b.id, side: "centre", pick: p(3600, 1000) },
      ], p(0, 5000)),
    );
    const lines = k.buildLines(doc, dim)!;
    expect(lines.labels.map((l) => l.text)).toEqual(["3600"]);
    expect(lines.labels[0]!.size).toBe(250); // 2.5 mm at 1:100
    // 2 witness lines + dimension line + 2 ticks
    expect(lines.segments.length / 6).toBe(5);
    doc.transact("Label", (tx) => tx.update(dim.id, { label: "Bay" }));
    expect(k.buildLines(doc, doc.require(dim.id))!.labels[0]!.text).toBe("Bay = 3600");
    doc.transact("EQ", (tx) => tx.update(dim.id, { equality: true }));
    expect(k.buildLines(doc, doc.require(dim.id))!.labels[0]!.text).toBe("EQ");
    doc.transact("Scale", (tx) => tx.update<ViewParams>(plan.id, { scale: 50 }));
    expect(k.buildLines(doc, doc.require(dim.id))!.labels[0]!.size).toBe(125);
  });

  it("detail lines, filled regions and text", () => {
    const { doc, plan, k } = setup();
    const line = doc.transact("L", (tx) => createDetailLine(tx, doc, plan.id, p(0, 0), p(1000, 0), "hidden"));
    expect(k.buildLines(doc, line)!.dashed).toBe(true);
    const reg = doc.transact("R", (tx) => createFilledRegion(tx, doc, plan.id, [p(0, 0), p(1000, 0), p(1000, 1000), p(0, 1000)], { color: 0x336699 }));
    const rl = k.buildLines(doc, reg)!;
    expect(rl.fill!.color).toBe(0x336699);
    expect(rl.segments.length / 6).toBe(4);
    const t = doc.transact("T", (tx) => createTextNote(tx, doc, plan.id, p(10, 20), "BED 1", 3.5));
    expect(k.buildLines(doc, t)!.labels).toEqual([{ text: "BED 1", position: [10, 20, 0], size: 350, align: "left" }]);
  });

  it("insulation loops fill its width; text leaders end in arrows", () => {
    const { doc, plan, k } = setup();
    const ins = doc.transact("I", (tx) => createInsulation(tx, doc, plan.id, p(0, 0), p(3000, 0), 90));
    const l = k.buildLines(doc, ins, 100)!;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 1; i < l.segments.length; i += 3) {
      minY = Math.min(minY, l.segments[i]!);
      maxY = Math.max(maxY, l.segments[i]!);
    }
    expect(maxY - minY).toBeCloseTo(90, 0);
    const t = doc.transact("T", (tx) => createTextNote(tx, doc, plan.id, p(0, 1000), "LINING"));
    const plain = k.buildLines(doc, t, 100)!.segments.length;
    doc.transact("Leader", (tx) => tx.update<TextNoteParams>(t.id, { leaders: [p(5000, 0)] }));
    const withLeader = k.buildLines(doc, doc.require(t.id), 100)!;
    // Shoulder, leader and two arrow strokes.
    expect(withLeader.segments.length - plain).toBe(4 * 6);
    expect(withLeader.segments.slice(-6, -4)).toEqual(new Float32Array([5000, 0]));
  });
});
