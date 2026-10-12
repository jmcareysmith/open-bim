import { wallExtent, wallLength, type CurtainGrid, type Document, type MaterialParams, type Wall } from "@open-bim/core";
import type { MeshData } from "./mesh.ts";

// Curtain wall geometry: grid lines divide the wall equally (spacing no more than the type's),
// mullions sit on every grid line and the edges, and a glazed panel fills each cell. Built as boxes
// in the wall's frame (u along, v across, z up) with per-vertex colours for glass and mullions.

export interface CurtainCell {
  u0: number;
  u1: number;
  z0: number;
  z1: number;
}

/** Grid positions along the wall (0..length) and up it (bottom..top), ends included. */
export function curtainGridLines(length: number, bottom: number, top: number, grid: CurtainGrid): { u: number[]; z: number[] } {
  const divide = (a: number, b: number, max: number) => {
    const n = Math.max(1, Math.ceil((b - a) / max - 1e-9));
    return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  };
  return { u: divide(0, length, grid.uSpacing), z: divide(bottom, top, grid.vSpacing) };
}

const rgb = (c: number): [number, number, number] => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

export function buildCurtainWall(doc: Document, wall: Wall, grid: CurtainGrid): MeshData | null {
  const len = wallLength(wall);
  const { bottom, top } = wallExtent(doc, wall);
  if (len <= 0 || top <= bottom) return null;
  const { start, end } = wall.params;
  const dir = { x: (end.x - start.x) / len, y: (end.y - start.y) / len };
  const nrm = { x: -dir.y, y: dir.x };
  const glass = rgb((grid.panelMaterialId ? doc.get<MaterialParams>(grid.panelMaterialId)?.params.color : undefined) ?? 0xa9cfe3);
  const metal = rgb((grid.mullionMaterialId ? doc.get<MaterialParams>(grid.mullionMaterialId)?.params.color : undefined) ?? 0x8a9199);
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const world = (u: number, v: number, z: number): [number, number, number] => [start.x + dir.x * u + nrm.x * v, start.y + dir.y * u + nrm.y * v, z];
  const box = (u0: number, u1: number, v0: number, v1: number, z0: number, z1: number, c: [number, number, number]) => {
    if (u1 - u0 < 1e-6 || v1 - v0 < 1e-6 || z1 - z0 < 1e-6) return;
    const faces: [[number, number, number][], [number, number, number]][] = [
      [[[u0, v0, z0], [u0, v1, z0], [u1, v1, z0], [u1, v0, z0]], [0, 0, -1]],
      [[[u0, v0, z1], [u1, v0, z1], [u1, v1, z1], [u0, v1, z1]], [0, 0, 1]],
      [[[u0, v0, z0], [u1, v0, z0], [u1, v0, z1], [u0, v0, z1]], [0, -1, 0]],
      [[[u0, v1, z0], [u0, v1, z1], [u1, v1, z1], [u1, v1, z0]], [0, 1, 0]],
      [[[u0, v0, z0], [u0, v0, z1], [u0, v1, z1], [u0, v1, z0]], [-1, 0, 0]],
      [[[u1, v0, z0], [u1, v1, z0], [u1, v1, z1], [u1, v0, z1]], [1, 0, 0]],
    ];
    for (const [q, n] of faces) {
      const base = pos.length / 3;
      const wn = [dir.x * n[0] + nrm.x * n[1], dir.y * n[0] + nrm.y * n[1], n[2]];
      for (const [u, v, z] of q) {
        pos.push(...world(u, v, z));
        nor.push(...wn);
        col.push(...c);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };
  const { u: us, z: zs } = curtainGridLines(len, bottom, top, grid);
  const hw = grid.mullionWidth / 2;
  const hd = grid.mullionDepth / 2;
  const hp = grid.panelThickness / 2;
  // Panels.
  for (let i = 0; i + 1 < us.length; i++) {
    for (let j = 0; j + 1 < zs.length; j++) box(us[i]! + hw, us[i + 1]! - hw, -hp, hp, zs[j]! + hw, zs[j + 1]! - hw, glass);
  }
  // Vertical mullions (end ones kept inside the wall), then horizontals between them.
  for (const u of us) box(Math.max(0, u - hw), Math.min(len, u + hw), -hd, hd, bottom, top, metal);
  for (const z of zs) {
    for (let i = 0; i + 1 < us.length; i++) box(us[i]! + hw, us[i + 1]! - hw, -hd, hd, Math.max(bottom, z - hw), Math.min(top, z + hw), metal);
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), indices: new Uint32Array(idx), colors: new Float32Array(col) };
}
