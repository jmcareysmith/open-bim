import { describe, expect, it } from "vitest";
import { Document, createLevel, createToposolid, delaunay, ensureProjectSettings, parseSurveyCsv, siteHeight, toposolidSurface } from "@open-bim/core";
import { SimpleKernel, boundingBox, buildToposolidLines, contours, meshVolume } from "../src/index.ts";

const square = [
  { x: 0, y: 0 },
  { x: 20000, y: 0 },
  { x: 20000, y: 20000 },
  { x: 0, y: 20000 },
];

describe("toposolids", () => {
  it("triangulate spot heights into a closed solid", () => {
    expect(delaunay([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }])).toHaveLength(2);
    const doc = new Document();
    const lv = doc.transact("L", (tx) => createLevel(tx, "Ground", 0));
    // A slope rising 2 m to the north, with a mound in the middle.
    const pts = [
      { x: 0, y: 0, z: 0 },
      { x: 20000, y: 0, z: 0 },
      { x: 20000, y: 20000, z: 2000 },
      { x: 0, y: 20000, z: 2000 },
      { x: 10000, y: 10000, z: 2500 },
    ];
    const t = doc.transact("T", (tx) => createToposolid(tx, doc, lv.id, square, pts, { thickness: 500, contourInterval: 500 }));
    const s = toposolidSurface(doc, t);
    expect(s.triangles.length).toBe(4);
    const m = new SimpleKernel().build(doc, t)!;
    expect(meshVolume(m)).toBeGreaterThan(0);
    const bb = boundingBox(m);
    expect(bb.max[2]).toBeCloseTo(2500);
    expect(bb.min[2]).toBeCloseTo(-500);
    // Contours at 0.5, 1.0 … 2.5 m.
    const c = contours(s.vertices, s.triangles, 500);
    expect(c.map((x) => x.z)).toEqual([500, 1000, 1500, 2000, 2500]);
    expect(buildToposolidLines(doc, t)!.labels.map((l) => l.text)).toContain("2.5");
    expect(siteHeight(pts, { x: 10000, y: 10000 })).toBe(2500);
  });

  it("imports survey points in NZTM metres through shared coordinates", () => {
    const doc = new Document();
    const lv = doc.transact("L", (tx) => {
      const s = ensureProjectSettings(tx, doc);
      tx.update(s.id, { location: { epsg: 2193, eastings: 1756000, northings: 5920000, height: 10, rotation: 0 } });
      return createLevel(tx, "Ground", 0);
    });
    const csv = "Point,E,N,RL\n1,1756005.0,5920002.5,10.75\n# comment\n2,1756010,5920000,11\n";
    expect(parseSurveyCsv(doc, csv, lv.id)).toEqual([
      { x: 5000, y: 2500, z: 750 },
      { x: 10000, y: 0, z: 1000 },
    ]);
  });
});
