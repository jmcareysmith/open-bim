import type { MeshData } from "./mesh.ts";

// Planar faces of a mesh, for Model by Face: from one picked triangle, the flat face it belongs to
// (every coplanar triangle touching it) and that face's outline.

export type V3 = [number, number, number];

export interface PlanarFace {
  /** Unit normal, out of the solid. */
  normal: V3;
  /** Outer boundary, in order (anticlockwise seen from outside). */
  loop: V3[];
}

const key = (p: V3) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)},${Math.round(p[2] * 10)}`;

function vertex(m: MeshData, i: number): V3 {
  return [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!];
}

function triNormal(a: V3, b: V3, c: V3): V3 {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n: V3 = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
  const l = Math.hypot(...n) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

/** The planar face containing triangle `tri` (its index in `indices` / 3), or null if degenerate. */
export function planarFace(m: MeshData, tri: number): PlanarFace | null {
  const count = m.indices.length / 3;
  if (tri < 0 || tri >= count) return null;
  const corners = (t: number): [V3, V3, V3] => [vertex(m, m.indices[t * 3]!), vertex(m, m.indices[t * 3 + 1]!), vertex(m, m.indices[t * 3 + 2]!)];
  const [a0, b0, c0] = corners(tri);
  const n = triNormal(a0, b0, c0);
  const d = n[0] * a0[0] + n[1] * a0[1] + n[2] * a0[2];
  // Coplanar triangles, then those connected to the picked one through shared edges.
  const coplanar: number[] = [];
  for (let t = 0; t < count; t++) {
    const [a, b, c] = corners(t);
    const tn = triNormal(a, b, c);
    if (tn[0] * n[0] + tn[1] * n[1] + tn[2] * n[2] < 0.9999) continue;
    if (Math.abs(n[0] * a[0] + n[1] * a[1] + n[2] * a[2] - d) > 0.5) continue;
    coplanar.push(t);
  }
  const edgeKey = (p: V3, q: V3) => [key(p), key(q)].sort().join("|");
  const byEdge = new Map<string, number[]>();
  for (const t of coplanar) {
    const [a, b, c] = corners(t);
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ] as [V3, V3][]) {
      const k = edgeKey(p, q);
      byEdge.set(k, [...(byEdge.get(k) ?? []), t]);
    }
  }
  const connected = new Set<number>([tri]);
  const queue = [tri];
  while (queue.length) {
    const t = queue.pop()!;
    const [a, b, c] = corners(t);
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ] as [V3, V3][]) {
      for (const o of byEdge.get(edgeKey(p, q)) ?? []) {
        if (!connected.has(o)) {
          connected.add(o);
          queue.push(o);
        }
      }
    }
  }
  // Boundary: directed edges not shared with another face triangle, chained into loops.
  const next = new Map<string, { to: string; p: V3 }>();
  for (const t of connected) {
    const [a, b, c] = corners(t);
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ] as [V3, V3][]) {
      const shared = (byEdge.get(edgeKey(p, q)) ?? []).filter((o) => connected.has(o)).length > 1;
      if (!shared) next.set(key(p), { to: key(q), p });
    }
  }
  const loops: V3[][] = [];
  const used = new Set<string>();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop: V3[] = [];
    let k = start;
    for (let guard = 0; guard < 100000 && !used.has(k); guard++) {
      const e = next.get(k);
      if (!e) break;
      used.add(k);
      loop.push(e.p);
      k = e.to;
    }
    if (loop.length >= 3) loops.push(simplify(loop));
  }
  if (!loops.length) return null;
  // The outer loop is the longest round.
  const perimeter = (l: V3[]) => l.reduce((s, p, i) => s + Math.hypot(...(l[(i + 1) % l.length]!.map((v, j) => v - p[j]!) as V3)), 0);
  loops.sort((x, y) => perimeter(y) - perimeter(x));
  return { normal: n, loop: loops[0]! };
}

/** Drop points that lie on a straight line between their neighbours. */
function simplify(loop: V3[]): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[(i + loop.length - 1) % loop.length]!;
    const b = loop[i]!;
    const c = loop[(i + 1) % loop.length]!;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    const cross = Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!);
    if (cross > 1e-6 * Math.hypot(...(u as V3)) * Math.hypot(...(v as V3)) + 1e-9) out.push(b);
  }
  return out.length >= 3 ? out : loop;
}

/** A vertical face as a wall: location line ends (exterior face on the face), bottom and top Z. */
export function wallFromFace(face: PlanarFace, thickness: number): { start: { x: number; y: number }; end: { x: number; y: number }; bottom: number; top: number } | null {
  const [nx, ny, nz] = face.normal;
  if (Math.abs(nz) > 0.01) return null;
  const zs = face.loop.map((p) => p[2]);
  const bottom = Math.min(...zs);
  const top = Math.max(...zs);
  // Along the face, so the wall's exterior (its left) faces out: d = (ny, −nx).
  const d = { x: ny, y: -nx };
  const along = face.loop.map((p) => p[0] * d.x + p[1] * d.y);
  const lo = Math.min(...along);
  const hi = Math.max(...along);
  const p0 = face.loop[0]!;
  const off = p0[0] * nx + p0[1] * ny - thickness / 2; // location line, half a wall in from the face
  const at = (t: number) => ({ x: d.x * t + nx * off, y: d.y * t + ny * off });
  return hi - lo > 1 && top - bottom > 1 ? { start: at(lo), end: at(hi), bottom, top } : null;
}

/**
 * A top face as a roof footprint: its outline in plan, sloping (at the face's pitch) from its
 * lowest horizontal edges, flat if the face is level. `eave` is the Z of the lowest edge.
 */
export function roofFromFace(face: PlanarFace): { boundary: { x: number; y: number }[]; slopes: (number | null)[]; eave: number } | null {
  const nz = face.normal[2];
  if (nz < 0.05) return null; // walls and undersides aren't roofs
  let loop = face.loop;
  // Plan outline anticlockwise.
  const area = loop.reduce((s, p, i) => s + p[0] * loop[(i + 1) % loop.length]![1] - loop[(i + 1) % loop.length]![0] * p[1], 0);
  if (area < 0) loop = [...loop].reverse();
  const eave = Math.min(...loop.map((p) => p[2]));
  const pitch = Math.acos(Math.min(1, nz));
  const flat = pitch < 1e-3;
  const slopes = loop.map((p, i) => {
    const q = loop[(i + 1) % loop.length]!;
    return !flat && Math.abs(p[2] - eave) < 1 && Math.abs(q[2] - eave) < 1 ? pitch : null;
  });
  return { boundary: loop.map((p) => ({ x: p[0], y: p[1] })), slopes, eave };
}
