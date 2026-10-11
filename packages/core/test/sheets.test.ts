import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createSheet,
  floorPlanFor,
  nextSheetNumber,
  placeView,
  sheetOfView,
  sheets,
  views,
  viewportsOn,
} from "../src/index.ts";

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  return { doc, ids };
}

describe("sheets", () => {
  it("number in the A1xx series and sort numerically", () => {
    const { doc } = setup();
    doc.transact("S", (tx) => createSheet(tx, doc, { name: "Ground Floor Plan" }));
    doc.transact("S", (tx) => createSheet(tx, doc, { number: "A110", name: "Details" }));
    doc.transact("S", (tx) => createSheet(tx, doc, { name: "First Floor Plan" }));
    expect(sheets(doc).map((s) => s.params.number)).toEqual(["A101", "A102", "A110"]);
    expect(nextSheetNumber(doc)).toBe("A103");
    expect(() => doc.transact("S", (tx) => createSheet(tx, doc, { number: "A101" }))).toThrow(/already exists/);
  });

  it("place a view once, centred by default, and lose viewports with the sheet or view", () => {
    const { doc, ids } = setup();
    const sheet = doc.transact("S", (tx) => createSheet(tx, doc, { size: "A1" }));
    const plan = floorPlanFor(doc, ids.levels.ground)!;
    const vp = doc.transact("Place", (tx) => placeView(tx, doc, sheet.id, plan.id));
    expect(vp.params.centre).toEqual({ x: 841 / 2 - 40, y: 594 / 2 });
    expect(sheetOfView(doc, plan.id)?.id).toBe(sheet.id);
    const other = doc.transact("S", (tx) => createSheet(tx, doc));
    expect(() => doc.transact("Place", (tx) => placeView(tx, doc, other.id, plan.id))).toThrow(/already on sheet A101/);
    const v3d = views(doc).find((v) => v.params.kind === "3d")!;
    expect(() => doc.transact("Place", (tx) => placeView(tx, doc, other.id, v3d.id))).toThrow(/3D/);

    doc.transact("Delete sheet", (tx) => tx.delete(sheet.id));
    expect(doc.has(vp.id)).toBe(false);
    expect(doc.has(plan.id)).toBe(true);
    const vp2 = doc.transact("Place", (tx) => placeView(tx, doc, other.id, plan.id));
    doc.transact("Delete view", (tx) => tx.delete(plan.id));
    expect(doc.has(vp2.id)).toBe(false);
    expect(viewportsOn(doc, other.id)).toEqual([]);
  });
});
