import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  beamCheck,
  columnCheck,
  createColumn,
  createFloor,
  ensureFoundationSlabType,
  sectionMaterial,
  weakAxisI,
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
  it("floor area loads reach beams over their tributary width", () => {
    const { doc, ids, byName } = setup();
    const t = byName("Steel 200UB25");
    const slab = doc.transact("T", (tx) => ensureFoundationSlabType(tx, doc));
    // A 6 m x 9 m floor on First Floor, beams along x at y = 0, 3000, 6000, 9000 (3 m apart).
    const f = doc.transact("F", (tx) => createFloor(tx, slab, ids.levels.first, [p(0, 0), p(6000, 0), p(6000, 9000), p(0, 9000)]));
    const beams = doc.transact("B", (tx) => [0, 3000, 6000, 9000].map((y) => createBeam(tx, doc, t, ids.levels.first, p(0, y), p(6000, y))));
    doc.transact("Q", (tx) => createLoad(tx, doc, f.id, { case: "Q", kind: "area", value: 2 }));
    // Inner beams: 1.5 m each side; edge beams: 1.5 m one side (the floor stops at them).
    expect(beamCheck(doc, beams[1]!.id)!.tributary).toBeCloseTo(3000);
    expect(beamCheck(doc, beams[0]!.id)!.tributary).toBeCloseTo(1500);
    const inner = beamCheck(doc, beams[1]!.id)!;
    const s = doc.require(t).params as StructuralSectionParams;
    const sw = (sectionProperties(s).A / 1e6) * 77;
    expect(inner.M).toBeCloseTo(((1.2 * sw + 1.5 * 2 * 3) * 36) / 8, 6);
    // A set width wins.
    doc.transact("W", (tx) => tx.update(beams[1]!.id, { tributary: 1000 }));
    expect(beamCheck(doc, beams[1]!.id)!.tributary).toBe(1000);
    expect(() => doc.transact("L", (tx) => createLoad(tx, doc, beams[0]!.id, { case: "Q", kind: "area", value: 2 }))).toThrow(/floors/);
  });

  it("columns carry the reactions of beams framing into their tops, with weak-axis buckling", () => {
    const { doc, ids, byName } = setup();
    const shs = byName("Steel SHS 100x100x4");
    const ub = byName("Steel 200UB25");
    const [c1] = doc.transact("C", (tx) => [createColumn(tx, doc, shs, ids.levels.ground, ids.levels.first, p(0, 0)), createColumn(tx, doc, shs, ids.levels.ground, ids.levels.first, p(6000, 0))]);
    const b = doc.transact("B", (tx) => createBeam(tx, doc, ub, ids.levels.first, p(0, 0), p(6000, 0)));
    doc.transact("L", (tx) => createLoad(tx, doc, b.id, { case: "Q", kind: "point", value: 20, at: 1500 }));
    const c = columnCheck(doc, c1!.id)!;
    const sec = doc.require(shs).params as StructuralSectionParams;
    const colSw = (sectionProperties(sec).A / 1e6) * 77 * 2.7;
    const beamSw = (sectionProperties(doc.require(ub).params as StructuralSectionParams).A / 1e6) * 77;
    // 1.2G + 1.5Q: half the beam's self-weight, 3/4 of the point load (it's 1.5 m from this end).
    expect(c.combination).toBe("1.2G + 1.5Q");
    expect(c.N).toBeCloseTo(1.2 * (colSw + (beamSw * 6) / 2) + 1.5 * 20 * 0.75, 6);
    const A = sectionProperties(sec).A;
    const Ncr = (Math.PI ** 2 * 200_000 * weakAxisI(sec)) / 2700 ** 2;
    expect(c.phiN).toBeCloseTo(0.9 / (1 / (A * 300) + 1 / Ncr) / 1000, 6);
    expect(c.ok).toBe(true);
    expect(sectionMaterial("Timber 190x45 SG8", { shape: "rect", d: 190, b: 45, tf: 0, tw: 0 })).toBe("timber");
  });
});
