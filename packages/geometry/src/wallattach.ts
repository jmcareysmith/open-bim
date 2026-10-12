import earcut from "earcut";
import { attachedTopAt, wallExtent, wallTopBreaks, type Document, type Vec2, type Wall } from "@open-bim/core";
import { joinedWallFootprint } from "./joins.ts";
import type { MeshData } from "./mesh.ts";

// A wall whose top follows a sloped roof: the (joined) footprint is cut across at each kink in the
// roof underside (ridge, hips, valleys), each slice gets a top that follows the roof at its own
// corners (so the top also slopes across the wall's thickness), over a flat bottom and vertical
// sides. One closed mesh, so OpenCascade can still cut doors and windows out of it.

export function slopedTopWallMesh(doc: Document, wall: Wall): MeshData | null {
  const { bottom, top: maxTop } = wallExtent(doc, wall);
  const { start, end } = wall.params;
  const L = Math.hypot(end.x - start.x, end.y - start.y);
  if (L < 1) return null;
  const d = { x: (end.x - start.x) / L, y: (end.y - start.y) / L };
  const along = (p: Vec2) => (p.x - start.x) * d.x + (p.y - start.y) * d.y;
  const topAt = (p: Vec2) => Math.max(bottom + 1, attachedTopAt(doc, wall, p) ?? maxTop);

  // Footprint, counter-clockwise, with points added where each kink line crosses an edge.
  let fp = joinedWallFootprint(doc, wall);
  if (signedArea(fp) < 0) fp = [...fp].reverse();
  const cuts = wallTopBreaks(doc, wall).slice(1, -1);
  const P: Vec2[] = [];
  fp.forEach((a, i) => {
    const b = fp[(i + 1) % fp.length]!;
    P.push(a);
    const ua = along(a);
    const ub = along(b);
    const between = cuts.filter((u) => (u - ua) * (u - ub) < 0).sort((x, y) => (ub > ua ? x - y : y - x));
    for (const u of between) {
      const t = (u - ua) / (ub - ua);
      P.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  });

  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => {
    const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const l = Math.hypot(n[0]!, n[1]!, n[2]!);
    if (l === 0) return;
    const i0 = pos.length / 3;
    for (const p of [a, b, c]) {
      pos.push(p[0]!, p[1]!, p[2]!);
      nor.push(n[0]! / l, n[1]! / l, n[2]! / l);
    }
    idx.push(i0, i0 + 1, i0 + 2);
  };
  const flat = (poly: Vec2[]) => earcut(poly.flatMap((p) => [p.x, p.y]));

  // Bottom (facing down).
  const bt = flat(P);
  for (let i = 0; i < bt.length; i += 3) {
    const [a, b, c] = [P[bt[i]!]!, P[bt[i + 1]!]!, P[bt[i + 2]!]!];
    tri([a.x, a.y, bottom], [c.x, c.y, bottom], [b.x, b.y, bottom]);
  }
  // Top, one slice at a time between kinks (each slice lies in one roof plane).
  const bounds = [-Infinity, ...cuts, Infinity];
  const eps = 1e-6;
  for (let k = 0; k + 1 < bounds.length; k++) {
    const lo = bounds[k]!;
    const hi = bounds[k + 1]!;
    const slice = P.filter((p) => along(p) >= lo - eps && along(p) <= hi + eps);
    if (slice.length < 3) continue;
    const t = flat(slice);
    for (let i = 0; i < t.length; i += 3) {
      const [a, b, c] = [slice[t[i]!]!, slice[t[i + 1]!]!, slice[t[i + 2]!]!];
      tri([a.x, a.y, topAt(a)], [b.x, b.y, topAt(b)], [c.x, c.y, topAt(c)]);
    }
  }
  // Sides.
  P.forEach((a, i) => {
    const b = P[(i + 1) % P.length]!;
    const ta = topAt(a);
    const tb = topAt(b);
    tri([a.x, a.y, bottom], [b.x, b.y, bottom], [b.x, b.y, tb]);
    tri([a.x, a.y, bottom], [b.x, b.y, tb], [a.x, a.y, ta]);
  });
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), indices: new Uint32Array(idx) };
}

function signedArea(poly: Vec2[]): number {
  let s = 0;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length]!;
    s += a.x * b.y - b.x * a.y;
  });
  return s / 2;
}
