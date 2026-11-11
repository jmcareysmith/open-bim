import type { Vec2 } from "../element.ts";

// Weighted straight skeleton for footprint roofs (Revit's roof by footprint): every eave line moves
// inwards as the roof rises, at 1/tan(slope) mm per mm of height (gable edges, with no slope,
// stay put). Simulating that shrinking outline gives each sloped edge its exact face, for any
// simple footprint: an edge whose neighbours meet over it disappears (edge event); a reflex
// corner running into another edge splits the outline in two (split event). Time here is height.
//
// `skeletonFaces` returns each edge's face (counter-clockwise, plan mm), or null when the
// footprint has a case this solver doesn't handle (callers fall back to wedge planes).

type Arc = { a: Vec2; b: Vec2; edges: [number, number] };

interface Vert {
  /** Position at time t0, and velocity (mm per unit height). */
  p: Vec2;
  t0: number;
  s: Vec2;
  /** Edge before (incoming) and after (outgoing) this vertex. */
  eL: number;
  eR: number;
  prev: Vert;
  next: Vert;
  alive: boolean;
  /** Antiparallel neighbours (a ridge forming): may not move on. */
  stuck: boolean;
}

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
const at = (v: Vert, t: number): Vec2 => add(v.p, mul(v.s, t - v.t0));

class Fail extends Error {}

/**
 * The face of each edge of a counter-clockwise footprint under per-edge slopes (radians, null for
 * a gable), or null if it can't be worked out. Gable edges get no face (an empty array).
 */
export function skeletonFaces(boundary: Vec2[], slopes: (number | null)[]): Vec2[][] | null {
  const n = boundary.length;
  if (n < 3 || slopes.length < n) return null;
  if (slopes.slice(0, n).every((s) => s === null)) return boundary.map(() => []);
  const dirs: Vec2[] = [];
  const normals: Vec2[] = [];
  const offsets: number[] = [];
  const speeds: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = boundary[i]!;
    const d = sub(boundary[(i + 1) % n]!, a);
    const l = Math.hypot(d.x, d.y);
    if (l < 1e-6) return null;
    dirs.push(mul(d, 1 / l));
    const nrm = { x: -d.y / l, y: d.x / l };
    normals.push(nrm);
    offsets.push(dot(nrm, a));
    const s = slopes[i];
    if (s === null || s === undefined) speeds.push(0);
    else {
      const k = Math.tan(s);
      if (!(k > 1e-9)) return null;
      speeds.push(1 / k);
    }
  }
  const scale = Math.max(1, ...boundary.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
  const eps = scale * 1e-9;

  /** Velocity of a vertex between edges l and r (where their moving lines meet). */
  const velocity = (l: number, r: number): { s: Vec2; stuck: boolean } => {
    const a = normals[l]!;
    const b = normals[r]!;
    const det = cross(a, b);
    if (Math.abs(det) < 1e-9) {
      if (dot(a, b) > 0) {
        // Collinear edges: the vertex moves with them (if they move alike).
        if (Math.abs(speeds[l]! - speeds[r]!) > 1e-9) throw new Fail();
        return { s: mul(a, speeds[l]!), stuck: false };
      }
      return { s: { x: 0, y: 0 }, stuck: true };
    }
    // a·s = wl, b·s = wr.
    const wl = speeds[l]!;
    const wr = speeds[r]!;
    return { s: { x: (wl * b.y - wr * a.y) / det, y: (a.x * wr - b.x * wl) / det }, stuck: false };
  };

  const arcs: Arc[] = [];
  const end = (v: Vert, q: Vec2, t: number) => {
    v.alive = false;
    arcs.push({ a: at(v, v.t0), b: q, edges: [v.eL, v.eR] });
    void t;
  };
  const make = (p: Vec2, t: number, eL: number, eR: number): Vert => {
    const { s, stuck } = velocity(eL, eR);
    const v = { p, t0: t, s, eL, eR, alive: true, stuck } as Vert;
    return v;
  };

  try {
    // The starting outline.
    const verts: Vert[] = boundary.map((p, i) => make(p, 0, (i - 1 + n) % n, i));
    verts.forEach((v, i) => {
      v.prev = verts[(i - 1 + n) % n]!;
      v.next = verts[(i + 1) % n]!;
    });
    let loops: Vert[] = [verts[0]!];
    let now = 0;
    const loopOf = (start: Vert): Vert[] => {
      const out: Vert[] = [];
      let v = start;
      do {
        out.push(v);
        v = v.next;
        if (out.length > 4 * n + 8) throw new Fail();
      } while (v !== start);
      return out;
    };

    for (let guard = 0; guard < 20 * n + 50; guard++) {
      // Loops of one or two vertices finish: two meet along a ridge.
      const live: Vert[] = [];
      for (const start of loops) {
        const vs = loopOf(start);
        if (vs.length >= 3) {
          live.push(start);
          continue;
        }
        if (vs.length === 2) {
          const [u, w] = vs as [Vert, Vert];
          const pu = at(u, now);
          const pw = at(w, now);
          end(u, pu, now);
          end(w, pw, now);
          if (Math.hypot(pu.x - pw.x, pu.y - pw.y) > eps) arcs.push({ a: pu, b: pw, edges: [u.eL, u.eR] });
        } else for (const v of vs) end(v, at(v, now), now);
      }
      loops = live;
      if (!loops.length) break;

      // Next event over every loop.
      let best: { t: number; kind: "edge"; a: Vert } | { t: number; kind: "split"; v: Vert; x: Vert } | null = null;
      for (const start of loops) {
        const vs = loopOf(start);
        for (const a of vs) {
          // Edge event: a and a.next meet (their edge shrinks to nothing).
          const b = a.next;
          const d = dirs[a.eR]!;
          const f0 = dot(sub(at(b, now), at(a, now)), d);
          const f1 = dot(sub(b.s, a.s), d);
          let t = Infinity;
          if (f0 <= eps) t = now;
          else if (f1 < -1e-12) t = now - f0 / f1;
          if (t < (best?.t ?? Infinity) - 1e-9) best = { t, kind: "edge", a };
        }
        for (const v of vs) {
          // Split event: a reflex vertex runs into an edge of its loop.
          if (v.stuck || cross(dirs[v.eL]!, dirs[v.eR]!) >= -1e-9) continue;
          for (const x of vs) {
            const e = x.eR;
            const y = x.next;
            if (x === v || y === v || e === v.eL || e === v.eR) continue;
            const g0 = dot(normals[e]!, at(v, now)) - offsets[e]! - speeds[e]! * now;
            const g1 = dot(normals[e]!, v.s) - speeds[e]!;
            if (g1 >= -1e-12) continue;
            const t = now - g0 / g1;
            if (t < now - 1e-9 || t >= (best?.t ?? Infinity) - 1e-9) continue;
            const h = at(v, t);
            const d = dirs[e]!;
            if (dot(sub(h, at(x, t)), d) < -eps * 1e3 || dot(sub(at(y, t), h), d) < -eps * 1e3) continue;
            best = { t, kind: "split", v, x };
          }
        }
      }
      if (!best || !Number.isFinite(best.t)) throw new Fail();
      const t = Math.max(now, best.t);
      // A stuck vertex can only wait for its partner at the same moment.
      for (const start of loops) for (const v of loopOf(start)) if (v.stuck && t > now + 1e-6 * scale) throw new Fail();
      now = t;

      if (best.kind === "edge") {
        const a = best.a;
        const b = a.next;
        const loop = loops.indexOf(loops.find((s) => loopOf(s).includes(a))!);
        const q = mul(add(at(a, now), at(b, now)), 0.5);
        if (b.next === a.prev && a.prev.prev === b) {
          const c = a.prev;
          const pc = at(c, now);
          if (Math.hypot(pc.x - q.x, pc.y - q.y) <= 1e-6 * scale) {
            // Triangle: all three meet at one point.
            for (const v of [a, b, c]) end(v, q, now);
            loops.splice(loop, 1);
            continue;
          }
        }
        end(a, q, now);
        end(b, q, now);
        const v = make(q, now, a.eL, b.eR);
        v.prev = a.prev;
        v.next = b.next;
        a.prev.next = v;
        b.next.prev = v;
        loops[loop] = v;
      } else {
        const { v, x } = best;
        const y = x.next;
        const e = x.eR;
        const q = at(v, now);
        const loop = loops.indexOf(loops.find((s) => loopOf(s).includes(v))!);
        end(v, q, now);
        // Two outlines: …P → V1 → Y… and …X → V2 → N….
        const v1 = make(q, now, v.eL, e);
        const v2 = make(q, now, e, v.eR);
        v1.prev = v.prev;
        v1.next = y;
        v.prev.next = v1;
        y.prev = v1;
        v2.prev = x;
        v2.next = v.next;
        x.next = v2;
        v.next.prev = v2;
        loops.splice(loop, 1, v1, v2);
      }
    }
    if (loops.length) throw new Fail();
  } catch (err) {
    if (err instanceof Fail) return null;
    throw err;
  }

  // Each sloped edge's face: its eave plus the arcs it bounds, walked round from the eave's end.
  const key = (p: Vec2) => `${Math.round(p.x * 1e3)},${Math.round(p.y * 1e3)}`;
  const faces: Vec2[][] = [];
  let total = 0;
  for (let e = 0; e < n; e++) {
    if (speeds[e] === 0) {
      faces.push([]);
      continue;
    }
    const pts = new Map<string, Vec2>();
    const adj = new Map<string, Set<string>>();
    const link = (a: Vec2, b: Vec2) => {
      const ka = key(a);
      const kb = key(b);
      if (ka === kb) return;
      pts.set(ka, a);
      pts.set(kb, b);
      if (!adj.has(ka)) adj.set(ka, new Set());
      if (!adj.has(kb)) adj.set(kb, new Set());
      adj.get(ka)!.add(kb);
      adj.get(kb)!.add(ka);
    };
    const a0 = boundary[e]!;
    const b0 = boundary[(e + 1) % n]!;
    link(a0, b0);
    for (const arc of arcs) if (arc.edges[0] === e || arc.edges[1] === e) link(arc.a, arc.b);
    const poly: Vec2[] = [a0];
    let prev = key(a0);
    let cur = key(b0);
    for (let step = 0; cur !== key(a0); step++) {
      if (step > 4 * arcs.length + 8) return null;
      const here = pts.get(cur)!;
      poly.push(here);
      const u = sub(here, pts.get(prev)!);
      let pick: string | null = null;
      let bestAng = -Infinity;
      for (const k of adj.get(cur) ?? []) {
        if (k === prev) continue;
        const w = sub(pts.get(k)!, here);
        const ang = Math.atan2(cross(u, w), dot(u, w));
        if (ang > bestAng) [pick, bestAng] = [k, ang];
      }
      if (!pick) return null;
      prev = cur;
      cur = pick;
    }
    let area = 0;
    poly.forEach((p, i) => (area += cross(p, poly[(i + 1) % poly.length]!)));
    if (area <= 0) return null;
    total += area / 2;
    faces.push(poly);
  }
  // The faces must tile the footprint (gable faces have none).
  let foot = 0;
  boundary.forEach((p, i) => (foot += cross(p, boundary[(i + 1) % n]!)));
  if (Math.abs(total - foot / 2) > 1e-3 * Math.abs(foot / 2)) return null;
  return faces;
}
