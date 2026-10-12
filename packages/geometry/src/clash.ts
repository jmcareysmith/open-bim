import type { Document, Element, ElementId } from "@open-bim/core";
import type { GeometryKernel } from "./kernel.ts";
import { boundingBox, type Box3, type MeshData } from "./mesh.ts";

// Clash detection (Revit: Interference Check). Elements of the two category sets are paired by
// overlapping bounding boxes, then the kernel measures their shared volume: OpenCascade gives the
// exact boolean volume, so elements that merely touch (a wall on a slab) aren't clashes. Elements
// related by hosting (a door and its wall, a railing and its stair, a footing and its wall) are skipped.

export interface Clash {
  a: ElementId;
  b: ElementId;
  /** Shared volume, mm³ (bounding-box overlap when the kernel can't do booleans). */
  volume: number;
  /** Centre of the overlap, model mm. */
  at: [number, number, number];
  exact: boolean;
}

interface VolumeKernel extends GeometryKernel {
  intersectionVolume?(a: MeshData, b: MeshData): number;
}

function host(el: Element): string | undefined {
  const p = el.params as { hostId?: unknown; wallId?: unknown };
  return typeof p.hostId === "string" ? p.hostId : typeof p.wallId === "string" ? p.wallId : undefined;
}

function overlap(a: Box3, b: Box3, eps: number): Box3 | null {
  const min: [number, number, number] = [0, 0, 0];
  const max: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    min[k] = Math.max(a.min[k]!, b.min[k]!);
    max[k] = Math.min(a.max[k]!, b.max[k]!);
    if (max[k]! - min[k]! <= eps) return null;
  }
  return { min, max };
}

export function findClashes(
  doc: Document,
  kernel: VolumeKernel,
  opts: { a: string[]; b: string[]; /** Ignore shared volumes below this, mm³ (default 1 cm³). */ tolerance?: number },
): Clash[] {
  const tolerance = opts.tolerance ?? 1000;
  const build = (cats: string[]) =>
    doc
      .all()
      .filter((e) => cats.includes(e.category))
      .flatMap((e) => {
        try {
          const m = kernel.build(doc, e);
          return m && m.indices.length ? [{ el: e, mesh: m, box: boundingBox(m) }] : [];
        } catch {
          return [];
        }
      });
  const A = build(opts.a);
  const B = opts.a.join() === opts.b.join() ? A : build(opts.b);
  const seen = new Set<string>();
  const out: Clash[] = [];
  for (const x of A) {
    for (const y of B) {
      if (x.el.id === y.el.id) continue;
      const key = x.el.id < y.el.id ? `${x.el.id}|${y.el.id}` : `${y.el.id}|${x.el.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (host(x.el) === y.el.id || host(y.el) === x.el.id) continue;
      const o = overlap(x.box, y.box, 0.5);
      if (!o) continue;
      const exact = typeof kernel.intersectionVolume === "function";
      let volume = (o.max[0] - o.min[0]) * (o.max[1] - o.min[1]) * (o.max[2] - o.min[2]);
      if (exact) {
        try {
          volume = kernel.intersectionVolume!(x.mesh, y.mesh);
        } catch {
          continue;
        }
      }
      if (volume < tolerance) continue;
      out.push({ a: x.el.id, b: y.el.id, volume, at: [(o.min[0] + o.max[0]) / 2, (o.min[1] + o.max[1]) / 2, (o.min[2] + o.max[2]) / 2], exact });
    }
  }
  return out.sort((p, q) => q.volume - p.volume);
}
