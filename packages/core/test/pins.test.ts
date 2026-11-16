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
