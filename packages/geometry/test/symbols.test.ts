import { describe, expect, it } from "vitest";
import { Document, applyFamilyTemplate, applyResidentialTemplate, createDetailComponent, createDetailLine, createSheet, createSymbol, loadFamily, views, type SymbolParams } from "@open-bim/core";
import { SimpleKernel, buildDetailComponentLines, buildSymbolLines, viewDrawing } from "../src/index.ts";

function setup() {
  const doc = new Document();
  applyResidentialTemplate(doc);
  const plan = views(doc).find((v) => v.params.kind === "floorPlan")!;
  return { doc, plan };
}

describe("symbol line work", () => {
  it("north arrow: scaled by the view, tip pointing north with an N label", () => {
    const { doc, plan } = setup();
    const n = doc.transact("N", (tx) => createSymbol(tx, doc, plan.id, "northArrow", { x: 0, y: 0 }));
    const lines = buildSymbolLines(doc, n)!;
    const ys = [...lines.segments].filter((_, i) => i % 3 === 1);
    // 15 mm on paper at 1:100 → 1500 mm tall, centred on the position.
    expect(Math.max(...ys)).toBeCloseTo(750);
    expect(Math.min(...ys)).toBeCloseTo(-750);
    expect(lines.labels[0]!.text).toBe("N");
    expect(lines.labels[0]!.position[1]).toBeGreaterThan(750);
    expect(lines.fill?.loops).toHaveLength(1);
    // Turned 90°: it points west.
    doc.transact("Rotate", (tx) => tx.update<SymbolParams>(n.id, { rotation: Math.PI / 2 }));
    const xs = [...buildSymbolLines(doc, doc.require(n.id))!.segments].filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBeCloseTo(-750);
  });

  it("scale bar: tidy length in metres with labelled divisions; on sheets it's paper size", () => {
    const { doc, plan } = setup();
    const s = doc.transact("S", (tx) => createSymbol(tx, doc, plan.id, "scaleBar", { x: 0, y: 0 }));
    const lines = buildSymbolLines(doc, s)!;
    // 50 mm × 100 = 5000 model mm → a 5 m bar in 5 divisions (3 filled).
    expect(lines.labels.map((l) => l.text)).toEqual(["0", "1", "2", "3", "4", "5 m"]);
    expect(lines.fill?.loops).toHaveLength(3);
    const sheet = doc.transact("Sheet", (tx) => createSheet(tx, doc));
    const onSheet = doc.transact("S", (tx) => createSymbol(tx, doc, sheet.id, "scaleBar", { x: 0, y: 0 }));
    expect(buildSymbolLines(doc, onSheet)!.labels.at(-1)!.text).toBe("50 mm");
  });

  it("appear in their view's drawing (sheets and PDF/DXF use it)", () => {
    const { doc, plan } = setup();
    const b = doc.transact("B", (tx) => createSymbol(tx, doc, plan.id, "breakLine", { x: 0, y: 0 }));
    const d = viewDrawing(doc, new SimpleKernel(), plan);
    expect(d.strokes.some((s) => s.kind === "annotation" && s.id === b.id)).toBe(true);
  });

  it("detail components draw their family's lines where they're placed", () => {
    const { doc, plan } = setup();
    const fam = new Document();
    applyFamilyTemplate(fam, "DetailItem", "Mark");
    fam.transact("Draw", (tx) => createDetailLine(tx, fam, views(fam)[0]!.id, { x: 0, y: 0 }, { x: 100, y: 0 }));
    const def = doc.transact("Load", (tx) => loadFamily(tx, doc, fam, "Mark"));
    const d = doc.transact("Place", (tx) => createDetailComponent(tx, doc, plan.id, def.id, { x: 1000, y: 1000 }, { rotation: Math.PI / 2 }));
    const seg = [...buildDetailComponentLines(doc, d)!.segments];
    expect(seg[0]).toBeCloseTo(1000);
    expect(seg[1]).toBeCloseTo(1000);
    expect(seg[3]).toBeCloseTo(1000);
    expect(seg[4]).toBeCloseTo(1100);
    expect(viewDrawing(doc, new SimpleKernel(), plan).strokes.some((s) => s.id === d.id)).toBe(true);
  });
});
