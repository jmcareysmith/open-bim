import { DEFAULT_RAILING_TYPE, railingPath, type Document, type Element, type Railing, type RailingTypeParams } from "@open-bim/core";
import type { LineData } from "./datums.ts";
import { mergeMeshes } from "./doors.ts";
import type { MeshData } from "./mesh.ts";

// Railing geometry: a square top rail `height` above the path, square balusters at the clear-gap
// spacing (posts at every path vertex), all as boxes oriented along each segment.

type P3 = { x: number; y: number; z: number };

/** A box of square section `s` from a to b (any direction), with flat normals. */
function beam(a: P3, b: P3, s: number): MeshData {
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const len = Math.hypot(d.x, d.y, d.z) || 1;
  const u = { x: d.x / len, y: d.y / len, z: d.z / len };
  // Side vector: horizontal, square to the beam (vertical beams use X).
  let sx = -u.y;
  let sy = u.x;
  const sl = Math.hypot(sx, sy);
  if (sl < 1e-6) {
    sx = 1;
    sy = 0;
  } else {
    sx /= sl;
    sy /= sl;
  }
  const side = { x: sx, y: sy, z: 0 };
  const up = { x: u.y * side.z - u.z * side.y, y: u.z * side.x - u.x * side.z, z: u.x * side.y - u.y * side.x };
  const h = s / 2;
  const corner = (p: P3, i: number, j: number): [number, number, number] => [p.x + side.x * h * i + up.x * h * j, p.y + side.y * h * i + up.y * h * j, p.z + side.z * h * i + up.z * h * j];
  const ring = (p: P3) => [corner(p, -1, -1), corner(p, 1, -1), corner(p, 1, 1), corner(p, -1, 1)];
  const A = ring(a);
  const B = ring(b);
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const quad = (q: [number, number, number][], n: { x: number; y: number; z: number }) => {
    const base = pos.length / 3;
    for (const v of q) {
      pos.push(...v);
      nor.push(n.x, n.y, n.z);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const neg = (v: P3) => ({ x: -v.x, y: -v.y, z: -v.z });
  quad([A[0]!, A[1]!, B[1]!, B[0]!], neg(up));
  quad([A[1]!, A[2]!, B[2]!, B[1]!], side);
  quad([A[2]!, A[3]!, B[3]!, B[2]!], up);
  quad([A[3]!, A[0]!, B[0]!, B[3]!], neg(side));
  quad([A[3]!, A[2]!, A[1]!, A[0]!], neg(u));
  quad([B[0]!, B[1]!, B[2]!, B[3]!], u);
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), indices: new Uint32Array(idx) };
}

export function buildRailing(doc: Document, el: Element): MeshData | null {
  const r = el as Railing;
  const t = (r.typeId ? doc.get<RailingTypeParams>(r.typeId)?.params : undefined) ?? DEFAULT_RAILING_TYPE;
  const path = railingPath(doc, r);
  if (path.length < 2) return null;
  const parts: MeshData[] = [];
  const top = (p: P3): P3 => ({ x: p.x, y: p.y, z: p.z + t.height - t.railSize / 2 });
  const spacing = t.balusterGap + t.balusterSize;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    parts.push(beam(top(a), top(b), t.railSize));
    const plan = Math.hypot(b.x - a.x, b.y - a.y);
    // Balusters (and a post at the start of each segment), with the last at the end of the path.
    const n = Math.max(1, Math.ceil(plan / spacing));
    for (let k = 0; k < n + (i === path.length - 2 ? 1 : 0); k++) {
      const f = k / n;
      const base = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
      const s = k === 0 || k === n ? t.balusterSize * 2 : t.balusterSize;
      parts.push(beam(base, { ...base, z: base.z + t.height - t.railSize }, s));
    }
  }
  return mergeMeshes(parts);
}

/** Plan symbol: the path. */
export function buildRailingLines(doc: Document, el: Element): LineData | null {
  const path = railingPath(doc, el as Railing);
  const seg: number[] = [];
  for (let i = 0; i + 1 < path.length; i++) seg.push(path[i]!.x, path[i]!.y, 0, path[i + 1]!.x, path[i + 1]!.y, 0);
  return seg.length ? { segments: new Float32Array(seg), labels: [], planOnly: true } : null;
}
