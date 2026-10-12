import { describe, expect, it } from "vitest";
import { Document, applyResidentialTemplate, createTextNote, findText, replaceText, views, type TextNoteParams } from "../src/index.ts";

describe("find / replace in text notes", () => {
  it("finds and replaces, with match case and whole words", () => {
    const doc = new Document();
    applyResidentialTemplate(doc);
    const [a, b] = views(doc);
    const n1 = doc.transact("Text", (tx) => createTextNote(tx, doc, a!.id, { x: 0, y: 0 }, "Gib board to walls. GIB fixings per GIB spec."));
    const n2 = doc.transact("Text", (tx) => createTextNote(tx, doc, b!.id, { x: 0, y: 0 }, "Gibraltar board"));
    expect(findText(doc, "gib").map((m) => [m.id, m.count])).toEqual([
      [n1.id, 3],
      [n2.id, 1],
    ]);
    expect(findText(doc, "GIB", { matchCase: true })[0]!.count).toBe(2);
    expect(findText(doc, "gib", { wholeWord: true }).map((m) => m.id)).toEqual([n1.id]);
    expect(findText(doc, "gib", { viewId: b!.id }).map((m) => m.id)).toEqual([n2.id]);
    const n = doc.transact("Replace", (tx) => replaceText(tx, doc, "gib", "Plasterboard $1", { wholeWord: true }));
    expect(n).toBe(3);
    expect(doc.require<TextNoteParams>(n1.id).params.text).toBe("Plasterboard $1 board to walls. Plasterboard $1 fixings per Plasterboard $1 spec.");
    expect(doc.require<TextNoteParams>(n2.id).params.text).toBe("Gibraltar board");
    expect(findText(doc, "")).toEqual([]);
  });
});
