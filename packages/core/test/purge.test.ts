import { describe, expect, it } from "vitest";
import { Cat, Document, applyResidentialTemplate, createWall, purgeUnused, unusedElements } from "../src/index.ts";

describe("purge unused", () => {
  it("removes types nothing uses but keeps used ones and one of each kind", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    doc.transact("W", (tx) => createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 4000, y: 0 }, ids.levels.ground, { height: 2400 }));
    const unused = unusedElements(doc);
    expect(unused.some((e) => e.id === ids.wallTypes.exterior)).toBe(false);
    const before = doc.byCategory(Cat.WallType).length;
    const n = doc.transact("Purge", (tx) => purgeUnused(tx, doc));
    expect(n).toBe(unused.length);
    expect(doc.byCategory(Cat.WallType).length).toBeGreaterThanOrEqual(1);
    expect(doc.byCategory(Cat.WallType).length).toBeLessThanOrEqual(before);
    expect(doc.has(ids.wallTypes.exterior)).toBe(true);
    // Every remaining type category still has a type.
    for (const c of [Cat.FloorType, Cat.RoofType, Cat.DoorType, Cat.WindowType]) expect(doc.byCategory(c).length).toBeGreaterThan(0);
  });
});

describe("purge keeps materials named in layers", () => {
  it("a material a wall type's layer uses by name stays", () => {
    const doc = new Document();
    applyResidentialTemplate(doc);
    const named = new Set<string>();
    for (const t of doc.byCategory<{ layers?: { material?: string }[] }>(Cat.WallType)) for (const l of t.params.layers ?? []) if (l.material) named.add(l.material);
    const unusedMats = unusedElements(doc).filter((e) => e.category === Cat.Material).map((e) => e.name);
    for (const m of unusedMats) expect(named.has(m!)).toBe(false);
  });
});
