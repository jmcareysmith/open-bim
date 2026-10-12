import type { DirectShapeParams, Document, Element } from "@open-bim/core";
import type { MeshData } from "./mesh.ts";

/** A direct shape's stored mesh, de-indexed with flat normals (crisp edges, like other builders). */
export function buildDirectShape(_doc: Document, el: Element): MeshData | null {
  const { positions: p, indices: idx } = el.params as DirectShapeParams;
  if (!idx.length) return null;
  const pos = new Float32Array(idx.length * 3);
  const nor = new Float32Array(idx.length * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const v = [idx[t]! * 3, idx[t + 1]! * 3, idx[t + 2]! * 3];
    const [a, b, c] = v.map((o) => [p[o]!, p[o + 1]!, p[o + 2]!]) as [number[], number[], number[]];
    const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const w = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    const l = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
    [a, b, c].forEach((q, k) => {
      pos.set(q, (t + k) * 3);
      nor.set([n[0]! / l, n[1]! / l, n[2]! / l], (t + k) * 3);
    });
  }
  return { positions: pos, normals: nor, indices: Uint32Array.from({ length: idx.length }, (_, i) => i) };
}
