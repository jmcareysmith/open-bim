import earcut from "earcut";
import type { Vec2 } from "@open-bim/core";

/** Triangle mesh in model space (mm, Z up). Flat-shaded: vertices are not shared across faces. */
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Optional per-vertex RGB (0–1), for elements with more than one material (curtain walls). */
  colors?: Float32Array;
}

export interface Box3 {
  min: [number, number, number];
  max: [number, number, number];
}

class MeshBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private idx: number[] = [];

  /** Add a planar polygon face (already triangulated) with a single normal. */
  face(verts: [number, number, number][], tris: number[], n: [number, number, number]): void {
    const base = this.pos.length / 3;
    for (const v of verts) {
      this.pos.push(...v);
      this.nor.push(...n);
    }
    for (const t of tris) this.idx.push(base + t);
  }

  build(): MeshData {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nor),
      indices: new Uint32Array(this.idx),
    };
  }
}

/** Signed area; positive = counter-clockwise. */
export function signedArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

const ccw = (poly: Vec2[]) => (signedArea(poly) >= 0 ? poly : [...poly].reverse());
const cw = (poly: Vec2[]) => (signedArea(poly) < 0 ? poly : [...poly].reverse());

/**
 * Extrude a plan polygon (with optional holes) vertically from z0 to z1.
 * Winding is normalised, so callers can pass either orientation.
 */
export function extrudePolygon(outer: Vec2[], holes: Vec2[][], z0: number, z1: number): MeshData {
  if (outer.length < 3) throw new Error("Polygon needs at least 3 points");
  if (!(z1 > z0)) throw new Error(`Invalid extrusion range ${z0}..${z1}`);

  const o = ccw(outer);
  const hs = holes.filter((h) => h.length >= 3).map(cw);
  const flat: number[] = [];
  const holeIdx: number[] = [];
  for (const p of o) flat.push(p.x, p.y);
  for (const h of hs) {
    holeIdx.push(flat.length / 2);
    for (const p of h) flat.push(p.x, p.y);
  }
  const tris = earcut(flat, holeIdx, 2);
  const all: Vec2[] = [o, ...hs].flat();

  const mb = new MeshBuilder();
  // Top (CCW from above → normal +Z)
  mb.face(
    all.map((p) => [p.x, p.y, z1]),
    tris,
    [0, 0, 1],
  );
  // Bottom: reverse winding
  const rev: number[] = [];
  for (let i = 0; i < tris.length; i += 3) rev.push(tris[i]!, tris[i + 2]!, tris[i + 1]!);
  mb.face(
    all.map((p) => [p.x, p.y, z0]),
    rev,
    [0, 0, -1],
  );
  // Sides: outer ring is CCW and holes CW, so the outward normal is always (dy, -dx).
  for (const ring of [o, ...hs]) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len === 0) continue;
      mb.face(
        [
          [a.x, a.y, z0],
          [b.x, b.y, z0],
          [b.x, b.y, z1],
          [a.x, a.y, z1],
        ],
        [0, 1, 2, 0, 2, 3],
        [dy / len, -dx / len, 0],
      );
    }
  }
  return mb.build();
}

export function boundingBox(mesh: MeshData): Box3 {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = p[i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  return { min, max };
}

/** Enclosed volume (mm³) via the divergence theorem. Useful for tests and quantity take-off. */
export function meshVolume(mesh: MeshData): number {
  const p = mesh.positions;
  const ix = mesh.indices;
  let v = 0;
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i]! * 3;
    const b = ix[i + 1]! * 3;
    const c = ix[i + 2]! * 3;
    v +=
      p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) -
      p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) +
      p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!);
  }
  return v / 6;
}
