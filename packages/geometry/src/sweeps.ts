import earcut from "earcut";
import polygonClipping from "polygon-clipping";
import { arcInfo, sweepProfile, wallCuts, wallDirection, wallExtent, wallLength, wallSweeps, wallThickness, type Document, type Vec2, type Wall } from "@open-bim/core";
import { joinedWallFootprint } from "./joins.ts";
import { extrudePolygon, meshVolume, type MeshData } from "./mesh.ts";

// Wall sweeps and reveals as solids: each profile extruded along its wall face, over the face's
// full joined length (so sweeps run into corners). Sweeps stop at openings they cross; reveals
// are cut from the wall (OCCT).

/** How far a reveal's cutter stands proud of the face, so the boolean leaves a clean groove. */
const REVEAL_OVERSHOOT = 2;

export function wallSweepSolids(doc: Document, wall: Wall): { sweeps: MeshData[]; reveals: MeshData[] } {
  const out = { sweeps: [] as MeshData[], reveals: [] as MeshData[] };
  const list = wallSweeps(doc, wall);
  if (!list.length) return out;
  const { bottom, top } = wallExtent(doc, wall);
  if (top <= bottom) return out;
  if (wall.params.curve) return arcSweepSolids(doc, wall, list, bottom, top);
  const d = wallDirection(wall);
  const nl = { x: -d.y, y: d.x }; // the exterior side (left of start → end)
  const half = wallThickness(doc, wall) / 2;
  const { start } = wall.params;
  const len = wallLength(wall);
  const fp = joinedWallFootprint(doc, wall).map((q) => ({ u: (q.x - start.x) * d.x + (q.y - start.y) * d.y, v: (q.x - start.x) * nl.x + (q.y - start.y) * nl.y }));
  const cuts = wallCuts(doc, wall);
  for (const s of list) {
    const side = s.side === "exterior" ? 1 : -1;
    // The face's extent along the wall, from the joined footprint (corners included).
    const face = fp.filter((q) => Math.abs(q.v - side * half) < 1);
    let u0 = face.length ? Math.min(...face.map((q) => q.u)) : 0;
    let u1 = face.length ? Math.max(...face.map((q) => q.u)) : len;
    if (s.from != null) u0 = Math.max(u0, s.from);
    if (s.to != null) u1 = Math.min(u1, s.to);
    if (u1 - u0 < 1) continue;
    const base = s.fromTop ? top - s.height : bottom + s.height;
    const reveal = s.kind === "reveal";
    const pts = sweepProfile(s);
    const minX = Math.min(...pts.map((q) => q.x));
    // Local profile: x out from the face (sweeps) or into it (reveals, set proud of the face).
    const local: Vec2[] = pts.map((q) => ({ x: (reveal && q.x === minX ? -REVEAL_OVERSHOOT : q.x) + (s.offset ?? 0), y: q.y }));
    const zMin = base + Math.min(...pts.map((q) => q.y));
    const zMax = base + Math.max(...pts.map((q) => q.y));
    if (zMax <= bottom || zMin >= top) continue;
    // Sweeps break at openings they cross.
    let spans: [number, number][] = [[u0, u1]];
    if (!reveal)
      for (const c of cuts) {
        if (c.z1 <= zMin || c.z0 >= zMax) continue;
        spans = spans.flatMap(([a, b]): [number, number][] => (c.u1 <= a || c.u0 >= b ? [[a, b]] : ([[a, c.u0], [c.u1, b]] as [number, number][]).filter(([x, y]) => y - x > 1)));
      }
    // Local (x, y, u) → world: face point + outward·x (inward for reveals) + up·y + along·u.
    const out3 = { x: nl.x * side * (reveal ? -1 : 1), y: nl.y * side * (reveal ? -1 : 1) };
    const fx = start.x + nl.x * side * half;
    const fy = start.y + nl.y * side * half;
    const flip = side * (reveal ? -1 : 1) < 0;
    for (const [a, b] of spans) {
      const m = extrudePolygon(local, [], a, b);
      const P = m.positions;
      const N = m.normals;
      for (let i = 0; i < P.length; i += 3) {
        const x = P[i]!;
        const y = P[i + 1]!;
        const u = P[i + 2]!;
        P[i] = fx + out3.x * x + d.x * u;
        P[i + 1] = fy + out3.y * x + d.y * u;
        P[i + 2] = base + y;
        const nx = N[i]!;
        const ny = N[i + 1]!;
        const nu = N[i + 2]!;
        N[i] = out3.x * nx + d.x * nu;
        N[i + 1] = out3.y * nx + d.y * nu;
        N[i + 2] = ny;
      }
      // A mirroring map turns the triangles inside out: swap their winding back.
      if (flip)
        for (let t = 0; t < m.indices.length; t += 3) {
          const k = m.indices[t + 1]!;
          m.indices[t + 1] = m.indices[t + 2]!;
          m.indices[t + 2] = k;
        }
      (reveal ? out.reveals : out.sweeps).push(m);
    }
  }
  return out;
}

/**
 * Sweeps and reveals on a curved wall: the profile lofted round the arc face (a station every 2°),
 * capped at each end; spans break at openings as on straight walls.
 */
function arcSweepSolids(doc: Document, wall: Wall, list: ReturnType<typeof wallSweeps>, bottom: number, top: number): { sweeps: MeshData[]; reveals: MeshData[] } {
  const out = { sweeps: [] as MeshData[], reveals: [] as MeshData[] };
  const { start, end, curve } = wall.params;
  const a = arcInfo(start, end, curve!);
  if (!a) return out;
  const len = Math.abs(a.sweep) * a.radius;
  const half = wallThickness(doc, wall) / 2;
  const cuts = wallCuts(doc, wall);
  const bow = Math.sign(curve!); // the exterior (left) face is outside the arc when it bows left
  for (const s of list) {
    const side = s.side === "exterior" ? 1 : -1;
    const reveal = s.kind === "reveal";
    const rFace = a.radius + side * half * bow;
    const outward = side * bow * (reveal ? -1 : 1); // along the radius: +1 away from the centre
    const u0 = Math.max(0, s.from ?? 0);
    const u1 = Math.min(len, s.to ?? len);
    if (u1 - u0 < 1) continue;
    const base = s.fromTop ? top - s.height : bottom + s.height;
    const pts = sweepProfile(s);
    const minX = Math.min(...pts.map((q) => q.x));
    const local: Vec2[] = pts.map((q) => ({ x: (reveal && q.x === minX ? -REVEAL_OVERSHOOT : q.x) + (s.offset ?? 0), y: q.y }));
    const zMin = base + Math.min(...pts.map((q) => q.y));
    const zMax = base + Math.max(...pts.map((q) => q.y));
    if (zMax <= bottom || zMin >= top) continue;
    let spans: [number, number][] = [[u0, u1]];
    if (!reveal)
      for (const c of cuts) {
        if (c.z1 <= zMin || c.z0 >= zMax) continue;
        spans = spans.flatMap(([p, q]): [number, number][] => (c.u1 <= p || c.u0 >= q ? [[p, q]] : ([[p, c.u0], [c.u1, q]] as [number, number][]).filter(([x, y]) => y - x > 1)));
      }
    for (const [p, q] of spans) (reveal ? out.reveals : out.sweeps).push(loftArc(local, a, rFace, outward, base, p, q));
  }
  return out;
}

/** A profile (x out from the face, y up) lofted round an arc from arc length u0 to u1. */
function loftArc(profile: Vec2[], a: { center: Vec2; radius: number; a0: number; sweep: number }, rFace: number, outward: number, base: number, u0: number, u1: number): MeshData {
  const dir = Math.sign(a.sweep);
  const t0 = a.a0 + (dir * u0) / a.radius;
  const t1 = a.a0 + (dir * u1) / a.radius;
  const n = Math.max(1, Math.ceil(Math.abs(t1 - t0) / (Math.PI / 90)));
  const m = profile.length;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k <= n; k++) {
    const t = t0 + ((t1 - t0) * k) / n;
    const c = Math.cos(t);
    const sn = Math.sin(t);
    for (const q of profile) {
      const r = rFace + outward * q.x;
      pos.push(a.center.x + r * c, a.center.y + r * sn, base + q.y);
    }
  }
  for (let k = 0; k < n; k++)
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const p0 = k * m + i;
      const p1 = k * m + j;
      const q0 = (k + 1) * m + i;
      const q1 = (k + 1) * m + j;
      idx.push(p0, q0, q1, p0, q1, p1);
    }
  // Caps: the profile triangulated at each end, wound to match the sides (the consistent choice
  // encloses the larger volume).
  const tris = earcut(profile.flatMap((q) => [q.x, q.y]), undefined, 2);
  const withCaps = (flipCaps: boolean): MeshData => {
    const all = [...idx];
    for (let t = 0; t < tris.length; t += 3) {
      const [i, j, k] = [tris[t]!, tris[t + 1]!, tris[t + 2]!];
      if (flipCaps) all.push(i, j, k, n * m + i, n * m + k, n * m + j);
      else all.push(i, k, j, n * m + i, n * m + j, n * m + k);
    }
    return { positions: new Float32Array(pos), normals: new Float32Array(pos.length), indices: new Uint32Array(all) };
  };
  const a1 = withCaps(false);
  const a2 = withCaps(true);
  let mesh = Math.abs(meshVolume(a1)) >= Math.abs(meshVolume(a2)) ? a1 : a2;
  // Whatever the profile's and the arc's handedness, face outwards (positive volume).
  if (meshVolume(mesh) < 0)
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const k = mesh.indices[t + 1]!;
      mesh.indices[t + 1] = mesh.indices[t + 2]!;
      mesh.indices[t + 2] = k;
    }
  mesh = withFaceNormals(mesh);
  return mesh;
}

/** Flat-shaded normals (each vertex takes the normal of a face using it — fine for thin trims). */
function withFaceNormals(m: MeshData): MeshData {
  const P = m.positions;
  const N = new Float32Array(P.length);
  for (let t = 0; t < m.indices.length; t += 3) {
    const [i, j, k] = [m.indices[t]! * 3, m.indices[t + 1]! * 3, m.indices[t + 2]! * 3];
    const ux = P[j]! - P[i]!, uy = P[j + 1]! - P[i + 1]!, uz = P[j + 2]! - P[i + 2]!;
    const vx = P[k]! - P[i]!, vy = P[k + 1]! - P[i + 1]!, vz = P[k + 2]! - P[i + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [i, j, k]) {
      N[v] = N[v]! + nx;
      N[v + 1] = N[v + 1]! + ny;
      N[v + 2] = N[v + 2]! + nz;
    }
  }
  for (let v = 0; v < N.length; v += 3) {
    const l = Math.hypot(N[v]!, N[v + 1]!, N[v + 2]!) || 1;
    N[v] = N[v]! / l;
    N[v + 1] = N[v + 1]! / l;
    N[v + 2] = N[v + 2]! / l;
  }
  return { ...m, normals: N };
}

/** Edit Profile: the wall as its elevation outline through its thickness (joins don't trim it). */
export function wallProfileMesh(doc: Document, wall: Wall): MeshData | null {
  const prof = wall.params.profile;
  if (!prof || prof.length < 3) return null;
  if (wall.params.curve) return arcProfileMesh(doc, wall, prof);
  const { bottom } = wallExtent(doc, wall);
  const d = wallDirection(wall);
  const nl = { x: -d.y, y: d.x };
  const half = wallThickness(doc, wall) / 2;
  const { start } = wall.params;
  // Local (u, z, v) → world; the map mirrors, so the winding is swapped back.
  const m = extrudePolygon(prof, [], -half, half);
  const P = m.positions;
  const N = m.normals;
  for (let i = 0; i < P.length; i += 3) {
    const u = P[i]!;
    const z = P[i + 1]!;
    const v = P[i + 2]!;
    P[i] = start.x + d.x * u + nl.x * v;
    P[i + 1] = start.y + d.y * u + nl.y * v;
    P[i + 2] = bottom + z;
    const nu = N[i]!;
    const nz = N[i + 1]!;
    const nv = N[i + 2]!;
    N[i] = d.x * nu + nl.x * nv;
    N[i + 1] = d.y * nu + nl.y * nv;
    N[i + 2] = nz;
  }
  for (let t = 0; t < m.indices.length; t += 3) {
    const k = m.indices[t + 1]!;
    m.indices[t + 1] = m.indices[t + 2]!;
    m.indices[t + 2] = k;
  }
  return m;
}

/**
 * Edit Profile on a curved wall: the outline (u = distance along the arc, z) cut into thin strips
 * across u, so the faces follow the arc; the outline's edges become the wall's ends and top.
 */
function arcProfileMesh(doc: Document, wall: Wall, prof: Vec2[]): MeshData | null {
  const a = arcInfo(wall.params.start, wall.params.end, wall.params.curve!);
  if (!a) return null;
  const { bottom } = wallExtent(doc, wall);
  const half = wallThickness(doc, wall) / 2;
  const s = Math.sign(a.sweep);
  const step = a.radius * (Math.PI / 90);
  // (u, v, z) → world; v is to the left of travel.
  const at = (u: number, v: number, z: number): [number, number, number] => {
    const t = a.a0 + (s * u) / a.radius;
    const r = a.radius - s * v;
    return [a.center.x + r * Math.cos(t), a.center.y + r * Math.sin(t), bottom + z];
  };
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  /** A triangle facing along `out` (flipped if it doesn't). */
  const tri = (p0: [number, number, number], p1: [number, number, number], p2: [number, number, number], out: [number, number, number]) => {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return;
    nx /= l; ny /= l; nz /= l;
    if (nx * out[0] + ny * out[1] + nz * out[2] < 0) {
      [p1, p2] = [p2, p1];
      nx = -nx; ny = -ny; nz = -nz;
    }
    const base = pos.length / 3;
    pos.push(...p0, ...p1, ...p2);
    for (let k = 0; k < 3; k++) nrm.push(nx, ny, nz);
    idx.push(base, base + 1, base + 2);
  };
  // Counter-clockwise outline in (u, z).
  let outline = prof.map((q) => ({ ...q }));
  let area = 0;
  outline.forEach((q, i) => {
    const r = outline[(i + 1) % outline.length]!;
    area += q.x * r.y - r.x * q.y;
  });
  if (area < 0) outline = outline.reverse();
  const u0 = Math.min(...outline.map((q) => q.x));
  const u1 = Math.max(...outline.map((q) => q.x));
  const z0 = Math.min(...outline.map((q) => q.y)) - 1;
  const z1 = Math.max(...outline.map((q) => q.y)) + 1;
  const ring = outline.map((q): [number, number] => [q.x, q.y]);
  ring.push(ring[0]!);
  const cuts: number[] = [];
  for (let u = Math.ceil(u0 / step) * step; u < u1; u += step) if (u > u0 + 1e-6) cuts.push(u);
  const bounds = [u0, ...cuts, u1];
  // Faces: each strip of the outline triangulated, on the left (+v) and right (−v) faces.
  for (let i = 0; i + 1 < bounds.length; i++) {
    const box: [number, number][] = [[bounds[i]!, z0], [bounds[i + 1]!, z0], [bounds[i + 1]!, z1], [bounds[i]!, z1], [bounds[i]!, z0]];
    for (const poly of polygonClipping.intersection([ring], [box])) {
      const flat = poly.flatMap((r) => r.slice(0, -1).flatMap(([x, y]) => [x, y]));
      const holes: number[] = [];
      let n = 0;
      poly.forEach((r, k) => {
        if (k > 0) holes.push(n);
        n += r.length - 1;
      });
      const t = earcut(flat, holes);
      const P = (k: number, v: number) => at(flat[k * 2]!, v, flat[k * 2 + 1]!);
      for (let k = 0; k < t.length; k += 3) {
        const c = P(t[k]!, 0);
        const L = at(flat[t[k]! * 2]!, 1, flat[t[k]! * 2 + 1]!);
        const left: [number, number, number] = [L[0] - c[0], L[1] - c[1], 0];
        const right: [number, number, number] = [-left[0], -left[1], 0];
        tri(P(t[k]!, half), P(t[k + 1]!, half), P(t[k + 2]!, half), left);
        tri(P(t[k]!, -half), P(t[k + 1]!, -half), P(t[k + 2]!, -half), right);
      }
    }
  }
  // Ends and top: the outline's edges, split where they cross the strips, across the thickness.
  for (let i = 0; i < outline.length; i++) {
    const p0 = outline[i]!;
    const p1 = outline[(i + 1) % outline.length]!;
    const ts = [0, 1];
    for (const c of cuts) {
      const den = p1.x - p0.x;
      if (Math.abs(den) < 1e-9) continue;
      const t = (c - p0.x) / den;
      if (t > 1e-9 && t < 1 - 1e-9) ts.push(t);
    }
    ts.sort((x, y) => x - y);
    for (let k = 0; k + 1 < ts.length; k++) {
      const A = { x: p0.x + (p1.x - p0.x) * ts[k]!, y: p0.y + (p1.y - p0.y) * ts[k]! };
      const B = { x: p0.x + (p1.x - p0.x) * ts[k + 1]!, y: p0.y + (p1.y - p0.y) * ts[k + 1]! };
      const aL = at(A.x, half, A.y), bL = at(B.x, half, B.y), aR = at(A.x, -half, A.y), bR = at(B.x, -half, B.y);
      // Outward in (u, z) for a counter-clockwise outline: right of A → B, i.e. (Δz, −Δu), in world terms.
      const du = B.x - A.x;
      const dz = B.y - A.y;
      const m0 = at((A.x + B.x) / 2, 0, (A.y + B.y) / 2);
      const m1 = at((A.x + B.x) / 2 + dz * 1e-3, 0, (A.y + B.y) / 2 - du * 1e-3);
      const out: [number, number, number] = [m1[0] - m0[0], m1[1] - m0[1], m1[2] - m0[2]];
      tri(aR, bR, bL, out);
      tri(aR, bL, aL, out);
    }
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm), indices: new Uint32Array(idx) };
}

/**
 * A profile drawn in (x, y) extruded along a plan line: world = origin + along·u + across·x,
 * z = z0 + y, for u from u0 to u1. Used for roof trims and extrusion roofs.
 */
export function profilePrism(profile: Vec2[], origin: Vec2, along: Vec2, across: Vec2, z0: number, u0: number, u1: number): MeshData {
  const m = extrudePolygon(profile, [], u0, u1);
  const P = m.positions;
  const N = m.normals;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i]!;
    const y = P[i + 1]!;
    const u = P[i + 2]!;
    P[i] = origin.x + across.x * x + along.x * u;
    P[i + 1] = origin.y + across.y * x + along.y * u;
    P[i + 2] = z0 + y;
    const nx = N[i]!;
    const ny = N[i + 1]!;
    const nu = N[i + 2]!;
    N[i] = across.x * nx + along.x * nu;
    N[i + 1] = across.y * nx + along.y * nu;
    N[i + 2] = ny;
  }
  // (x, y, u) → (across, up, along) mirrors when across · (up × along) < 0: swap the winding back.
  const det = across.x * -along.y + across.y * along.x;
  if (det < 0)
    for (let t = 0; t < m.indices.length; t += 3) {
      const k = m.indices[t + 1]!;
      m.indices[t + 1] = m.indices[t + 2]!;
      m.indices[t + 2] = k;
    }
  return m;
}
