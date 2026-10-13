import { describe, expect, it } from "vitest";
import { extrudePolygon, planarFace, roofFromFace, wallFromFace, type MeshData } from "../src/index.ts";

/** Index of the first triangle whose normal is close to `n`. */
function triFacing(m: MeshData, n: [number, number, number]): number {
  for (let t = 0; t < m.indices.length / 3; t++) {
    const v = [0, 1, 2].map((k) => {
      const i = m.indices[t * 3 + k]!;
      return [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!];
    });
    const u = v[1]!.map((x, j) => x - v[0]![j]!);
    const w = v[2]!.map((x, j) => x - v[0]![j]!);
    const c = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    const l = Math.hypot(...c);
    if (c[0]! / l * n[0] + c[1]! / l * n[1] + c[2]! / l * n[2] > 0.99) return t;
  }
  return -1;
}

describe("model by face", () => {
  const box = extrudePolygon(
    [
      { x: 0, y: 0 },
      { x: 10000, y: 0 },
      { x: 10000, y: 6000 },
      { x: 0, y: 6000 },
    ],
    [],
    0,
    3000,
  );

  it("finds a face's outline from one triangle", () => {
    const f = planarFace(box, triFacing(box, [1, 0, 0]))!;
    expect(f.normal[0]).toBeCloseTo(1);
    expect(f.loop).toHaveLength(4);
  });

  it("makes a wall on a vertical face, its exterior face on the mass face", () => {
    const w = wallFromFace(planarFace(box, triFacing(box, [1, 0, 0]))!, 200)!;
    expect(w.start.x).toBeCloseTo(9900);
    expect(w.end.x).toBeCloseTo(9900);
    // Exterior (the wall's left) faces +x: the wall runs −y.
    expect(w.start.y).toBeCloseTo(6000);
    expect(w.end.y).toBeCloseTo(0);
    expect([w.bottom, w.top]).toEqual([0, 3000]);
    expect(wallFromFace(planarFace(box, triFacing(box, [0, 0, 1]))!, 200)).toBeNull();
  });

  it("makes a flat roof on a level top and a pitched one on a sloped face", () => {
    const flat = roofFromFace(planarFace(box, triFacing(box, [0, 0, 1]))!)!;
    expect(flat.eave).toBe(3000);
    expect(flat.slopes.every((s) => s === null)).toBe(true);
    // A lean-to: 3 m at y = 0 rising to 5 m at y = 6000.
    const prism = extrudePolygon(
      [
        { x: 0, y: 0 },
        { x: 6000, y: 0 },
        { x: 6000, y: 5000 },
        { x: 0, y: 3000 },
      ],
      [],
      0,
      10000,
    );
    // The prism lies on its side (profile in XY, height along Z): rotate so the profile is in YZ.
    const p = prism.positions;
    for (let i = 0; i < p.length; i += 3) [p[i], p[i + 1], p[i + 2]] = [p[i + 2]!, p[i]!, p[i + 1]!];
    const n = prism.normals;
    for (let i = 0; i < n.length; i += 3) [n[i], n[i + 1], n[i + 2]] = [n[i + 2]!, n[i]!, n[i + 1]!];
    const slope = Math.atan2(2000, 6000);
    const up: [number, number, number] = [0, -Math.sin(slope), Math.cos(slope)];
    const roof = roofFromFace(planarFace(prism, triFacing(prism, up))!)!;
    expect(roof.eave).toBeCloseTo(3000);
    expect(roof.slopes.filter((s) => s !== null)).toHaveLength(1);
    expect(roof.slopes.find((s) => s !== null)!).toBeCloseTo(slope);
  });
});
