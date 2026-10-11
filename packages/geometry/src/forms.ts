import earcut from "earcut";
import {
  Cat,
  evalField,
  evalPts,
  familyValues,
  type BlendParams,
  type Document,
  type Element,
  type ExtrusionParams,
  type RevolutionParams,
  type SweepParams,
  type Values,
  type Vec2,
  type WorkPlane,
} from "@open-bim/core";
import { extrudePolygon, meshVolume, signedArea, type MeshData } from "./mesh.ts";

// Family forms as meshes: extrusion, blend, revolution and sweep, built in their work plane's
// local frame (u, v in the plane, w along its normal) and mapped into family coordinates.

type V3 = [number, number, number];

export interface PlaneFrame {
  origin: V3;
  u: V3;
  v: V3;
  n: V3;
}

export function planeFrame(plane: WorkPlane, values: Values): PlaneFrame {
  const o = evalField(plane.offset, values, "Work plane offset");
  switch (plane.kind) {
    case "XY":
      return { origin: [0, 0, o], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };
    case "XZ":
      return { origin: [0, o, 0], u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] };
    case "YZ":
      return { origin: [o, 0, 0], u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] };
  }
}

const at = (f: PlaneFrame, u: number, v: number, w: number): V3 => [
  f.origin[0] + f.u[0] * u + f.v[0] * v + f.n[0] * w,
  f.origin[1] + f.u[1] * u + f.v[1] * v + f.n[1] * w,
  f.origin[2] + f.u[2] * u + f.v[2] * v + f.n[2] * w,
];

/** Collects triangles; `finish` makes the solid outward-facing (fixes left-handed frames). */
class TriMesh {
  private tris: [V3, V3, V3][] = [];

  tri(a: V3, b: V3, c: V3): void {
    this.tris.push([a, b, c]);
  }

  quad(a: V3, b: V3, c: V3, d: V3): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  finish(): MeshData {
    const build = (flip: boolean): MeshData => {
      const pos: number[] = [];
      const nor: number[] = [];
      for (const [a, b0, c0] of this.tris) {
        const [b, c] = flip ? [c0, b0] : [b0, c0];
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
        const l = Math.hypot(n[0]!, n[1]!, n[2]!);
        if (l < 1e-12) continue;
        for (const p of [a, b, c]) {
          pos.push(...p);
          nor.push(n[0]! / l, n[1]! / l, n[2]! / l);
        }
      }
      return { positions: new Float32Array(pos), normals: new Float32Array(nor), indices: Uint32Array.from({ length: pos.length / 3 }, (_, i) => i) };
    };
    const m = build(false);
    return meshVolume(m) < 0 ? build(true) : m;
  }
}

/** Map a mesh built in (u, v, w) plane coordinates into the frame, keeping it outward-facing. */
function placeMesh(local: MeshData, f: PlaneFrame): MeshData {
  const t = new TriMesh();
  const p = local.positions;
  const pt = (i: number): V3 => at(f, p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!);
  for (let i = 0; i < local.indices.length; i += 3) t.tri(pt(local.indices[i]!), pt(local.indices[i + 1]!), pt(local.indices[i + 2]!));
  return t.finish();
}

const ccw = (ring: Vec2[]) => (signedArea(ring) >= 0 ? ring : [...ring].reverse());

export function extrusionMesh(p: ExtrusionParams, values: Values): MeshData {
  const outer = evalPts(p.profile, values, "Profile");
  const holes = p.holes.map((h, i) => evalPts(h, values, `Hole ${i + 1}`));
  const a = evalField(p.start, values, "Extrusion start");
  const b = evalField(p.end, values, "Extrusion end");
  if (Math.abs(b - a) < 1e-6) throw new Error("Extrusion start and end are equal");
  return placeMesh(extrudePolygon(outer, holes, Math.min(a, b), Math.max(a, b)), planeFrame(p.plane, values));
}

/** Resample a ring to `n` points by splitting its longest edges. */
function resample(ring: Vec2[], n: number): Vec2[] {
  const r = [...ring];
  while (r.length < n) {
    let best = 0;
    let len = -1;
    r.forEach((p, i) => {
      const q = r[(i + 1) % r.length]!;
      const l = Math.hypot(q.x - p.x, q.y - p.y);
      if (l > len) [best, len] = [i, l];
    });
    const p = r[best]!;
    const q = r[(best + 1) % r.length]!;
    r.splice(best + 1, 0, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  }
  return r;
}

function cap(t: TriMesh, ring: Vec2[], toV3: (p: Vec2) => V3, reverse: boolean): void {
  const idx = earcut(ring.flatMap((p) => [p.x, p.y]));
  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, c] = [ring[idx[i]!]!, ring[idx[i + 1]!]!, ring[idx[i + 2]!]!].map(toV3) as [V3, V3, V3];
    if (reverse) t.tri(a, c, b);
    else t.tri(a, b, c);
  }
}

export function blendMesh(p: BlendParams, values: Values): MeshData {
  let bottom = ccw(evalPts(p.bottom, values, "Bottom profile"));
  let top = ccw(evalPts(p.top, values, "Top profile"));
  const n = Math.max(bottom.length, top.length);
  bottom = resample(bottom, n);
  top = resample(top, n);
  // Start the top ring at the vertex nearest (by angle about its centroid) to the bottom's first.
  const cen = (r: Vec2[]) => r.reduce((s, q) => ({ x: s.x + q.x / r.length, y: s.y + q.y / r.length }), { x: 0, y: 0 });
  const cb = cen(bottom);
  const ct = cen(top);
  const ang = (q: Vec2, c: Vec2) => Math.atan2(q.y - c.y, q.x - c.x);
  const a0 = ang(bottom[0]!, cb);
  let shift = 0;
  let bestD = Infinity;
  top.forEach((q, i) => {
    const d = Math.abs(Math.atan2(Math.sin(ang(q, ct) - a0), Math.cos(ang(q, ct) - a0)));
    if (d < bestD) [shift, bestD] = [i, d];
  });
  top = [...top.slice(shift), ...top.slice(0, shift)];
  const z0 = evalField(p.start, values, "Blend start");
  const z1 = evalField(p.end, values, "Blend end");
  if (Math.abs(z1 - z0) < 1e-6) throw new Error("Blend start and end are equal");
  const f = planeFrame(p.plane, values);
  const t = new TriMesh();
  cap(t, bottom, (q) => at(f, q.x, q.y, z0), true);
  cap(t, top, (q) => at(f, q.x, q.y, z1), false);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    t.quad(at(f, bottom[i]!.x, bottom[i]!.y, z0), at(f, bottom[j]!.x, bottom[j]!.y, z0), at(f, top[j]!.x, top[j]!.y, z1), at(f, top[i]!.x, top[i]!.y, z1));
  }
  return t.finish();
}

export function revolutionMesh(p: RevolutionParams, values: Values): MeshData {
  const profile = ccw(evalPts(p.profile, values, "Profile"));
  const axis = evalField(p.axis, values, "Revolution axis");
  const a0 = evalField(p.startAngle, values, "Start angle");
  const a1 = evalField(p.endAngle, values, "End angle");
  const sweep = a1 - a0;
  if (Math.abs(sweep) < 1e-6) throw new Error("Revolution angles are equal");
  const radii = profile.map((q) => q.x - axis);
  if (radii.some((r) => r < -1e-6) && radii.some((r) => r > 1e-6)) throw new Error("Revolution profile crosses its axis");
  const full = Math.abs(sweep) >= 360 - 1e-6;
  const steps = Math.max(8, Math.round((Math.abs(Math.min(sweep, 360)) / 360) * 48));
  const f = planeFrame(p.plane, values);
  const pt = (q: Vec2, deg: number): V3 => {
    const r = q.x - axis;
    const th = (deg * Math.PI) / 180;
    return at(f, axis + r * Math.cos(th), q.y, r * Math.sin(th));
  };
  const t = new TriMesh();
  const angleAt = (k: number) => a0 + (Math.min(sweep, full ? 360 : sweep) * k) / steps;
  for (let k = 0; k < steps; k++) {
    const th0 = angleAt(k);
    const th1 = angleAt(k + 1);
    profile.forEach((q, i) => {
      const r = profile[(i + 1) % profile.length]!;
      t.quad(pt(q, th0), pt(r, th0), pt(r, th1), pt(q, th1));
    });
  }
  if (!full) {
    cap(t, profile, (q) => pt(q, a0), true);
    cap(t, profile, (q) => pt(q, a1), false);
  }
  return t.finish();
}

export function sweepMesh(p: SweepParams, values: Values): MeshData {
  const path = evalPts(p.path, values, "Path");
  const profile = ccw(evalPts(p.profile, values, "Profile"));
  const f = planeFrame(p.plane, values);
  const n = path.length;
  const dirs = path.slice(1).map((q, i) => {
    const a = path[i]!;
    const l = Math.hypot(q.x - a.x, q.y - a.y);
    if (l < 1e-6) throw new Error("Sweep path has a zero-length segment");
    return { x: (q.x - a.x) / l, y: (q.y - a.y) / l };
  });
  // In-plane offset direction at each path vertex: segment normal at the ends, mitre between.
  const normalOf = (d: Vec2) => ({ x: -d.y, y: d.x });
  const mitres = path.map((_, i) => {
    if (i === 0) return { m: normalOf(dirs[0]!), s: 1 };
    if (i === n - 1) return { m: normalOf(dirs[n - 2]!), s: 1 };
    const a = normalOf(dirs[i - 1]!);
    const b = normalOf(dirs[i]!);
    const m = { x: a.x + b.x, y: a.y + b.y };
    const l = Math.hypot(m.x, m.y);
    if (l < 1e-6) throw new Error("Sweep path doubles back on itself");
    const mu = { x: m.x / l, y: m.y / l };
    return { m: mu, s: 1 / Math.max(0.2, mu.x * a.x + mu.y * a.y) };
  });
  const ring = (i: number): V3[] => {
    const { m, s } = mitres[i]!;
    const c = path[i]!;
    return profile.map((q) => at(f, c.x + m.x * q.x * s, c.y + m.y * q.x * s, q.y));
  };
  const rings = path.map((_, i) => ring(i));
  const t = new TriMesh();
  for (let i = 0; i + 1 < n; i++) {
    for (let k = 0; k < profile.length; k++) {
      const k1 = (k + 1) % profile.length;
      t.quad(rings[i]![k]!, rings[i]![k1]!, rings[i + 1]![k1]!, rings[i + 1]![k]!);
    }
  }
  const capAt = (i: number, reverse: boolean) => {
    const idx = earcut(profile.flatMap((q) => [q.x, q.y]));
    for (let j = 0; j < idx.length; j += 3) {
      const [a, b, c] = [rings[i]![idx[j]!]!, rings[i]![idx[j + 1]!]!, rings[i]![idx[j + 2]!]!];
      if (reverse) t.tri(a, c, b);
      else t.tri(a, b, c);
    }
  };
  capAt(0, true);
  capAt(n - 1, false);
  return t.finish();
}

/** Mesh of any family form element, with the given parameter values. */
export function formMesh(el: Element, values: Values): MeshData {
  switch (el.category) {
    case Cat.Extrusion:
      return extrusionMesh(el.params as ExtrusionParams, values);
    case Cat.Blend:
      return blendMesh(el.params as BlendParams, values);
    case Cat.Revolution:
      return revolutionMesh(el.params as RevolutionParams, values);
    case Cat.Sweep:
      return sweepMesh(el.params as SweepParams, values);
  }
  throw new Error(`${el.category} is not a family form`);
}

/** Kernel builder for forms in a family document (uses the current type's values). */
export function buildForm(doc: Document, el: Element): MeshData | null {
  return formMesh(el, familyValues(doc));
}
