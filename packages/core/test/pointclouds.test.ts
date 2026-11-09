import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createPointCloud,
  parseAsciiPoints,
  parseLas,
  pointCloudPoints,
  transformElements,
  translation,
  type PointCloud,
} from "../src/index.ts";

/** A minimal LAS 1.2 file, point format 2 (xyz + rgb), scale 0.001, offset (1000, 2000, 0). */
function lasFile(points: [number, number, number, number, number, number][]): ArrayBuffer {
  const header = 227;
  const rec = 26;
  const buf = new ArrayBuffer(header + rec * points.length);
  const dv = new DataView(buf);
  "LASF".split("").forEach((c, i) => dv.setUint8(i, c.charCodeAt(0)));
  dv.setUint8(24, 1);
  dv.setUint8(25, 2);
  dv.setUint16(94, header, true);
  dv.setUint32(96, header, true);
  dv.setUint8(104, 2);
  dv.setUint16(105, rec, true);
  dv.setUint32(107, points.length, true);
  [0.001, 0.001, 0.001].forEach((s, i) => dv.setFloat64(131 + i * 8, s, true));
  [1000, 2000, 0].forEach((o, i) => dv.setFloat64(155 + i * 8, o, true));
  points.forEach(([x, y, z, r, g, b], k) => {
    const o = header + k * rec;
    dv.setInt32(o, Math.round((x - 1000) / 0.001), true);
    dv.setInt32(o + 4, Math.round((y - 2000) / 0.001), true);
    dv.setInt32(o + 8, Math.round(z / 0.001), true);
    [r, g, b].forEach((c, i) => dv.setUint16(o + 20 + i * 2, c * 257, true));
  });
  return buf;
}

describe("point clouds", () => {
  it("reads ASCII XYZ with colour, skipping headers, and thins to the limit", () => {
    const text = ["// scan", "x y z r g b", "1 2 3 255 0 0", "2,3,4,0,255,0", "3\t4\t5\t0\t0\t255", "4 5 6 10 20 30"].join("\n");
    const r = parseAsciiPoints(text);
    expect(r.total).toBe(4);
    expect(Array.from(r.xyz.slice(0, 3))).toEqual([1, 2, 3]);
    expect(Array.from(r.rgb!.slice(3, 6))).toEqual([0, 255, 0]);
    const thin = parseAsciiPoints(text, 2);
    expect(thin.xyz.length / 3).toBe(2);
    expect(thin.total).toBe(4);
  });

  it("reads LAS positions and 16-bit colour", () => {
    const r = parseLas(lasFile([[1001.5, 2002.25, 10.125, 200, 100, 50], [1003, 2004, 11, 0, 0, 0]]));
    expect(r.total).toBe(2);
    expect(r.xyz[0]).toBeCloseTo(1001.5, 6);
    expect(r.xyz[1]).toBeCloseTo(2002.25, 6);
    expect(r.xyz[2]).toBeCloseTo(10.125, 6);
    expect(Array.from(r.rgb!.slice(0, 3))).toEqual([200, 100, 50]);
  });

  it("stores the cloud centred (or in shared coordinates) and moves it as a whole", () => {
    const doc = new Document();
    applyResidentialTemplate(doc);
    const raw = parseAsciiPoints("0 0 1\n10 4 2\n");
    const c = doc.transact("Import", (tx) => createPointCloud(tx, doc, raw, "scan", "centre"));
    const pts = pointCloudPoints(doc.require(c.id) as PointCloud).positions;
    // Centre (5, 2) m at the origin; heights m → mm.
    expect(Array.from(pts)).toEqual([-5000, -2000, 1000, 5000, 2000, 2000]);
    doc.transact("Move", (tx) => transformElements(tx, doc, [c.id], translation({ x: 100, y: -50 })));
    const moved = pointCloudPoints(doc.require(c.id) as PointCloud).positions;
    expect(moved[0]).toBe(-4900);
    expect(moved[1]).toBe(-2050);
    expect(() => doc.transact("Rotate", (tx) => transformElements(tx, doc, [c.id], { xx: 0, xy: -1, yx: 1, yy: 0, tx: 0, ty: 0 }))).toThrow(/only be moved/);
  });
});
