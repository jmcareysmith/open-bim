import { describe, expect, it } from "vitest";
import { Cat, Document, applyResidentialTemplate, createCableTray, createConduit, enableMepFittings, ensureContainmentTypes, type FittingParams, type P3 } from "@open-bim/core";
import { SimpleKernel, boundingBox } from "../src/index.ts";

const p = (x: number, y: number, z = 2700): P3 => ({ x, y, z });

describe("cable tray and conduit", () => {
  it("route with their own automatic fittings and build as solids", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    enableMepFittings(doc);
    const { tray, conduit } = doc.transact("Types", (tx) => ensureContainmentTypes(tx, doc));
    const t1 = doc.transact("T", (tx) => createCableTray(tx, doc, tray, ids.levels.ground, p(0, 0), p(4000, 0), { width: 300, height: 100 }));
    doc.transact("T", (tx) => createCableTray(tx, doc, tray, ids.levels.ground, p(4000, 0), p(4000, 3000), { width: 300, height: 100 }));
    expect(doc.byCategory<FittingParams>(Cat.CableTrayFitting).map((f) => f.params.kind)).toEqual(["elbow"]);
    const bb = boundingBox(new SimpleKernel().build(doc, doc.require(t1.id))!);
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(300);
    expect(bb.max[2] - bb.min[2]).toBeCloseTo(100);
    // Conduit: a tee where one ends on another's side; it doesn't join the tray.
    doc.transact("C", (tx) => createConduit(tx, doc, conduit, ids.levels.ground, p(0, 1000), p(3000, 1000), { diameter: 25 }));
    doc.transact("C", (tx) => createConduit(tx, doc, conduit, ids.levels.ground, p(1500, 1000), p(1500, 2000), { diameter: 20 }));
    expect(doc.byCategory(Cat.Conduit)).toHaveLength(3);
    expect(doc.byCategory<FittingParams>(Cat.ConduitFitting).map((f) => f.params.kind)).toEqual(["tee"]);
    expect(doc.byCategory(Cat.CableTrayFitting)).toHaveLength(1);
  });
});
