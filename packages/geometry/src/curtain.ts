import { wallExtent, wallLength, type CurtainEdits, type CurtainGrid, type CurtainPanelKind, type Document, type MaterialParams, type Wall } from "@open-bim/core";
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
export function curtainGridLines(length: number, bottom: number, top: number, grid: CurtainGrid, edits?: CurtainEdits | null): { u: number[]; z: number[] } {
  const divide = (a: number, b: number, max: number) => {
    const n = Math.max(1, Math.ceil((b - a) / max - 1e-9));
    return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  };
  const own = (xs: number[], a: number, b: number) => [a, ...xs.filter((x) => x > a + 1 && x < b - 1).sort((p, q) => p - q), b];
  return {
    u: edits?.uLines ? own(edits.uLines, 0, length) : divide(0, length, grid.uSpacing),
    z: edits?.zLines ? own(edits.zLines.map((z) => bottom + z), bottom, top) : divide(bottom, top, grid.vSpacing),
  };
}

const rgb = (c: number): [number, number, number] => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

/** Solid (spandrel) panels: a light grey; door frames take the mullion colour. */
const SOLID = rgb(0xc9ccd0);
const DOOR_FRAME = 50;

export function buildCurtainWall(doc: Document, wall: Wall, grid: CurtainGrid): MeshData | null {
  const len = wallLength(wall);
  const { bottom, top } = wallExtent(doc, wall);
  if (len <= 0 || top <= bottom) return null;
  const { start, end } = wall.params;
  const dir = { x: (end.x - start.x) / len, y: (end.y - start.y) / len };
  const nrm = { x: -dir.y, y: dir.x };
  const glass = rgb((grid.panelMaterialId ? doc.get<MaterialParams>(grid.panelMaterialId)?.params.color : undefined) ?? 0xa9cfe3);
  const metal = rgb((grid.mullionMaterialId ? doc.get<MaterialParams>(grid.mullionMaterialId)?.params.color : undefined) ?? 0x8a9199);
  const edits = wall.params.curtainEdits ?? null;
  const removed = new Set(edits?.removed ?? []);
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const world = (u: number, v: number, z: number): [number, number, number] => [start.x + dir.x * u + nrm.x * v, start.y + dir.y * u + nrm.y * v, z];
  const quad = (q: [number, number, number][], n: [number, number, number], c: [number, number, number]) => {
    const base = pos.length / 3;
    const wn = [dir.x * n[0] + nrm.x * n[1], dir.y * n[0] + nrm.y * n[1], n[2]];
    for (const [u, v, z] of q) {
      pos.push(...world(u, v, z));
      nor.push(...wn);
      col.push(...c);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const box = (u0: number, u1: number, v0: number, v1: number, z0: number, z1: number, c: [number, number, number]) => {
    if (u1 - u0 < 1e-6 || v1 - v0 < 1e-6 || z1 - z0 < 1e-6) return;
    quad([[u0, v0, z0], [u0, v1, z0], [u1, v1, z0], [u1, v0, z0]], [0, 0, -1], c);
    quad([[u0, v0, z1], [u1, v0, z1], [u1, v1, z1], [u0, v1, z1]], [0, 0, 1], c);
    quad([[u0, v0, z0], [u1, v0, z0], [u1, v0, z1], [u0, v0, z1]], [0, -1, 0], c);
    quad([[u0, v1, z0], [u0, v1, z1], [u1, v1, z1], [u1, v1, z0]], [0, 1, 0], c);
    quad([[u0, v0, z0], [u0, v0, z1], [u0, v1, z1], [u0, v1, z0]], [-1, 0, 0], c);
    quad([[u1, v0, z0], [u1, v1, z0], [u1, v1, z1], [u1, v0, z1]], [1, 0, 0], c);
  };
  // Circular mullions: 12-sided prisms, vertical (along z) or horizontal (along u).
  const SIDES = 12;
  const rod = (axis: "z" | "u", a0: number, a1: number, cu: number, cz: number, r: number, c: [number, number, number]) => {
    if (a1 - a0 < 1e-6) return;
    // End caps: fans round the axis (as quads with a doubled centre point).
    const at = (t: number, a: number): [number, number, number] => (axis === "z" ? [cu + r * Math.cos(t), r * Math.sin(t), a] : [a, r * Math.cos(t), cz + r * Math.sin(t)]);
    const mid = (a: number): [number, number, number] => (axis === "z" ? [cu, 0, a] : [a, 0, cz]);
    const n0: [number, number, number] = axis === "z" ? [0, 0, -1] : [-1, 0, 0];
    const n1: [number, number, number] = axis === "z" ? [0, 0, 1] : [1, 0, 0];
    for (let k = 0; k < SIDES; k++) {
      const t0 = (2 * Math.PI * k) / SIDES;
      const t1 = (2 * Math.PI * (k + 1)) / SIDES;
      const lo = [at(t1, a0), at(t0, a0)];
      const hi = [at(t0, a1), at(t1, a1)];
      quad([mid(a0), lo[0]!, lo[1]!, mid(a0)], n0, c);
      quad([mid(a1), hi[0]!, hi[1]!, mid(a1)], n1, c);
    }
    for (let k = 0; k < SIDES; k++) {
      const t0 = (2 * Math.PI * k) / SIDES;
      const t1 = (2 * Math.PI * (k + 1)) / SIDES;
      const tm = (t0 + t1) / 2;
      if (axis === "z") {
        const p0: [number, number] = [cu + r * Math.cos(t0), r * Math.sin(t0)];
        const p1: [number, number] = [cu + r * Math.cos(t1), r * Math.sin(t1)];
        quad([[p0[0], p0[1], a0], [p1[0], p1[1], a0], [p1[0], p1[1], a1], [p0[0], p0[1], a1]], [Math.cos(tm), Math.sin(tm), 0], c);
      } else {
        const p0: [number, number] = [r * Math.cos(t0), cz + r * Math.sin(t0)];
        const p1: [number, number] = [r * Math.cos(t1), cz + r * Math.sin(t1)];
        quad([[a0, p0[0], p0[1]], [a0, p1[0], p1[1]], [a1, p1[0], p1[1]], [a1, p0[0], p0[1]]], [0, Math.cos(tm), Math.sin(tm)], c);
      }
    }
  };
  const { u: us, z: zs } = curtainGridLines(len, bottom, top, grid, edits);
  const border = grid.borderMullions !== false;
  const circular = grid.mullionShape === "circular";
  const hw = grid.mullionWidth / 2;
  const hd = grid.mullionDepth / 2;
  const hp = grid.panelThickness / 2;
  const nu = us.length - 1;
  const nz = zs.length - 1;
  // Which mullion segments exist: interior lines unless removed; edges when the type has border mullions.
  const vSeg = (k: number, j: number) => ((k === 0 || k === nu) ? border : !removed.has(`v:${k}:${j}`));
  const hSeg = (k: number, i: number) => ((k === 0 || k === nz) ? border : !removed.has(`h:${k}:${i}`));
  const kind = (i: number, j: number): CurtainPanelKind => edits?.panels?.[`${i},${j}`] ?? "glass";
  // Panels run to a cell edge with no mullion; glass first (the mesh's glass range).
  const cell = (i: number, j: number) => ({
    u0: us[i]! + (vSeg(i, j) ? hw : 0),
    u1: us[i + 1]! - (vSeg(i + 1, j) ? hw : 0),
    z0: zs[j]! + (hSeg(j, i) ? hw : 0),
    z1: zs[j + 1]! - (hSeg(j + 1, i) ? hw : 0),
  });
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nz; j++) {
      const c = cell(i, j);
      const k = kind(i, j);
      if (k === "glass") box(c.u0, c.u1, -hp, hp, c.z0, c.z1, glass);
      // A door: a glazed leaf inside a frame, down to the cell's floor.
      if (k === "door") box(c.u0 + DOOR_FRAME, c.u1 - DOOR_FRAME, -hp, hp, zs[j]! + DOOR_FRAME, c.z1 - DOOR_FRAME, glass);
    }
  const glassCount = idx.length;
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nz; j++) {
      const k = kind(i, j);
      const c = cell(i, j);
      if (k === "solid") box(c.u0, c.u1, -hp, hp, c.z0, c.z1, SOLID);
      if (k === "door") {
        const z0 = zs[j]!;
        box(c.u0, c.u0 + DOOR_FRAME, -hd, hd, z0, c.z1, metal);
        box(c.u1 - DOOR_FRAME, c.u1, -hd, hd, z0, c.z1, metal);
        box(c.u0 + DOOR_FRAME, c.u1 - DOOR_FRAME, -hd, hd, c.z1 - DOOR_FRAME, c.z1, metal);
        box(c.u0 + DOOR_FRAME, c.u1 - DOOR_FRAME, -hp - 20, -hp, z0 + 980, z0 + 1020, metal); // push bar
      }
    }
  // Vertical mullions, row by row (end ones kept inside the wall), then horizontals between them.
  for (let k = 0; k <= nu; k++)
    for (let j = 0; j < nz; j++) {
      if (!vSeg(k, j)) continue;
      const u = us[k]!;
      if (circular) rod("z", zs[j]!, zs[j + 1]!, Math.min(len - hw, Math.max(hw, u)), 0, hw, metal);
      else box(Math.max(0, u - hw), Math.min(len, u + hw), -hd, hd, zs[j]!, zs[j + 1]!, metal);
    }
  for (let k = 0; k <= nz; k++)
    for (let i = 0; i < nu; i++) {
      // No sill under a door.
      if (!hSeg(k, i) || (k < nz && kind(i, k) === "door")) continue;
      const z = zs[k]!;
      const u0 = us[i]! + (vSeg(i, Math.min(k, nz - 1)) ? hw : 0);
      const u1 = us[i + 1]! - (vSeg(i + 1, Math.min(k, nz - 1)) ? hw : 0);
      if (circular) rod("u", u0, u1, 0, Math.min(top - hw, Math.max(bottom + hw, z)), hw, metal);
      else box(u0, u1, -hd, hd, Math.max(bottom, z - hw), Math.min(top, z + hw), metal);
    }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), indices: new Uint32Array(idx), colors: new Float32Array(col), glass: { start: 0, count: glassCount } };
}
