import { describe, expect, it } from "vitest";
import {
  Cat,
  Document,
  applyResidentialTemplate,
  createGrid,
  createReferencePlane,
  datumIntersection,
  datumLines,
  renameReferencePlane,
  type Vec2,
} from "../src/index.ts";

const p = (x: number, y: number): Vec2 => ({ x, y });

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const rp = (a: Vec2, b: Vec2, name?: string) => doc.transact("RP", (tx) => createReferencePlane(tx, doc, a, b, name));
  return { doc, ids, rp };
}

describe("reference planes", () => {
  it("can be unnamed; named ones must be unique", () => {
    const { doc, rp } = setup();
    const a = rp(p(0, 0), p(1000, 0));
    const b = rp(p(0, 500), p(1000, 500));
    expect(a.name).toBeUndefined();
    rp(p(0, 900), p(1000, 900), "Centre");
    expect(() => rp(p(0, 1000), p(1000, 1000), "Centre")).toThrow(/already in use/);
    expect(() => doc.transact("Rename", (tx) => renameReferencePlane(tx, doc, b.id, "Centre"))).toThrow(/already in use/);
    doc.transact("Rename", (tx) => renameReferencePlane(tx, doc, b.id, "Face"));
    doc.transact("Clear", (tx) => renameReferencePlane(tx, doc, b.id, ""));
    expect(doc.require(b.id).name).toBeUndefined();
  });

  it("rejects zero length and are independent of levels", () => {
    const { doc, ids, rp } = setup();
    expect(() => rp(p(1, 1), p(1, 1))).toThrow(/non-zero/);
    const r = rp(p(0, 0), p(0, 1000));
    doc.transact("Delete level", (tx) => tx.delete(ids.levels.first));
    expect(doc.has(r.id)).toBe(true);
  });

  it("are datum lines alongside grids, and intersect them", () => {
    const { doc, rp } = setup();
    const g = doc.transact("Grid", (tx) => createGrid(tx, doc, p(2000, -1000), p(2000, 5000)));
    const r = rp(p(0, 1200), p(6000, 1200));
    expect(datumLines(doc).map((d) => d.category)).toEqual([Cat.Grid, Cat.ReferencePlane]);
    expect(datumIntersection(g, r)).toEqual(p(2000, 1200));
  });
});
