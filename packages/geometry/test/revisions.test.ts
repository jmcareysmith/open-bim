import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createRevision,
  createRevisionCloud,
  createSheet,
  currentRevision,
  floorPlanFor,
  moveRevision,
  placeView,
  revisionNumber,
  revisions,
  setSheetRevisions,
  sheetRevisions,
  type RevisionParams,
  type Sheet,
} from "@open-bim/core";
import { SimpleKernel, buildRevisionCloudLines, sheetDrawing } from "../src/index.ts";

const square = [
  { x: 0, y: 0 },
  { x: 4000, y: 0 },
  { x: 4000, y: 3000 },
  { x: 0, y: 3000 },
];

describe("revisions", () => {
  it("number in sequence, letters and numbers counted separately; reordering renumbers", () => {
    const doc = new Document();
    const [a, b, c] = doc.transact("R", (tx) => [
      createRevision(tx, doc, { description: "Preliminary" }),
      createRevision(tx, doc, { description: "Consent" }),
      createRevision(tx, doc, { description: "Construction", numbering: "numeric" }),
    ]);
    expect([a, b, c].map((r) => revisionNumber(doc, r!))).toEqual(["A", "B", "1"]);
    doc.transact("Move", (tx) => moveRevision(tx, doc, b!.id, -1));
    expect(revisions(doc).map((r) => r.params.description)).toEqual(["Consent", "Preliminary", "Construction"]);
    expect(revisionNumber(doc, doc.require(b!.id) as never)).toBe("A");
  });

  it("sheets show revisions clouded in their views, plus ones added by hand", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const plan = floorPlanFor(doc, ids.levels.ground)!;
    const [r1, r2, r3] = doc.transact("R", (tx) => [
      createRevision(tx, doc, { description: "Issued for consent", date: "2026-10-01" }),
      createRevision(tx, doc, { description: "RFI response", date: "2026-10-12" }),
      createRevision(tx, doc, { description: "Not on this sheet" }),
    ]);
    const sheet = doc.transact("S", (tx) => {
      const s = createSheet(tx, doc, { number: "A101", name: "Ground Floor Plan" });
      placeView(tx, doc, s.id, plan.id);
      return s;
    });
    expect(currentRevision(doc, sheet)).toBe("");
    doc.transact("Cloud", (tx) => createRevisionCloud(tx, doc, plan.id, r2!.id, square));
    doc.transact("Add", (tx) => setSheetRevisions(tx, doc.require(sheet.id) as Sheet, [r1!.id]));
    const s = doc.require(sheet.id) as Sheet;
    expect(sheetRevisions(doc, s).map((r) => r.id)).toEqual([r1!.id, r2!.id]);
    expect(currentRevision(doc, s)).toBe("B");
    const texts = sheetDrawing(doc, new SimpleKernel(), s).texts.map((t) => t.text);
    expect(texts).toEqual(expect.arrayContaining(["RFI response", "Issued for consent", "B"]));
    expect(texts).not.toContain("Not on this sheet");
    expect(r3).toBeDefined();
  });

  it("issued revisions are locked; clouds draw scallops and a tag", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const plan = floorPlanFor(doc, ids.levels.ground)!;
    const r = doc.transact("R", (tx) => createRevision(tx, doc));
    const cloud = doc.transact("C", (tx) => createRevisionCloud(tx, doc, plan.id, r.id, square));
    const lines = buildRevisionCloudLines(doc, cloud)!;
    expect(lines.labels[0]!.text).toBe("A");
    // Scallops bulge outside the boundary.
    let minY = Infinity;
    for (let i = 1; i < lines.segments.length; i += 3) minY = Math.min(minY, lines.segments[i]!);
    expect(minY).toBeLessThan(-10);
    doc.transact("Issue", (tx) => tx.update<RevisionParams>(r.id, { issued: true }));
    expect(() => doc.transact("C", (tx) => createRevisionCloud(tx, doc, plan.id, r.id, square))).toThrow(/issued/);
  });
});
