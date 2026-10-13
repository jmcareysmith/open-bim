import { mullionProfile, wallExtent, wallLength, type CurtainEdits, type CurtainGrid, type CurtainPanelKind, type Document, type MaterialParams, type Vec2, type Wall } from "@open-bim/core";
import { extrudePolygon } from "./mesh.ts";
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
  // A mullion: its profile (x across, y through the wall) extruded along z (vertical) or u (horizontal).
  const prism = (poly: Vec2[], axis: "z" | "u", a0: number, a1: number, cu: number, cz: number, c: [number, number, number]) => {
    if (a1 - a0 < 1e-6) return;
    const m = extrudePolygon(poly, [], a0, a1);
    const base = pos.length / 3;
    const P = m.positions;
    const Nn = m.normals;
    for (let q = 0; q < P.length; q += 3) {
      const x = P[q]!;
      const y = P[q + 1]!;
      const a = P[q + 2]!;
      const nx = Nn[q]!;
      const ny = Nn[q + 1]!;
      const na = Nn[q + 2]!;
      const [u, v, z] = axis === "z" ? [cu + x, y, a] : [a, y, cz + x];
      const [nu, nv, nz] = axis === "z" ? [nx, ny, na] : [na, ny, nx];
      pos.push(...world(u, v, z));
      nor.push(dir.x * nu + nrm.x * nv, dir.y * nu + nrm.y * nv, nz);
      col.push(...c);
    }
    // (x, y, a) → (z, v, u) mirrors: swap the winding back for horizontals.
    for (let t = 0; t < m.indices.length; t += 3) {
      const [i0, i1, i2] = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!];
      if (axis === "u") idx.push(base + i0, base + i2, base + i1);
      else idx.push(base + i0, base + i1, base + i2);
    }
  };
  const parts: { key: string; start: number; count: number }[] = [];
  const part = (key: string, fn: () => void) => {
    const start = idx.length;
    fn();
    if (idx.length > start) parts.push({ key, start, count: idx.length - start });
  };
  const { u: us, z: zs } = curtainGridLines(len, bottom, top, grid, edits);
  const border = grid.borderMullions !== false;
  const hp = grid.panelThickness / 2;
  const nu = us.length - 1;
  const nz = zs.length - 1;
  const own = edits?.mullions ?? {};
  // Which mullion segments exist: interior lines unless removed; edges when the type has border mullions.
  const vSeg = (k: number, j: number) => (k === 0 || k === nu ? border : !removed.has(`v:${k}:${j}`));
  const hSeg = (k: number, i: number) => (k === 0 || k === nz ? border : !removed.has(`h:${k}:${i}`));
  const prof = (key: string, edge: boolean) => mullionProfile(grid, edge, own[key]);
  const halfOf = (poly: Vec2[]) => Math.max(...poly.map((q) => Math.abs(q.x)));
  // Vertical mullion k in row j: its centre along the wall (edge ones kept inside it) and half width.
  const vm = (k: number, j: number) => {
    const hw = halfOf(prof(`v:${k}:${j}`, k === 0 || k === nu));
    return { c: k === 0 ? hw : k === nu ? len - hw : us[k]!, hw };
  };
  const hm = (k: number, i: number) => {
    const hw = halfOf(prof(`h:${k}:${i}`, k === 0 || k === nz));
    return { c: k === 0 ? bottom + hw : k === nz ? top - hw : zs[k]!, hw };
  };
  const kind = (i: number, j: number): CurtainPanelKind => edits?.panels?.[`${i},${j}`] ?? "glass";
  // Panels run to the faces of the mullions round them (to the grid line where there's none).
  const cell = (i: number, j: number) => {
    const L = vm(i, j);
    const R = vm(i + 1, j);
    const B = hm(j, i);
    const T = hm(j + 1, i);
    return {
      u0: vSeg(i, j) ? L.c + L.hw : us[i]!,
      u1: vSeg(i + 1, j) ? R.c - R.hw : us[i + 1]!,
      z0: hSeg(j, i) ? B.c + B.hw : zs[j]!,
      z1: hSeg(j + 1, i) ? T.c - T.hw : zs[j + 1]!,
    };
  };
  const hd = grid.mullionDepth / 2;
  // Glass first (the mesh's glass range).
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nz; j++)
      part(`p:${i},${j}`, () => {
        const c = cell(i, j);
        const k = kind(i, j);
        if (k === "glass") box(c.u0, c.u1, -hp, hp, c.z0, c.z1, glass);
        // A door: a glazed leaf inside a frame, down to the cell's floor.
        if (k === "door") box(c.u0 + DOOR_FRAME, c.u1 - DOOR_FRAME, -hp, hp, zs[j]! + DOOR_FRAME, c.z1 - DOOR_FRAME, glass);
      });
  const glassCount = idx.length;
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nz; j++)
      part(`p:${i},${j}`, () => {
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
      });
  // Vertical mullions row by row, then horizontals between them.
  for (let k = 0; k <= nu; k++)
    for (let j = 0; j < nz; j++) {
      if (!vSeg(k, j)) continue;
      const key = `v:${k}:${j}`;
      const m = vm(k, j);
      part(key, () => prism(prof(key, k === 0 || k === nu), "z", zs[j]!, zs[j + 1]!, m.c, 0, metal));
    }
  for (let k = 0; k <= nz; k++)
    for (let i = 0; i < nu; i++) {
      // No sill under a door.
      if (!hSeg(k, i) || (k < nz && kind(i, k) === "door")) continue;
      const key = `h:${k}:${i}`;
      const row = Math.min(k, nz - 1);
      const L = vm(i, row);
      const R = vm(i + 1, row);
      const u0 = vSeg(i, row) ? L.c + L.hw : us[i]!;
      const u1 = vSeg(i + 1, row) ? R.c - R.hw : us[i + 1]!;
      part(key, () => prism(prof(key, k === 0 || k === nz), "u", u0, u1, 0, hm(k, i).c, metal));
    }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), indices: new Uint32Array(idx), colors: new Float32Array(col), glass: { start: 0, count: glassCount }, parts };
}
