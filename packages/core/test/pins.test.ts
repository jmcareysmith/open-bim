import { describe, expect, it } from "vitest";
import { Document, applyResidentialTemplate, createWall, enablePinning, setPinned, transformElements, translation, type WallParams } from "../src/index.ts";

describe("pinning", () => {
  it("a pinned wall can't move or be deleted, but its other properties change; unpinned it moves", () => {
    const doc = new Document();
    enablePinning(doc);
    const ids = applyResidentialTemplate(doc);
    const w = doc.transact("W", (tx) => createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 4000, y: 0 }, ids.levels.ground, { height: 2400 }));
    doc.transact("Pin", (tx) => setPinned(tx, doc, [w.id], true));
    expect(() => doc.transact("Move", (tx) => transformElements(tx, doc, [w.id], translation({ x: 100, y: 0 })))).toThrow(/pinned/);
    expect(() => doc.transact("Del", (tx) => tx.delete(w.id))).toThrow(/pinned/);
    doc.transact("Mark", (tx) => tx.update(w.id, { mark: "W1" }));
    expect(doc.require<WallParams>(w.id).params.start.x).toBe(0);
    doc.transact("Unpin", (tx) => setPinned(tx, doc, [w.id], false));
    doc.transact("Move", (tx) => transformElements(tx, doc, [w.id], translation({ x: 100, y: 0 })));
    expect(doc.require<WallParams>(w.id).params.start.x).toBe(100);
  });
});

describe("scale", () => {
  it("scaling a wall about its start doubles its length and keeps its thickness", async () => {
    const { scalingAbout, wallThickness } = await import("../src/index.ts");
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const w = doc.transact("W", (tx) => createWall(tx, ids.wallTypes.exterior, { x: 1000, y: 0 }, { x: 4000, y: 0 }, ids.levels.ground, { height: 2400 }));
    const t0 = wallThickness(doc, w as never);
    doc.transact("Scale", (tx) => transformElements(tx, doc, [w.id], scalingAbout({ x: 1000, y: 0 }, 2)));
    const p = doc.require<WallParams>(w.id).params;
    expect(p.start.x).toBeCloseTo(1000);
    expect(p.end.x).toBeCloseTo(7000);
    expect(wallThickness(doc, doc.require(w.id) as never)).toBe(t0);
  });
});

describe("wall chains (Tab)", () => {
  it("a closed rectangle chains all four; a tee stops the chain", async () => {
    const { wallChain } = await import("../src/index.ts");
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const t = ids.wallTypes.exterior;
    const pts = [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, { x: 0, y: 4000 }];
    const ws = doc.transact("W", (tx) => pts.map((p, i) => createWall(tx, t, p, pts[(i + 1) % 4]!, ids.levels.ground, { height: 2400 })));
    expect(new Set(wallChain(doc, ws[0] as never))).toEqual(new Set(ws.map((w) => w.id)));
    // A free wall teeing into the bottom: not part of the chain, and its own chain is just itself.
    const stem = doc.transact("T", (tx) => createWall(tx, t, { x: 3000, y: 0 }, { x: 3000, y: -2000 }, ids.levels.ground, { height: 2400 }));
    expect(wallChain(doc, ws[0] as never)).not.toContain(stem.id);
    expect(wallChain(doc, stem as never)).toEqual([stem.id]);
  });
});
