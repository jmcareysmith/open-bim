import { describe, expect, it } from "vitest";
import {
  Document,
  PAPER_SIZES,
  applyResidentialTemplate,
  createSection,
  createSheet,
  createWall,
  floorPlanFor,
  placeView,
  type ProjectSettingsParams,
  type Vec2,
  type ViewParams,
  projectSettings,
} from "@open-bim/core";
import { SimpleKernel, sheetDrawing, viewDrawing, writePdf } from "../src/index.ts";

const p = (x: number, y: number): Vec2 => ({ x, y });

function model() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const k = new SimpleKernel();
  doc.transact("Walls", (tx) => {
    const pts = [p(0, 0), p(0, 6000), p(8000, 6000), p(8000, 0)];
    pts.forEach((a, i) => createWall(tx, ids.wallTypes.exterior, a, pts[(i + 1) % 4]!, ids.levels.ground, { topLevelId: ids.levels.first }));
  });
  return { doc, ids, k };
}

const strokeLength = (segs: number[]) => {
  let s = 0;
  for (let i = 0; i < segs.length; i += 4) s += Math.hypot(segs[i + 2]! - segs[i]!, segs[i + 3]! - segs[i + 1]!);
  return s;
};

describe("view drawings", () => {
  it("a plan has cut lines and poche for walls, in model mm", () => {
    const { doc, ids, k } = model();
    const d = viewDrawing(doc, k, floorPlanFor(doc, ids.levels.ground)!);
    const cut = d.strokes.filter((s) => s.kind === "cut");
    expect(cut.length).toBe(4);
    expect(d.fills.filter((f) => f.kind === "poche").length).toBe(4);
    expect(d.bounds.max.x - d.bounds.min.x).toBeGreaterThan(8000);
  });

  it("medium detail adds layer hatching; V/G hiding removes the walls", () => {
    const { doc, ids, k } = model();
    const plan = floorPlanFor(doc, ids.levels.ground)!;
    doc.transact("Medium", (tx) => tx.update<ViewParams>(plan.id, { detailLevel: "medium" }));
    const med = viewDrawing(doc, k, doc.require<ViewParams>(plan.id) as never);
    expect(med.strokes.some((s) => s.kind === "hatch" && s.segments.length > 0)).toBe(true);
    doc.transact("Hide", (tx) => tx.update<ViewParams>(plan.id, { hiddenCategories: ["Wall"] }));
    const hidden = viewDrawing(doc, k, doc.require<ViewParams>(plan.id) as never);
    expect(hidden.strokes.filter((s) => s.kind === "cut")).toEqual([]);
  });

  it("a section has cut walls and level annotations", () => {
    const { doc, k } = model();
    const s = doc.transact("S", (tx) => createSection(tx, doc, p(-500, 3000), p(8500, 3000)));
    const d = viewDrawing(doc, k, s);
    expect(d.strokes.filter((x) => x.kind === "cut").length).toBe(2); // east and west walls
    expect(d.texts.map((t) => t.text)).toContain("Ground Floor  0");
  });
});

describe("sheets", () => {
  it("place views at their scale inside the border, with a title block", () => {
    const { doc, ids, k } = model();
    doc.transact("Info", (tx) =>
      tx.update<ProjectSettingsParams>(projectSettings(doc)!.id, { info: { name: "Kauri St", number: "24-017", client: "M Smith", address: "" } }),
    );
    const sheet = doc.transact("S", (tx) => createSheet(tx, doc, { name: "Ground Floor Plan", size: "A3" }));
    const plan = floorPlanFor(doc, ids.levels.ground)!;
    doc.transact("Place", (tx) => placeView(tx, doc, sheet.id, plan.id, p(170, 150)));
    const d = sheetDrawing(doc, k, sheet);
    expect([d.width, d.height]).toEqual([420, 297]);
    const texts = d.texts.map((t) => t.text);
    expect(texts).toEqual(expect.arrayContaining(["A101", "Ground Floor Plan", "Kauri St", "24-017", "1:100", "GROUND FLOOR"]));
    // At 1:100 an 8 m wall is 80 mm on paper; the viewport is centred where we put it.
    const vp = d.viewports[0]!;
    expect((vp.min.x + vp.max.x) / 2).toBeCloseTo(170, 0);
    const wallCut = d.strokes.filter((s) => s.kind === "cut" && s.id === vp.id).reduce((sum, s) => sum + strokeLength(s.segments), 0);
    expect(wallCut).toBeGreaterThan(2 * (80 + 60) * 0.9);
    expect(wallCut).toBeLessThan(2 * (80 + 60) * 2.2);
  });
});

describe("pdf", () => {
  it("writes a valid PDF with one page per sheet and a correct xref table", () => {
    const { doc, ids, k } = model();
    const a = doc.transact("S", (tx) => createSheet(tx, doc, { name: "Plans" }));
    const b = doc.transact("S", (tx) => createSheet(tx, doc, { name: "Sections \u2013 1\u00b0 (draft)", size: "A1" }));
    doc.transact("Place", (tx) => placeView(tx, doc, a.id, floorPlanFor(doc, ids.levels.ground)!.id));
    const bytes = writePdf([a, b].map((s) => ({ ...PAPER_SIZES[s.params.size], drawing: sheetDrawing(doc, k, s) })));
    const text = Array.from(bytes, (c) => String.fromCharCode(c)).join("");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/Count 2");
    expect(text).toContain("/MediaBox [0 0 1190.551 841.89]"); // A3 landscape in points
    expect(text).toContain("(Sections \\226 1\\260 \\(draft\\))");
    // Every xref offset points at the start of its object.
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)![1]);
    const entries = text.slice(xrefAt).split("\n").slice(3).filter((l: string) => l.endsWith(" n "));
    entries.forEach((e: string, i: number) => expect(text.slice(Number(e.slice(0, 10)), Number(e.slice(0, 10)) + 10)).toMatch(new RegExp(`^${i + 1} 0 obj`)));
  });
});
