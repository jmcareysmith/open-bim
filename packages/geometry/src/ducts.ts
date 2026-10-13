import {
  Cat,
  ductEnds,
  ductInward,
  ductShape,
  fittingTrim,
  fittingsOf,
  type Document,
  type Duct,
  type DuctFitting,
  type Element,
  type LevelParams,
  type P3,
  type DetailLevel,
} from "@open-bim/core";
import type { LineData } from "./datums.ts";
import { MeshBuilder, type MeshData } from "./mesh.ts";

// Duct and fitting solids. A duct is a tube between its ends, taken back where a fitting joins
// it; elbows and transitions sweep a section along a curve through the joint (blending size and
// shape), tees and crosses are stubs from the joint to each duct.

/** Run categories (ducts, pipes, cable trays, conduit) and their fittings. */
const RUN_CATEGORIES = new Set<string>([Cat.Duct, Cat.Pipe, Cat.CableTray, Cat.Conduit]);
const FITTING_CATEGORIES = new Set<string>([Cat.DuctFitting, Cat.PipeFitting, Cat.CableTrayFitting, Cat.ConduitFitting]);

/** Points round a section (round or rectangular), the same count either way so they can blend. */
const RING = 24;

type Section = { shape: "round" | "rectangular"; d: number; w: number; h: number };

const sub = (a: P3, b: P3): P3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: P3, b: P3): P3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul = (a: P3, k: number): P3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: P3, b: P3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: P3, b: P3): P3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (a: P3): P3 => mul(a, 1 / (Math.hypot(a.x, a.y, a.z) || 1));

/** Section frame for a run along `t`: u across (level), v up. */
function frame(t: P3): { u: P3; v: P3 } {
  const ref = Math.abs(t.z) < 0.99 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const v = unit(sub(ref, mul(t, dot(t, ref))));
  return { u: cross(v, t), v };
}

/** Section outline in (u, v) coordinates, RING points anticlockwise. */
function outline(s: Section): [number, number][] {
  if (s.shape === "round") {
    const r = s.d / 2;
    return Array.from({ length: RING }, (_, i) => {
      const a = (i / RING) * 2 * Math.PI;
      return [r * Math.cos(a), r * Math.sin(a)];
    });
  }
  // Rectangle walked by angle from the centre, so points line up with a round section's.
  const hw = s.w / 2;
  const hh = s.h / 2;
  return Array.from({ length: RING }, (_, i) => {
    const a = (i / RING) * 2 * Math.PI;
    const c = Math.cos(a);
    const n = Math.sin(a);
    const k = Math.min(hw / Math.max(1e-9, Math.abs(c)), hh / Math.max(1e-9, Math.abs(n)));
    return [c * k, n * k];
  });
}

function ring(centre: P3, t: P3, a: Section, b: Section = a, blend = 0): P3[] {
  const { u, v } = frame(unit(t));
  const oa = outline(a);
  const ob = outline(b);
  return oa.map((pa, i) => {
    const pb = ob[i]!;
    const x = pa[0] + (pb[0] - pa[0]) * blend;
    const y = pa[1] + (pb[1] - pa[1]) * blend;
    return add(centre, add(mul(u, x), mul(v, y)));
  });
}

/** A closed tube through successive rings (sides plus end caps). */
function tube(m: MeshBuilder, rings: P3[][]): void {
  const tri = (a: P3, b: P3, c: P3) => {
    const n = cross(sub(b, a), sub(c, a));
    const l = Math.hypot(n.x, n.y, n.z);
    if (l < 1e-9) return;
    m.face([[a.x, a.y, a.z], [b.x, b.y, b.z], [c.x, c.y, c.z]], [0, 1, 2], [n.x / l, n.y / l, n.z / l]);
  };
  for (let k = 0; k + 1 < rings.length; k++) {
    const r0 = rings[k]!;
    const r1 = rings[k + 1]!;
    for (let i = 0; i < RING; i++) {
      const j = (i + 1) % RING;
      tri(r0[i]!, r0[j]!, r1[j]!);
      tri(r0[i]!, r1[j]!, r1[i]!);
    }
  }
  const cap = (r: P3[], flip: boolean) => {
    const c = mul(r.reduce((s, p) => add(s, p), { x: 0, y: 0, z: 0 }), 1 / r.length);
    for (let i = 0; i < RING; i++) {
      const j = (i + 1) % RING;
      if (flip) tri(c, r[j]!, r[i]!);
      else tri(c, r[i]!, r[j]!);
    }
  };
  cap(rings[0]!, true);
  cap(rings.at(-1)!, false);
}

function section(doc: Document, d: Duct): Section {
  // Pipes are round at their nominal size.
  if (d.category === Cat.Pipe || d.category === Cat.Conduit) return { shape: "round", d: d.params.diameter, w: 0, h: 0 };
  if (d.category === Cat.CableTray) return { shape: "rectangular", d: 0, w: d.params.width, h: d.params.height };
  return { shape: ductShape(doc, d), d: d.params.diameter, w: d.params.width, h: d.params.height };
}

/** How far each end of a duct is taken back for fittings there. */
function trims(doc: Document, d: Duct): { start: number; end: number } {
  const out = { start: 0, end: 0 };
  for (const f of fittingsOf(doc, d.id)) for (const e of f.params.ends) if (e.ductId === d.id) out[e.end] = Math.max(out[e.end], fittingTrim(doc, f, d.id));
  return out;
}

/** The section rings a duct's tube runs through (trimmed for fittings), or null if nothing's left. */
function ductRings(doc: Document, d: Duct): P3[][] | null {
  const { start, end } = ductEnds(doc, d);
  const t = unit(sub(end, start));
  const L = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  const tr = trims(doc, d);
  if (tr.start + tr.end >= L - 1) return null;
  const s = section(doc, d);
  return [ring(add(start, mul(t, tr.start)), t, s), ring(sub(end, mul(t, tr.end)), t, s)];
}

export function buildDuct(doc: Document, el: Element): MeshData | null {
  const rings = ductRings(doc, el as Duct);
  if (!rings) return null;
  const m = new MeshBuilder();
  tube(m, rings);
  return m.build();
}

export function buildDuctFitting(doc: Document, el: Element): MeshData | null {
  const tubes = fittingTubes(doc, el as DuctFitting);
  if (!tubes) return null;
  const m = new MeshBuilder();
  for (const t of tubes) tube(m, t);
  return m.build();
}

/** The fitting's tubes as rings: one swept tube (elbow, transition) or a stub per duct (tee, cross). */
function fittingTubes(doc: Document, f: DuctFitting): P3[][][] | null {
  const J = f.params.point;
  const ends = f.params.ends.flatMap((e) => {
    const d = doc.get(e.ductId) as Duct | undefined;
    if (!d || !RUN_CATEGORIES.has(d.category)) return [];
    const inward = ductInward(doc, d, e.end);
    return [{ s: section(doc, d), inward, p: add(J, mul(inward, fittingTrim(doc, f, d.id))) }];
  });
  if (ends.length < 2) return null;
  if (f.params.kind === "elbow" || f.params.kind === "transition") {
    // Sweep from one duct's trimmed end to the other's along a curve through the joint.
    const [a, b] = ends as [(typeof ends)[0], (typeof ends)[0]];
    const steps = f.params.kind === "elbow" ? 10 : 1;
    const rings: P3[][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Quadratic Bezier a.p → J → b.p and its tangent.
      const pos = add(add(mul(a.p, (1 - t) ** 2), mul(J, 2 * (1 - t) * t)), mul(b.p, t * t));
      const tan = add(mul(sub(J, a.p), 2 * (1 - t)), mul(sub(b.p, J), 2 * t));
      rings.push(ring(pos, tan, a.s, b.s, t));
    }
    return [rings];
  }
  // Tee / cross: a stub from the joint out to each duct.
  return ends.map((e) => [ring(J, e.inward, e.s), ring(e.p, e.inward, e.s)]);
}

/**
 * Plan outline of tubes: each section's widest points across the run joined along it, plus the
 * ends; a vertical run (riser) shows its section. Drawn just above the level, like beams, so the
 * plans of that level show ducts whatever height they run at.
 */
function planOutline(tubes: P3[][][], z: number): number[] {
  const seg: number[] = [];
  const line = (a: P3, b: P3) => seg.push(a.x, a.y, z, b.x, b.y, z);
  for (const rings of tubes) {
    const c0 = centre(rings[0]!);
    const c1 = centre(rings.at(-1)!);
    const horiz = Math.hypot(c1.x - c0.x, c1.y - c0.y);
    if (horiz < 1e-3 * Math.max(1, Math.abs(c1.z - c0.z)) || rings.length < 2) {
      const r = rings[0]!;
      r.forEach((p, i) => line(p, r[(i + 1) % r.length]!));
      continue;
    }
    const sides = rings.map((r, k) => {
      const next = rings[Math.min(k + 1, rings.length - 1)]!;
      const prev = rings[Math.max(k - 1, 0)]!;
      const a = centre(prev);
      const b = centre(next);
      const n = unit({ x: -(b.y - a.y), y: b.x - a.x, z: 0 });
      const c = centre(r);
      let lo = r[0]!;
      let hi = r[0]!;
      for (const p of r) {
        const d = (p.x - c.x) * n.x + (p.y - c.y) * n.y;
        if (d < (lo.x - c.x) * n.x + (lo.y - c.y) * n.y) lo = p;
        if (d > (hi.x - c.x) * n.x + (hi.y - c.y) * n.y) hi = p;
      }
      return { lo, hi };
    });
    for (let k = 0; k + 1 < sides.length; k++) {
      line(sides[k]!.lo, sides[k + 1]!.lo);
      line(sides[k]!.hi, sides[k + 1]!.hi);
    }
    line(sides[0]!.lo, sides[0]!.hi);
    line(sides.at(-1)!.lo, sides.at(-1)!.hi);
  }
  return seg;
}

const centre = (r: P3[]): P3 => mul(r.reduce((s, p) => add(s, p), { x: 0, y: 0, z: 0 }), 1 / r.length);

const levelZ = (doc: Document, d: Duct) => (doc.get<LevelParams>(d.params.levelId)?.params.elevation ?? 0) + 1;

export function buildDuctLines(doc: Document, el: Element, _scale = 100, detail: DetailLevel = "medium"): LineData | null {
  const d = el as Duct;
  if (detail === "coarse") {
    // Coarse: one line down the middle of the run (Revit's single-line ducts and pipes).
    const { start, end } = ductEnds(doc, d);
    const z = levelZ(doc, d);
    return { segments: new Float32Array([start.x, start.y, z, end.x, end.y, z]), labels: [], planOnly: true, placement: "model" };
  }
  const rings = ductRings(doc, d);
  if (!rings) return null;
  return { segments: new Float32Array(planOutline([rings], levelZ(doc, d))), labels: [], planOnly: true, placement: "model" };
}

export function buildDuctFittingLines(doc: Document, el: Element, _scale = 100, detail: DetailLevel = "medium"): LineData | null {
  if (detail === "coarse") return null; // the runs' centrelines meet at the joint
  const f = el as DuctFitting;
  const tubes = fittingTubes(doc, f);
  const first = doc.get(f.params.ends[0]?.ductId ?? "") as Duct | undefined;
  if (!tubes || !first) return null;
  return { segments: new Float32Array(planOutline(tubes, levelZ(doc, first))), labels: [], planOnly: true, placement: "model" };
}

/** Runs and their fittings (ducts, pipes, trays, conduit): single-line at Coarse. */
export const isRunCategory = (c: string) => RUN_CATEGORIES.has(c) || FITTING_CATEGORIES.has(c);

/** The level whose plans show a duct's, pipe's or fitting's outline. */
export function ductPlanLevel(doc: Document, el: Element): string | undefined {
  if (RUN_CATEGORIES.has(el.category)) return (el as Duct).params.levelId;
  if (FITTING_CATEGORIES.has(el.category)) return (doc.get((el as DuctFitting).params.ends[0]?.ductId ?? "") as Duct | undefined)?.params.levelId;
  return undefined;
}
