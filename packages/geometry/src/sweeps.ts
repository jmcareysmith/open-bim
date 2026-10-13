import { sweepProfile, wallCuts, wallDirection, wallExtent, wallLength, wallSweeps, wallThickness, type Document, type Vec2, type Wall } from "@open-bim/core";
import { joinedWallFootprint } from "./joins.ts";
import { extrudePolygon, type MeshData } from "./mesh.ts";

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

/** Edit Profile: the wall as its elevation outline through its thickness (joins don't trim it). */
export function wallProfileMesh(doc: Document, wall: Wall): MeshData | null {
  const prof = wall.params.profile;
  if (!prof || prof.length < 3) return null;
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
