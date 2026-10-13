import earcut from "earcut";
import {
  delaunay,
  insidePolygon,
  padBottom,
  surfaceHeightAt,
  toposolidSurface,
  type BuildingPad,
  type Document,
  type Element,
  type MaterialParams,
  type Subregion,
  type Toposolid,
  formatBearing,
  propertyArea,
  propertyLegs,
  type PropertyLine,
} from "@open-bim/core";
import type { LineData } from "./datums.ts";
import { extrudePolygon, type MeshData } from "./mesh.ts";

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
    // Label every fifth contour (the index contours) at its first segment, or all of them, or none.
    const mode = t.params.contourLabels ?? "index";
    if (mode === "all" || (mode === "index" && Math.round(c.z / t.params.contourInterval) % 5 === 0)) {
      labels.push({ text: `${(c.z / 1000).toFixed(1)}`, position: [c.segments[0]!, c.segments[1]!, 0], size: 180 });
    }
  }
  return { segments: new Float32Array(seg), labels, planOnly: true };
}

/** A building pad: a slab of its thickness under its top. */
export function buildBuildingPad(doc: Document, el: Element): MeshData | null {
  const pad = el as BuildingPad;
  const bottom = padBottom(doc, pad);
  return extrudePolygon(pad.params.boundary, [], bottom, bottom + pad.params.thickness);
}

/** Subregion: its outline draped on the toposolid's (graded) surface, just above it. */
export function buildSubregion(doc: Document, el: Element): MeshData | null {
  const sub = el as Subregion;
  const topo = doc.get(sub.params.toposolidId) as Toposolid | undefined;
  if (!topo) return null;
  const surface = toposolidSurface(doc, topo);
  const b = sub.params.boundary;
  // Sample the surface on a grid inside the outline so the patch follows the ground.
  const xs = b.map((q) => q.x);
  const ys = b.map((q) => q.y);
  const step = Math.max(500, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 30);
  const pts: { x: number; y: number }[] = [...b];
  for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) for (let y = Math.min(...ys) + step / 2; y < Math.max(...ys); y += step) if (insidePolygon({ x, y }, b)) pts.push({ x, y });
  const z = (p: { x: number; y: number }) => (surfaceHeightAt(surface, p) ?? 0) + 15;
  const tris = delaunay(pts).filter(([i, j, k]) => insidePolygon({ x: (pts[i]!.x + pts[j]!.x + pts[k]!.x) / 3, y: (pts[i]!.y + pts[j]!.y + pts[k]!.y) / 3 }, b));
  if (!tris.length) return null;
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (const [i, j, k] of tris) {
    let [A, B, C] = [pts[i]!, pts[j]!, pts[k]!];
    if ((B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x) < 0) [B, C] = [C, B];
    const base = pos.length / 3;
    for (const p of [A, B, C]) {
      pos.push(p.x, p.y, z(p));
      nor.push(0, 0, 1);
    }
    idx.push(base, base + 1, base + 2);
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), indices: new Uint32Array(idx) };
}

/** Subregions in plan: their outline, filled with the material's colour. */
export function buildSubregionLines(doc: Document, el: Element): LineData | null {
  const sub = el as Subregion;
  const b = sub.params.boundary;
  const seg: number[] = [];
  b.forEach((p, i) => seg.push(p.x, p.y, 0, b[(i + 1) % b.length]!.x, b[(i + 1) % b.length]!.y, 0));
  const m = sub.params.materialId ? doc.get<MaterialParams>(sub.params.materialId) : undefined;
  return { segments: new Float32Array(seg), labels: [], planOnly: true, fill: { loops: [b], color: m?.params.color ?? 0x9cc28a } };
}

/**
 * Property line in plan: a dashed boundary, each leg labelled with its bearing and distance (as on
 * a survey plan), and the area at the middle.
 */
export function buildPropertyLines(doc: Document, el: Element): LineData | null {
  const pl = el as PropertyLine;
  const pts = pl.params.points;
  if (pts.length < 3) return null;
  const seg: number[] = [];
  const labels: LineData["labels"] = [];
  const legs = propertyLegs(doc, pl);
  const cx = pts.reduce((s2, p) => s2 + p.x, 0) / pts.length;
  const cy = pts.reduce((s2, p) => s2 + p.y, 0) / pts.length;
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length]!;
    seg.push(a.x, a.y, 0, b.x, b.y, 0);
    // Label outside the boundary, off the leg's middle.
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = -(b.y - a.y) / L;
    let ny = (b.x - a.x) / L;
    if ((mx - cx) * nx + (my - cy) * ny < 0) [nx, ny] = [-nx, -ny];
    const leg = legs[i]!;
    labels.push({ text: `${formatBearing(leg.bearing)}  ${(leg.distance / 1000).toFixed(3)}`, position: [mx + nx * 600, my + ny * 600, 0], size: 250 });
  });
  labels.push({ text: `${(propertyArea(pl) / 1e6).toFixed(1)} m²`, position: [cx, cy, 0], size: 350 });
  return { segments: new Float32Array(seg), labels, dashed: true, planOnly: true };
}
