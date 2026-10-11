import { describe, expect, it } from "vitest";
import {
  Cat,
  Document,
  applyResidentialTemplate,
  createMaterial,
  createWall,
  elementMaterial,
  layerMaterial,
  materialByName,
  type ChangeSet,
  type LayeredTypeParams,
  type MaterialParams,
} from "../src/index.ts";

describe("materials", () => {
  it("the template links every layer to a material", () => {
    const doc = new Document();
    applyResidentialTemplate(doc);
    for (const cat of [Cat.WallType, Cat.FloorType, Cat.CeilingType, Cat.RoofType]) {
      for (const t of doc.byCategory<LayeredTypeParams>(cat)) {
        for (const l of t.params.layers) expect(layerMaterial(doc, l)?.name).toBe(l.material);
      }
    }
    expect(materialByName(doc, "Weatherboard")!.params.surfacePattern).toBe("weatherboard");
  });

  it("resolve legacy layers by name, and give elements their first layer's material", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    expect(layerMaterial(doc, { function: "structure", material: "Concrete", thickness: 100 })?.name).toBe("Concrete");
    const w = doc.transact("W", (tx) => createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 1000, y: 0 }, ids.levels.ground));
    expect(elementMaterial(doc, w)?.name).toBe("Weatherboard");
  });

  it("editing a material regenerates elements whose types use it; used materials can't be deleted", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const w = doc.transact("W", (tx) => createWall(tx, ids.wallTypes.interior, { x: 0, y: 0 }, { x: 1000, y: 0 }, ids.levels.ground));
    const changes: ChangeSet[] = [];
    doc.on((c) => changes.push(c));
    const pb = materialByName(doc, "Plasterboard")!;
    doc.transact("Colour", (tx) => tx.update<MaterialParams>(pb.id, { color: 0xff0000 }));
    expect(changes.at(-1)!.regenerate).toEqual(expect.arrayContaining([ids.wallTypes.interior, w.id]));
    expect(() => doc.transact("Delete", (tx) => tx.delete(pb.id))).toThrow(/still used/);
  });

  it("names are unique", () => {
    const doc = new Document();
    applyResidentialTemplate(doc);
    expect(() => doc.transact("M", (tx) => createMaterial(tx, doc, "Concrete"))).toThrow(/already exists/);
    expect(doc.transact("M", (tx) => createMaterial(tx, doc, "Brick", { surfacePattern: "brick" })).params.cutPattern).toBe("diagonal");
  });
});
