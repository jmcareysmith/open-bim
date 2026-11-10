import { describe, expect, it } from "vitest";
import { Document, applyFamilyTemplate, applyResidentialTemplate, createDetailComponent, createDetailLine, createSheet, createSymbol, ensureProjectSettings, floorPlanFor, loadFamily, views, type ProjectSettingsParams, type SymbolParams } from "@open-bim/core";
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
  it("coordinate points label their spot with NZTM eastings, northings and height", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    doc.transact("Location", (tx) => {
      const st = ensureProjectSettings(tx, doc);
      tx.update<ProjectSettingsParams>(st.id, { location: { epsg: 2193, eastings: 1748735, northings: 5428000, height: 12.5, rotation: 0 } });
    });
    const plan = floorPlanFor(doc, ids.levels.first)!;
    const sym = doc.transact("C", (tx) => createSymbol(tx, doc, plan.id, "coordinates", { x: 1000, y: 2000 }));
    const texts = new SimpleKernel().buildLines(doc, sym, 100)!.labels.map((l) => l.text);
    // First Floor is at 2700: RL 12.5 + 2.7.
    expect(texts).toEqual(["E 1748736.000", "N 5428002.000", "RL 15.200"]);
  });
  it("plans can show the Project Base Point and Survey Point with their map coordinates", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    doc.transact("Location", (tx) => {
      const st = ensureProjectSettings(tx, doc);
      tx.update<ProjectSettingsParams>(st.id, { location: { epsg: 2193, eastings: 1748735, northings: 5428000, height: 12.5, rotation: 0, surveyPoint: { x: 10000, y: -5000 } } });
    });
    const plan = floorPlanFor(doc, ids.levels.ground)!;
    const k = new SimpleKernel();
    expect(viewDrawing(doc, k, plan).texts.some((t) => t.text === "Project Base Point")).toBe(false);
    doc.transact("Show", (tx) => tx.update(plan.id, { showBasePoints: true }));
    const texts = viewDrawing(doc, k, doc.require(plan.id) as never).texts.map((t) => t.text);
    expect(texts).toContain("Project Base Point");
    expect(texts).toContain("Survey Point");
    expect(texts).toContain("E 1748735.000");
    // The survey mark 10 m east, 5 m south of the origin.
    expect(texts).toContain("E 1748745.000");
    expect(texts).toContain("N 5427995.000");
  });
});
