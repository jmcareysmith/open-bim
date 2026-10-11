import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Cat,
  Document,
  applyFamilyTemplate,
  applyResidentialTemplate,
  createDimension,
  createExtrusion,
  createFamilyType,
  createReferencePlane,
  enableFamilyFlex,
  familyValues,
  floorPlanFor,
  levels,
  loadFamily,
  placeFamilyInstance,
  setFamilySolver,
  setFamilyValue,
  type ElementId,
  type ReferencePlaneParams,
  type Vec2,
} from "@open-bim/core";
import { SimpleKernel, boundingBox, createPlaneSolver, meshVolume } from "../src/index.ts";

beforeAll(async () => {
  setFamilySolver(await createPlaneSolver());
}, 30_000);
afterAll(() => setFamilySolver(null));

const p = (x: number, y: number): Vec2 => ({ x, y });

/** Furniture family with Left/Right planes: Width between them, EQ about the centre. */
function table() {
  const doc = new Document();
  applyFamilyTemplate(doc, "Furniture", "Table");
  enableFamilyFlex(doc);
  const plan = floorPlanFor(doc, levels(doc)[0]!.id)!;
  const centre = doc.byCategory(Cat.ReferencePlane).find((r) => r.name === "Center (Left/Right)")!.id;
  const [left, right] = doc.transact("Planes", (tx) => [
    createReferencePlane(tx, doc, p(-400, -1000), p(-400, 1000), "Left").id,
    createReferencePlane(tx, doc, p(500, -1000), p(500, 1000), "Right").id,
  ]);
  const ref = (id: ElementId, y = 0) => ({ kind: "datum" as const, id, pick: p(0, y) });
  doc.transact("Width", (tx) => {
    const d = createDimension(tx, doc, plan.id, [ref(left!), ref(right!)], p(0, 800));
    tx.update(d.id, { label: "Width" });
  });
  doc.transact("EQ", (tx) => {
    const d = createDimension(tx, doc, plan.id, [ref(left!), ref(centre), ref(right!)], p(0, 600));
    tx.update(d.id, { equality: true });
  });
  return { doc, left: left!, right: right! };
}

const x = (doc: Document, id: ElementId) => doc.require<ReferencePlaneParams>(id).params.start.x;

describe("family constraints (PlaneGCS)", () => {
  it("labelled dimensions and EQ flex the reference planes", () => {
    const { doc, left, right } = table();
    expect(x(doc, left)).toBeCloseTo(-600, 3);
    expect(x(doc, right)).toBeCloseTo(600, 3);
    doc.transact("Wider", (tx) => setFamilyValue(tx, doc, "Width", 2000));
    expect(x(doc, left)).toBeCloseTo(-1000, 3);
    expect(x(doc, right)).toBeCloseTo(1000, 3);
    // Flexing is part of the same undo step.
    doc.undo();
    expect(x(doc, right)).toBeCloseTo(600, 3);
  });

  it("forms locked to planes by name follow them, per type, in placed instances too", () => {
    const { doc } = table();
    doc.transact("Top", (tx) =>
      createExtrusion(tx, [{ x: "Left", y: 0 }, { x: "Right", y: 0 }, { x: "Right", y: "Depth" }, { x: "Left", y: "Depth" }], {
        start: "Height - 30",
        end: "Height",
      }),
    );
    doc.transact("Type", (tx) => createFamilyType(tx, doc, "Long"));
    doc.transact("W", (tx) => setFamilyValue(tx, doc, "Width", 2400));
    expect(familyValues(doc, "Default")["Right"]).toBeCloseTo(600, 3);
    expect(familyValues(doc, "Long")["Right"]).toBeCloseTo(1200, 3);

    const project = new Document();
    const ids = applyResidentialTemplate(project);
    const def = project.transact("Load", (tx) => loadFamily(tx, project, doc, "Table"));
    const k = new SimpleKernel();
    const a = project.transact("P", (tx) => placeFamilyInstance(tx, project, def.id, "Default", { levelId: ids.levels.ground }));
    const b = project.transact("P", (tx) => placeFamilyInstance(tx, project, def.id, "Long", { levelId: ids.levels.ground }));
    expect(meshVolume(k.build(project, a)!)).toBeCloseTo(1200 * 600 * 30, -2);
    const bb = boundingBox(k.build(project, b)!);
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(2400, 1);
  });

  it("reports over-constrained families", () => {
    const { doc, left, right } = table();
    const plan = floorPlanFor(doc, levels(doc)[0]!.id)!;
    const ref = (id: ElementId) => ({ kind: "datum" as const, id, pick: p(0, 0) });
    expect(() =>
      doc.transact("Conflict", (tx) => {
        const d = createDimension(tx, doc, plan.id, [ref(left), ref(right)], p(0, 900));
        tx.update(d.id, { label: "Depth" }); // Width and Depth can't both hold
      }),
    ).toThrow(/can't all be satisfied/);
  });
});
