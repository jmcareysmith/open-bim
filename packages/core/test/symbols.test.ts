import { describe, expect, it } from "vitest";
import {
  Cat,
  DEFAULT_LOCATION,
  Document,
  annotationView,
  applyResidentialTemplate,
  createSheet,
  createSymbol,
  dragGrip,
  ensureProjectSettings,
  rotationAbout,
  scaleBarLayout,
  symbolAngle,
  symbolScale,
  transformElements,
  views,
  type AnnotationSymbol,
  type SymbolParams,
} from "../src/index.ts";

function setup() {
  const doc = new Document();
  applyResidentialTemplate(doc);
  const plan = views(doc).find((v) => v.params.kind === "floorPlan")!;
  return { doc, plan };
}

describe("annotation symbols", () => {
  it("belong to a view or sheet, sized on paper", () => {
    const { doc, plan } = setup();
    const n = doc.transact("Symbol", (tx) => createSymbol(tx, doc, plan.id, "northArrow", { x: 1000, y: 2000 }));
    expect(n.params).toMatchObject({ kind: "northArrow", size: 15, rotation: 0, trueNorth: false });
    expect(annotationView(n)).toBe(plan.id);
    expect(symbolScale(doc, n)).toBe(plan.params.scale);
    const sheet = doc.transact("Sheet", (tx) => createSheet(tx, doc));
    const s = doc.transact("Symbol", (tx) => createSymbol(tx, doc, sheet.id, "scaleBar", { x: 10, y: 10 }));
    expect(symbolScale(doc, s)).toBe(1);
    const v3d = views(doc).find((v) => v.params.kind === "3d")!;
    expect(() => doc.transact("Symbol", (tx) => createSymbol(tx, doc, v3d.id, "breakLine", { x: 0, y: 0 }))).toThrow(/3D/);
    // Deleting the view deletes its symbols.
    doc.transact("Delete", (tx) => tx.delete(plan.id));
    expect(doc.has(n.id)).toBe(false);
  });

  it("north arrows point up plus their rotation, or to true north", () => {
    const { doc, plan } = setup();
    const n = doc.transact("Symbol", (tx) => createSymbol(tx, doc, plan.id, "northArrow", { x: 0, y: 0 }, { rotation: 0.2 })) as AnnotationSymbol;
    expect(symbolAngle(doc, n)).toBeCloseTo(Math.PI / 2 + 0.2);
    doc.transact("Location", (tx) => {
      const s = ensureProjectSettings(tx, doc);
      tx.update(s.id, { location: { ...DEFAULT_LOCATION, rotation: 0.3 } });
      tx.update<SymbolParams>(n.id, { trueNorth: true });
    });
    expect(symbolAngle(doc, doc.require(n.id) as AnnotationSymbol)).toBeCloseTo(Math.PI / 2 - 0.3);
  });

  it("move with grips and rotate with the Rotate tool", () => {
    const { doc, plan } = setup();
    const b = doc.transact("Symbol", (tx) => createSymbol(tx, doc, plan.id, "breakLine", { x: 100, y: 0 }));
    doc.transact("Rotate", (tx) => transformElements(tx, doc, [b.id], rotationAbout({ x: 0, y: 0 }, Math.PI / 2)));
    const p = doc.require<SymbolParams>(b.id).params;
    expect(p.position.x).toBeCloseTo(0);
    expect(p.position.y).toBeCloseTo(100);
    expect(p.rotation).toBeCloseTo(Math.PI / 2);
    doc.transact("Drag", (tx) => dragGrip(tx, doc, b.id, "move", { x: 500, y: 500 }));
    expect(doc.require<SymbolParams>(b.id).params.position).toEqual({ x: 500, y: 500 });
    expect(doc.byCategory(Cat.Symbol)).toHaveLength(1);
  });

  it("scale bars pick a tidy length and divisions", () => {
    expect(scaleBarLayout(5000)).toEqual({ length: 5000, divisions: 5 });
    expect(scaleBarLayout(4300)).toEqual({ length: 2000, divisions: 4 });
    expect(scaleBarLayout(1500)).toEqual({ length: 1000, divisions: 5 });
    expect(scaleBarLayout(0)).toEqual({ length: 0, divisions: 1 });
  });
});
