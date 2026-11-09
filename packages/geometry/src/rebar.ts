import { rebarBars, type Document, type Element, type Rebar } from "@open-bim/core";
import type { MeshData } from "./mesh.ts";

// Rebar as solids: each straight run of a bar is a closed hexagonal tube of its diameter (enough
// to read as a round bar in 3D and to cut as a small circle in sections).

const SIDES = 6;

export function buildRebar(doc: Document, el: Element): MeshData | null {
  const bars = rebarBars(doc, el as Rebar);
  if (!bars.length) return null;
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (const b of bars) {
    const n = b.closed ? b.points.length : b.points.length - 1;
    for (let i = 0; i < n; i++) tube(b.points[i]!, b.points[(i + 1) % b.points.length]!, b.diameter / 2, pos, nor, idx);
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), indices: new Uint32Array(idx) };
}

type V3 = [number, number, number];

function tube(a: V3, b: V3, r: number, pos: number[], nor: number[], idx: number[]): void {
  const ax: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(...ax);
  if (len < 1e-6) return;
  const t: V3 = [ax[0] / len, ax[1] / len, ax[2] / len];
  // Two unit vectors square to the axis.
  const ref: V3 = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm(cross(ref, t));
  const v = cross(t, u);
  const ring = (c: V3) => Array.from({ length: SIDES }, (_, k) => {
    const th = (2 * Math.PI * k) / SIDES;
    const d: V3 = [u[0] * Math.cos(th) + v[0] * Math.sin(th), u[1] * Math.cos(th) + v[1] * Math.sin(th), u[2] * Math.cos(th) + v[2] * Math.sin(th)];
    return { p: [c[0] + d[0] * r, c[1] + d[1] * r, c[2] + d[2] * r] as V3, d };
  });
  const ra = ring(a);
  const rb = ring(b);
  // Sides: smooth normals (outward).
  const base = pos.length / 3;
  for (const q of [...ra, ...rb]) {
    pos.push(...q.p);
    nor.push(...q.d);
  }
  for (let k = 0; k < SIDES; k++) {
    const k1 = (k + 1) % SIDES;
    // u, v, t right-handed: going round k → k1 is counter-clockwise seen from b's end.
    idx.push(base + k, base + k1, base + SIDES + k1, base + k, base + SIDES + k1, base + SIDES + k);
  }
  // End caps.
  for (const [rg, sgn] of [[ra, -1], [rb, 1]] as const) {
    const c0 = pos.length / 3;
    for (const q of rg) {
      pos.push(...q.p);
      nor.push(t[0] * sgn, t[1] * sgn, t[2] * sgn);
    }
    for (let k = 1; k + 1 < SIDES; k++) {
      if (sgn > 0) idx.push(c0, c0 + k, c0 + k + 1);
      else idx.push(c0, c0 + k + 1, c0 + k);
    }
  }
}

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
