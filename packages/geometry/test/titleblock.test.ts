import { describe, expect, it } from "vitest";
import { Document, applyResidentialTemplate, createSheet, loadFamily, projectSettings, type ProjectSettingsParams, type SheetParams } from "@open-bim/core";
import { titleBlockA1 } from "@open-bim/library";
import { SimpleKernel, sheetDrawing } from "../src/index.ts";

describe("title block families", () => {
  it("draw on the sheet with their labels filled in", () => {
    const doc = new Document();
    applyResidentialTemplate(doc);
    const ps = projectSettings(doc)!;
    doc.transact("Info", (tx) => tx.update<ProjectSettingsParams>(ps.id, { info: { ...ps.params.info, name: "Harbour House", number: "24-017" } }));
    const sheet = doc.transact("Sheet", (tx) => createSheet(tx, doc));
    const k = new SimpleKernel();
    const builtIn = sheetDrawing(doc, k, sheet);
    expect(builtIn.texts.some((t) => t.text === "Open-BIM")).toBe(true);
    const def = doc.transact("Load", (tx) => loadFamily(tx, doc, titleBlockA1.build(), titleBlockA1.name));
    doc.transact("Use", (tx) => tx.update<SheetParams>(sheet.id, { titleBlockId: def.id }));
    const d = sheetDrawing(doc, k, doc.require(sheet.id) as never);
    const texts = d.texts.map((t) => t.text);
    expect(texts).toContain("Harbour House");
    expect(texts).toContain("24-017");
    expect(texts.some((t) => t.startsWith(`${(doc.require(sheet.id).params as SheetParams).number} / `))).toBe(true);
    // The built-in strip is gone; the family's border is there.
    expect(texts).not.toContain("Open-BIM");
    expect(d.strokes.some((s) => s.kind === "cut" && s.segments[0] === 20 && s.segments[1] === 10)).toBe(true);
  });
});
