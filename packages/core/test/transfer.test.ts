import { describe, expect, it } from "vitest";
import { Cat, Document, applyResidentialTemplate, transferStandards, type LayeredTypeParams } from "../src/index.ts";

describe("transfer project standards", () => {
  it("adds new types by name, skips or overwrites ones with the same name", () => {
    const src = new Document();
    applyResidentialTemplate(src);
    const ext = src.byCategory<LayeredTypeParams>(Cat.WallType)[0]!;
    src.transact("New", (tx) => tx.create(Cat.WallType, structuredClone(ext.params), { name: "Brick Veneer 70" }));
    src.transact("Change", (tx) => tx.update<LayeredTypeParams>(ext.id, { layers: ext.params.layers.slice(0, 1) }));
    const doc = new Document();
    applyResidentialTemplate(doc);
    const before = doc.byCategory(Cat.WallType).length;
    const r1 = doc.transact("T", (tx) => transferStandards(tx, doc, src, [Cat.WallType], "skip"));
    expect(r1.added).toBe(1);
    expect(doc.byCategory(Cat.WallType).length).toBe(before + 1);
    const mine = doc.byCategory<LayeredTypeParams>(Cat.WallType).find((t) => t.name === ext.name)!;
    expect(mine.params.layers.length).toBeGreaterThan(1);
    const r2 = doc.transact("T", (tx) => transferStandards(tx, doc, src, [Cat.WallType], "overwrite"));
    expect(r2.overwritten).toBeGreaterThan(0);
    expect(doc.require<LayeredTypeParams>(mine.id).params.layers.length).toBe(1);
  });
});

describe("overwrite replaces whole", () => {
  it("keys only ours had are dropped", () => {
    const src = new Document();
    applyResidentialTemplate(src);
    const doc = new Document();
    applyResidentialTemplate(doc);
    const mine = doc.byCategory<LayeredTypeParams>(Cat.WallType)[0]!;
    doc.transact("Extra", (tx) => tx.update(mine.id, { coarseFill: { pattern: "solid", color: 0xff0000 } } as never));
    doc.transact("T", (tx) => transferStandards(tx, doc, src, [Cat.WallType], "overwrite"));
    expect((doc.require(mine.id).params as { coarseFill?: unknown }).coarseFill).toBeUndefined();
  });
});
