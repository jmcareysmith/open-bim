import { describe, expect, it } from "vitest";
import {
  Cat,
  Document,
  applyAffine,
  applyFamilyTemplate,
  applyResidentialTemplate,
  createDetailComponent,
  createDetailLine,
  createFilledRegion,
  detailContent,
  detailTransform,
  loadFamily,
  mirrorAcross,
  rotationAbout,
  transformElements,
  views,
  type DetailComponentParams,
  type FamilyDef,
  type Vec2,
} from "../src/index.ts";

/** A 90 × 45 timber section: outline and one diagonal. */
function timber(): Document {
  const fam = new Document();
  applyFamilyTemplate(fam, "DetailItem", "Timber 90x45");
  const plan = views(fam)[0]!;
  fam.transact("Draw", (tx) => {
    createDetailLine(tx, fam, plan.id, { x: -45, y: -22.5 }, { x: 45, y: 22.5 });
    createFilledRegion(tx, fam, plan.id, [
      { x: -45, y: -22.5 },
      { x: 45, y: -22.5 },
      { x: 45, y: 22.5 },
      { x: -45, y: 22.5 },
    ]);
  });
  return fam;
}

function setup() {
  const doc = new Document();
  applyResidentialTemplate(doc);
  const plan = views(doc).find((v) => v.params.kind === "floorPlan")!;
  const def = doc.transact("Load", (tx) => loadFamily(tx, doc, timber(), "Timber 90x45")) as FamilyDef;
  return { doc, plan, def };
}

const close = (a: Vec2, b: Vec2) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe("detail components", () => {
  it("detail item families are 2D: one plan view, no elevations or 3D", () => {
    const fam = timber();
    expect(views(fam).map((v) => v.params.kind)).toEqual(["floorPlan"]);
  });

  it("read the family's lines and regions, and place them in a view", () => {
    const { doc, plan, def } = setup();
    const c = detailContent(def);
    expect(c.lines).toHaveLength(1);
    expect(c.regions).toHaveLength(1);
    expect(detailContent(def)).toBe(c); // cached
    const d = doc.transact("Place", (tx) => createDetailComponent(tx, doc, plan.id, def.id, { x: 1000, y: 500 }, { rotation: Math.PI / 2 }));
    close(detailTransform(d.params)({ x: 45, y: 0 }), { x: 1000, y: 545 });
    const v3d = views(doc).find((v) => v.params.kind === "3d")!;
    expect(() => doc.transact("Place", (tx) => createDetailComponent(tx, doc, v3d.id, def.id, { x: 0, y: 0 }))).toThrow(/plans, sections/);
    // Deleting the family deletes its instances.
    doc.transact("Delete", (tx) => tx.delete(def.id));
    expect(doc.byCategory(Cat.DetailComponent)).toHaveLength(0);
  });

  it("rotate and mirror give true images of the original", () => {
    const { doc, plan, def } = setup();
    const d = doc.transact("Place", (tx) => createDetailComponent(tx, doc, plan.id, def.id, { x: 300, y: 200 }, { rotation: 0.4 }));
    const q = { x: 40, y: 15 };
    const before = detailTransform(d.params)(q);
    for (const t of [rotationAbout({ x: 50, y: -20 }, 1.1), mirrorAcross({ x: 0, y: 0 }, { x: 1, y: 2 })]) {
      const p0 = detailTransform(doc.require<DetailComponentParams>(d.id).params)(q);
      doc.transact("Modify", (tx) => transformElements(tx, doc, [d.id], t));
      close(detailTransform(doc.require<DetailComponentParams>(d.id).params)(q), applyAffine(t, p0));
    }
    expect(doc.require<DetailComponentParams>(d.id).params.mirrored).toBe(true);
    expect(before).toBeDefined();
  });
});
