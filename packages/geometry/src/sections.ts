import {
  Cat,
  levels,
  toViewCoords,
  viewCrop,
  viewFrame,
  type Document,
  type Element,
  type ElementId,
  type GridParams,
  type Vec2,
  type View,
  type ViewFrame,
  type ViewParams,
  detailContent,
  markerText,
  viewMarkerFamily,
  viewNumber,
  type MarkerRole,
} from "@open-bim/core";
import { GRID_BUBBLE_RADIUS, type LineData } from "./datums.ts";
import { planLinework, type PlanLinework } from "./hlr.ts";
import type { LineFamily } from "./patterns.ts";
import type { MeshData } from "./mesh.ts";

// Sections and elevations reuse the plan HLR: meshes are moved into view coordinates (x along the
// view, y up, z towards the viewer) so "seen from above" becomes "seen from the view head".

export interface Rect {
  min: Vec2;
  max: Vec2;
}

/** Copy of a mesh in view coordinates (a rotation, so winding is kept). */
export function meshToView(mesh: MeshData, f: ViewFrame): MeshData {
  const p = mesh.positions;
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const v = toViewCoords(f, [p[i]!, p[i + 1]!, p[i + 2]!]);
    out[i] = v[0];
    out[i + 1] = v[1];
    out[i + 2] = v[2];
  }
  return { positions: out, normals: mesh.normals, indices: mesh.indices };
}

/** Linework of a section/elevation in drawing coordinates (x along the view, y = absolute Z), cropped. */
export function sectionLinework(items: { id: ElementId; mesh: MeshData; surface?: LineFamily[] | null }[], view: View): PlanLinework[] {
  const f = viewFrame(view);
  const far = view.params.farClip ?? 10_000;
  const lw = planLinework(
    items.map((it) => ({ id: it.id, mesh: meshToView(it.mesh, f), surface: it.surface ?? null })),
    { bottom: -far, cut: 0 },
  );
  return lw.map((l) => cropLinework(l, viewCrop(view))).filter((l) => l.cutLoops.length || l.projection.length || l.surface.length);
}

/** Clip linework to a rectangle: loops by Sutherland–Hodgman, segments by Liang–Barsky. */
export function cropLinework(lw: Omit<PlanLinework, "surface"> & { surface?: number[] }, r: Rect): PlanLinework {
  const cutLoops = lw.cutLoops.map((l) => clipPolygon(l, r)).filter((l) => l.length >= 3);
  const clip = (src: number[]) => {
    const dst: number[] = [];
    for (let i = 0; i < src.length; i += 4) {
      const s = clipSegment(src[i]!, src[i + 1]!, src[i + 2]!, src[i + 3]!, r);
      if (s) dst.push(...s);
    }
    return dst;
  };
  return { id: lw.id, cutLoops, projection: clip(lw.projection), surface: clip(lw.surface ?? []) };
}

function clipPolygon(poly: Vec2[], r: Rect): Vec2[] {
  const edges: [(p: Vec2) => number][] = [
    [(p) => p.x - r.min.x],
    [(p) => r.max.x - p.x],
    [(p) => p.y - r.min.y],
    [(p) => r.max.y - p.y],
  ];
  let out = poly;
  for (const [f] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const p = input[i]!;
      const q = input[(i + 1) % input.length]!;
      const fp = f(p);
      const fq = f(q);
      if (fp >= 0) out.push(p);
      if ((fp >= 0) !== (fq >= 0)) {
        const t = fp / (fp - fq);
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
    if (!out.length) break;
  }
  return out;
}

function clipSegment(x0: number, y0: number, x1: number, y1: number, r: Rect): number[] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  for (const [p, q] of [
    [-dx, x0 - r.min.x],
    [dx, r.max.x - x0],
    [-dy, y0 - r.min.y],
    [dy, r.max.y - y0],
  ] as const) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1];
}

/** Level lines (with names) and grid lines (with bubbles) for a section/elevation, in drawing coords. */
export function sectionAnnotations(doc: Document, view: View): LineData {
  const crop = viewCrop(view);
  const seg: number[] = [];
  const labels: LineData["labels"] = [];
  const line = (a: Vec2, b: Vec2) => seg.push(a.x, a.y, 0, b.x, b.y, 0);
  for (const l of levels(doc)) {
    const y = l.params.elevation;
    if (y < crop.min.y || y > crop.max.y) continue;
    line({ x: crop.min.x - 300, y }, { x: crop.max.x + 300, y });
    labels.push({ text: `${l.name ?? "Level"}  ${Math.round(y)}`, position: [crop.max.x + 400, y + 250, 0], size: 250, align: "left" });
  }
  const r = GRID_BUBBLE_RADIUS;
  for (const g of doc.byCategory<GridParams>(Cat.Grid)) {
    const x = crossing(view, g.params.start, g.params.end);
    if (x === null || x < crop.min.x || x > crop.max.x) continue;
    line({ x, y: crop.min.y }, { x, y: crop.max.y });
    const cy = crop.max.y + r;
    for (let i = 0; i < 32; i++) {
      const a0 = (i / 32) * 2 * Math.PI;
      const a1 = ((i + 1) / 32) * 2 * Math.PI;
      line({ x: x + r * Math.cos(a0), y: cy + r * Math.sin(a0) }, { x: x + r * Math.cos(a1), y: cy + r * Math.sin(a1) });
    }
    labels.push({ text: g.name ?? "", position: [x, cy, 0] });
  }
  return { segments: new Float32Array(seg), labels };
}

/** Where a plan segment crosses a section/elevation line, as distance along the view; null if it doesn't. */
function crossing(view: View, a: Vec2, b: Vec2): number | null {
  const { start, end } = view.params.line!;
  const r = { x: end.x - start.x, y: end.y - start.y };
  const s = { x: b.x - a.x, y: b.y - a.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((a.x - start.x) * s.y - (a.y - start.y) * s.x) / den;
  const u = ((a.x - start.x) * r.y - (a.y - start.y) * r.x) / den;
  if (u < 0 || u > 1) return null;
  return t * Math.hypot(r.x, r.y);
}

/**
 * Plan symbols for views (sized for 1:100):
 * - section: the cut line, a head bubble at the start (name inside, a filled arrow showing which
 *   way it looks) and a tail flag at the end pointing the same way;
 * - elevation: a bubble with the name, and a filled pointer towards what it looks at;
 * - callout: a box with rounded corners and a named head bubble on a short leader.
 */
export function buildViewMarker(doc: Document, el: Element): LineData | null {
  const v = el as View;
  const p = el.params as ViewParams;
  const seg: number[] = [];
  const loops: Vec2[][] = [];
  const line = (a: Vec2, b: Vec2) => seg.push(a.x, a.y, 0, b.x, b.y, 0);
  const poly = (pts: Vec2[], closed = true) => pts.forEach((a, i) => (closed || i < pts.length - 1) && line(a, pts[(i + 1) % pts.length]!));
  const arc = (c: Vec2, r: number, a0: number, a1: number, n = 24): Vec2[] =>
    Array.from({ length: n + 1 }, (_, i) => {
      const t = a0 + ((a1 - a0) * i) / n;
      return { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) };
    });
  const add = (q: Vec2, d: Vec2, k: number): Vec2 => ({ x: q.x + d.x * k, y: q.y + d.y * k });
  /** A line in the view's marker pattern (dashes are paper mm at 1:100). */
  const patterned = (a: Vec2, b: Vec2) => {
    const pat = DASHES[p.markerLine ?? "dash"];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!pat || len < 1) return line(a, b);
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    let t = 0;
    for (let i = 0; t < len; i++) {
      const d = pat[i % pat.length]! * K;
      if (i % 2 === 0) line(add(a, u, t), add(a, u, Math.min(len, t + d)));
      t += d;
    }
  };
  /** A solid bar along a→b (Revit's heavy section line ends). */
  const bar = (a: Vec2, u: Vec2, length: number) => {
    const n = { x: -u.y, y: u.x };
    const w = 0.35 * K;
    const b = add(a, u, length);
    const pts = [add(a, n, w), add(b, n, w), add(b, n, -w), add(a, n, -w)];
    poly(pts);
    loops.push(pts);
  };
  const labels: LineData["labels"] = [];
  const R = 400; // bubble radius
  const TEXT = 230;
  // Bubbles show a short reference, as Revit's do: the view's number ("Section 3" → "3").
  const name = viewNumber(el.name ?? "");
  /** Draw a View Marker family at `o`, its +Y along the view direction and +X along `along`. */
  const family = (role: MarkerRole, o: Vec2, dir: Vec2, along: Vec2): boolean => {
    const def = viewMarkerFamily(doc, v, role);
    if (!def) return false;
    const { lines, regions, texts } = detailContent(def);
    const map = (q: Vec2): Vec2 => ({ x: o.x + (along.x * q.x + dir.x * q.y) * K, y: o.y + (along.y * q.x + dir.y * q.y) * K });
    for (const l of lines) line(map(l.start), map(l.end));
    for (const r of regions) {
      const rings = [r.boundary, ...r.holes].map((ring) => ring.map(map));
      rings.forEach((ring) => poly(ring));
      loops.push(...rings);
    }
    for (const t of texts) {
      const at = map(t.position);
      labels.push({ text: markerText(doc, v, t.text), position: [at.x, at.y, 0], size: t.size * K });
    }
    return true;
  };

  /** Bubble at `c` with a filled pointer towards `dir` (the view direction). */
  const bubble = (c: Vec2, dir: Vec2) => {
    poly(arc(c, R, 0, 2 * Math.PI, 32));
    const side = { x: -dir.y, y: dir.x };
    // Pointer: a filled triangle from the bubble's edge out to a tip in the view direction.
    const tip = add(c, dir, R * 1.75);
    const a = add(add(c, side, R * 0.7), dir, R * 0.71);
    const b = add(add(c, side, -R * 0.7), dir, R * 0.71);
    poly([tip, a, b]);
    loops.push([tip, a, b]);
    labels.push({ text: name, position: [c.x, c.y, 0], size: TEXT });
  };

  if ((p.kind === "section" || p.kind === "elevation") && p.line) {
    const { start, end } = p.line;
    const f = viewFrame(v);
    const dir = { x: f.dir[0], y: f.dir[1] };
    const along = { x: f.right[0], y: f.right[1] };
    if (p.kind === "section") {
      // Heavy bars at both ends, the patterned line between.
      const L = Math.hypot(end.x - start.x, end.y - start.y);
      const ends = Math.min(END * K, L / 3);
      bar(start, along, ends);
      bar(end, { x: -along.x, y: -along.y }, ends);
      patterned(add(start, along, ends), add(end, along, -ends));
      // Head: bubble just beyond the start, on the line (or the head family, origin at the start).
      if (!family("sectionHead", start, dir, along)) bubble(add(start, along, -R), dir);
      // Tail: a short flag showing the view direction.
      if (!family("sectionTail", end, dir, along)) {
        const flag = add(end, dir, R * 1.2);
        line(end, flag);
        loops.push([flag, add(flag, dir, -R * 0.5), add(add(flag, dir, -R * 0.25), along, R * 0.45)]);
      }
    } else {
      const m = p.marker ?? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      if (!family("elevation", m, dir, along)) bubble(m, dir);
    }
  } else if (p.kind === "callout" && p.crop) {
    const { min, max } = p.crop;
    const r = Math.min(400, (max.x - min.x) / 4, (max.y - min.y) / 4);
    const box = [
      ...arc({ x: max.x - r, y: min.y + r }, r, -Math.PI / 2, 0, 6),
      ...arc({ x: max.x - r, y: max.y - r }, r, 0, Math.PI / 2, 6),
      ...arc({ x: min.x + r, y: max.y - r }, r, Math.PI / 2, Math.PI, 6),
      ...arc({ x: min.x + r, y: min.y + r }, r, Math.PI, (3 * Math.PI) / 2, 6),
    ];
    box.forEach((a, i) => patterned(a, box[(i + 1) % box.length]!));
    // Head bubble off the top-right corner on a solid leader with a shoulder.
    const corner = { x: max.x - r * 0.3, y: max.y - r * 0.3 };
    const c = { x: max.x + R * 3.2, y: max.y + R * 1.8 };
    const shoulder = { x: c.x - R * 1.6, y: c.y };
    line(corner, shoulder);
    line(shoulder, { x: c.x - R, y: c.y });
    if (!family("calloutHead", c, { x: 0, y: 1 }, { x: 1, y: 0 })) {
      poly(arc(c, R, 0, 2 * Math.PI, 32));
      labels.push({ text: name, position: [c.x, c.y, 0], size: TEXT });
    }
  } else {
    return null;
  }
  return { segments: new Float32Array(seg), labels, planOnly: true, ...(loops.length ? { fill: { loops, color: 0x111111, opaque: true } } : {}) };
}

/** Marker families are drawn in paper mm; the built-in marks are sized for 1:100. */
const K = 100;
/** Length of the heavy bars at a section line's ends, paper mm. */
const END = 6;
/** Dash patterns, paper mm: on, off, on, off… (solid draws one line). */
const DASHES: Record<string, number[] | null> = { solid: null, dash: [4, 2], dot: [0.6, 1.4], dashDot: [6, 1.5, 0.6, 1.5], longDash: [9, 2.5] };
