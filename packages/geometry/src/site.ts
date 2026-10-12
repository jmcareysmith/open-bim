import earcut from "earcut";
import { toposolidSurface, type Document, type Element, type Toposolid } from "@open-bim/core";
import type { LineData } from "./datums.ts";
import type { MeshData } from "./mesh.ts";

// Toposolid geometry: the triangulated top, vertical sides down the boundary, and a flat bottom
// `thickness` below the lowest point. Plan symbol: contours at the interval (every fifth heavier
// in Revit; here labelled with its height).

type P3 = { x: number; y: number; z: number };

export function buildToposolid(doc: Document, el: Element): MeshData | null {
  const t = el as Toposolid;
  const { vertices: v, triangles } = toposolidSurface(doc, t);
  if (!triangles.length) return null;
  const nb = t.params.boundary.length;
  const zMin = Math.min(...v.map((q) => q.z));
  const bottom = zMin - t.params.thickness;
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const tri = (a: P3, b: P3, c: P3) => {
    const u = [b.x - a.x, b.y - a.y, b.z - a.z];
    const w = [c.x - a.x, c.y - a.y, c.z - a.z];
    const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    const l = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
    const base = pos.length / 3;
    for (const p of [a, b, c]) {
      pos.push(p.x, p.y, p.z);
      nor.push(n[0]! / l, n[1]! / l, n[2]! / l);
    }
    idx.push(base, base + 1, base + 2);
  };
  // Top: counter-clockwise in plan so normals face up.
  for (const [a, b, c] of triangles) {
    const A = v[a]!;
    const B = v[b]!;
    const C = v[c]!;
    const ccw = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x) > 0;
    if (ccw) tri(A, B, C);
    else tri(A, C, B);
  }
  // Sides and bottom follow the boundary's winding.
  const ring = v.slice(0, nb);
  const area = ring.reduce((s, p, i) => s + p.x * ring[(i + 1) % nb]!.y - ring[(i + 1) % nb]!.x * p.y, 0);
  const loop = area > 0 ? ring : [...ring].reverse();
  for (let i = 0; i < nb; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % nb]!;
    const a0 = { x: a.x, y: a.y, z: bottom };
    const b0 = { x: b.x, y: b.y, z: bottom };
    tri(a0, b0, b);
    tri(a0, b, a);
  }
  const flat = earcut(loop.flatMap((p) => [p.x, p.y]));
  for (let i = 0; i < flat.length; i += 3) {
    const [a, b, c] = [loop[flat[i]!]!, loop[flat[i + 1]!]!, loop[flat[i + 2]!]!];
    const ccw = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 0;
    const [p, q, r] = ccw ? [a, c, b] : [a, b, c];
    tri({ x: p.x, y: p.y, z: bottom }, { x: q.x, y: q.y, z: bottom }, { x: r.x, y: r.y, z: bottom });
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), indices: new Uint32Array(idx) };
}

/** Contour segments at every multiple of `interval` (absolute heights), from the top triangles. */
export function contours(vertices: P3[], triangles: [number, number, number][], interval: number): { z: number; segments: number[] }[] {
  if (interval <= 0 || !triangles.length) return [];
  const zs = vertices.map((p) => p.z);
  const lo = Math.ceil(Math.min(...zs) / interval);
  const hi = Math.floor(Math.max(...zs) / interval);
  const out: { z: number; segments: number[] }[] = [];
  for (let k = lo; k <= hi && k - lo < 2000; k++) {
    const z = k * interval;
    const seg: number[] = [];
    for (const t of triangles) {
      const pts: { x: number; y: number }[] = [];
      for (let e = 0; e < 3; e++) {
        const a = vertices[t[e]!]!;
        const b = vertices[t[(e + 1) % 3]!]!;
        if ((a.z < z && b.z >= z) || (b.z < z && a.z >= z)) {
          const f = (z - a.z) / (b.z - a.z);
          pts.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
        }
      }
      if (pts.length === 2) seg.push(pts[0]!.x, pts[0]!.y, pts[1]!.x, pts[1]!.y);
    }
    if (seg.length) out.push({ z, segments: seg });
  }
  return out;
}

export function buildToposolidLines(doc: Document, el: Element): LineData | null {
  const t = el as Toposolid;
  const { vertices, triangles } = toposolidSurface(doc, t);
  const seg: number[] = [];
  const labels: LineData["labels"] = [];
  const b = t.params.boundary;
  b.forEach((p, i) => {
    const q = b[(i + 1) % b.length]!;
    seg.push(p.x, p.y, 0, q.x, q.y, 0);
  });
  for (const c of contours(vertices, triangles, t.params.contourInterval)) {
    for (let i = 0; i < c.segments.length; i += 4) seg.push(c.segments[i]!, c.segments[i + 1]!, 0, c.segments[i + 2]!, c.segments[i + 3]!, 0);
    // Label every fifth contour (the index contours) at its first segment.
    if (Math.round(c.z / t.params.contourInterval) % 5 === 0) {
      labels.push({ text: `${(c.z / 1000).toFixed(1)}`, position: [c.segments[0]!, c.segments[1]!, 0], size: 180 });
    }
  }
  return { segments: new Float32Array(seg), labels, planOnly: true };
}
