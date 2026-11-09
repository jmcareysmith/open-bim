import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  beamCheck,
  createBeam,
  createLoad,
  createRebar,
  ensureStructuralTypes,
  sectionProperties,
  type StructuralSectionParams,
  type Vec2,
} from "../src/index.ts";

const p = (x: number, y: number): Vec2 => ({ x, y });

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const types = doc.transact("T", (tx) => ensureStructuralTypes(tx, doc));
  const byName = (n: string) => types.find((id) => doc.require(id).name === n)!;
  return { doc, ids, byName };
}

describe("loads and beam checks (provisional)", () => {
  it("steel beam: governing ULS moment and shear, capacity and SLS deflection", () => {
    const { doc, ids, byName } = setup();
    const t = byName("Steel 200UB25");
    const b = doc.transact("B", (tx) => createBeam(tx, doc, t, ids.levels.first, p(0, 0), p(6000, 0)));
    doc.transact("L", (tx) => {
      createLoad(tx, doc, b.id, { case: "G", kind: "line", value: 2 });
      createLoad(tx, doc, b.id, { case: "Q", kind: "line", value: 3 });
    });
    const c = beamCheck(doc, b.id)!;
    const s = doc.require(t).params as StructuralSectionParams;
    const { A, I } = sectionProperties(s);
    const sw = (A / 1e6) * 77;
    expect(c.material).toBe("steel");
    expect(c.combination).toBe("1.2G + 1.5Q");
    const w = 1.2 * (sw + 2) + 1.5 * 3;
    expect(c.M).toBeCloseTo((w * 36) / 8, 6);
    expect(c.V).toBeCloseTo((w * 6) / 2, 6);
    expect(c.phiM).toBeCloseTo((0.9 * 300 * (I / (s.d / 2))) / 1e6, 6);
    const ws = sw + 2 + 0.7 * 3;
    expect(c.deflection).toBeCloseTo((5 * ws * 6000 ** 4) / (384 * 200_000 * I), 6);
    expect(c.limit).toBe(24);
  });

  it("point loads add Pab/L; overloads fail", () => {
    const { doc, ids, byName } = setup();
    const b = doc.transact("B", (tx) => createBeam(tx, doc, byName("Timber 190x45 SG8"), ids.levels.first, p(0, 0), p(4000, 0)));
    doc.transact("L", (tx) => createLoad(tx, doc, b.id, { case: "Q", kind: "point", value: 10, at: 1000 }));
    const c = beamCheck(doc, b.id)!;
    expect(c.material).toBe("timber");
    // 1.5 × 10 kN at 1 m of 4 m: 15 × 1 × 3 / 4 = 11.25 kNm, plus self-weight.
    expect(c.M).toBeGreaterThan(11.25);
    expect(c.M).toBeLessThan(11.4);
    expect(c.ok).toBe(false);
    expect(() => doc.transact("L", (tx) => createLoad(tx, doc, b.id, { case: "G", kind: "line", value: -1 }))).toThrow();
  });

  it("concrete beams use their cage's bottom bars", () => {
    const { doc, ids } = setup();
    const t = doc.transact("T", (tx) => tx.create<StructuralSectionParams>("StructuralType", { shape: "rect", d: 500, b: 300, tf: 0, tw: 0 }, { name: "Concrete Beam 300x500" }).id);
    const b = doc.transact("B", (tx) => createBeam(tx, doc, t, ids.levels.first, p(0, 0), p(5000, 0)));
    expect(beamCheck(doc, b.id)!.phiM).toBeNull();
    doc.transact("R", (tx) => createRebar(tx, doc, b.id, { bar: "HD20", count: 6 }));
    const c = beamCheck(doc, b.id)!;
    // 3 × HD20 bottom = 942 mm²; d = 500 − 40 − 10 − 10 = 440.
    const As = 3 * Math.PI * 100;
    const a = (As * 500) / (0.85 * 30 * 300);
    expect(c.phiM).toBeCloseTo((0.85 * As * 500 * (440 - a / 2)) / 1e6, 3);
  });
});
