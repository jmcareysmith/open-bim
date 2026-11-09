import { describe, expect, it } from "vitest";
import { Document, applyResidentialTemplate, createDraftingView, createImageUnderlay, createSheet, placeView, transformElements, translation, type Sheet } from "@open-bim/core";
import { SimpleKernel, sheetDrawing, viewDrawing, writePdf } from "../src/index.ts";

// Any base64 will do for layout; the PDF writer embeds the bytes as they are.
const JPEG = btoa("\xff\xd8\xff\xe0fake-jpeg\xff\xd9");

describe("image underlays", () => {
  it("sit in their view's drawing, move, carry onto sheets and into the PDF", () => {
    const doc = new Document();
    applyResidentialTemplate(doc);
    const v = doc.transact("D", (tx) => createDraftingView(tx, doc));
    const im = doc.transact("I", (tx) => createImageUnderlay(tx, doc, v.id, { jpeg: JPEG, pixels: { w: 400, h: 200 } }));
    // 200 mm on paper at 1:10 = 2000 wide, 1000 high (the image's 2:1).
    expect(im.params.width).toBe(2000);
    expect(im.params.height).toBe(1000);
    doc.transact("M", (tx) => transformElements(tx, doc, [im.id], translation({ x: 500, y: 250 })));
    const d = viewDrawing(doc, new SimpleKernel(), v);
    expect(d.images).toEqual([expect.objectContaining({ x: 500, y: 250, width: 2000, height: 1000, id: im.id })]);
    expect(() => doc.transact("R", (tx) => transformElements(tx, doc, [im.id], { xx: 0, xy: -1, yx: 1, yy: 0, tx: 0, ty: 0 }))).toThrow(/only be moved/);

    const sheet = doc.transact("S", (tx) => createSheet(tx, doc, { number: "A101", name: "Details" })) as Sheet;
    doc.transact("P", (tx) => placeView(tx, doc, sheet.id, v.id, { x: 400, y: 300 }));
    const sd = sheetDrawing(doc, new SimpleKernel(), doc.require(sheet.id) as Sheet);
    // On paper at 1:10: 200 × 100 mm.
    expect(sd.images).toHaveLength(1);
    expect(sd.images![0]!.width).toBeCloseTo(200);
    expect(sd.images![0]!.height).toBeCloseTo(100);
    const pdf = new TextDecoder("latin1").decode(writePdf([{ width: sd.width, height: sd.height, drawing: sd }]));
    expect(pdf).toContain("/Subtype /Image /Width 400 /Height 200");
    expect(pdf).toContain("/Filter /DCTDecode");
    expect(pdf).toMatch(/\/XObject << \/Im0 \d+ 0 R >>/);
    expect(pdf).toContain("/Im0 Do");
  });
});
