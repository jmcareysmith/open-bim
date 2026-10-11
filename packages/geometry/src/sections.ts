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
} from "@open-bim/core";
import { GRID_BUBBLE_RADIUS, type LineData } from "./datums.ts";
import { planLinework, type PlanLinework } from "./hlr.ts";
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
export function sectionLinework(items: { id: ElementId; mesh: MeshData }[], view: View): PlanLinework[] {
  const f = viewFrame(view);
  const far = view.params.farClip ?? 10_000;
  const lw = planLinework(
    items.map((it) => ({ id: it.id, mesh: meshToView(it.mesh, f) })),
    { bottom: -far, cut: 0 },
  );
  return lw.map((l) => cropLinework(l, viewCrop(view))).filter((l) => l.cutLoops.length || l.projection.length);
}

/** Clip linework to a rectangle: loops by Sutherland–Hodgman, segments by Liang–Barsky. */
export function cropLinework(lw: PlanLinework, r: Rect): PlanLinework {
  const cutLoops = lw.cutLoops.map((l) => clipPolygon(l, r)).filter((l) => l.length >= 3);
  const projection: number[] = [];
  for (let i = 0; i < lw.projection.length; i += 4) {
    const s = clipSegment(lw.projection[i]!, lw.projection[i + 1]!, lw.projection[i + 2]!, lw.projection[i + 3]!, r);
    if (s) projection.push(...s);
  }
  return { id: lw.id, cutLoops, projection };
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

/** Plan symbols for views: section lines with heads, elevation markers, callout boxes. */
export function buildViewMarker(doc: Document, el: Element): LineData | null {
  const v = el as View;
  const p = el.params as ViewParams;
  const seg: number[] = [];
  const line = (a: Vec2, b: Vec2) => seg.push(a.x, a.y, 0, b.x, b.y, 0);
  const circle = (c: Vec2, rad: number) => {
    for (let i = 0; i < 24; i++) {
      const a0 = (i / 24) * 2 * Math.PI;
      const a1 = ((i + 1) / 24) * 2 * Math.PI;
      line({ x: c.x + rad * Math.cos(a0), y: c.y + rad * Math.sin(a0) }, { x: c.x + rad * Math.cos(a1), y: c.y + rad * Math.sin(a1) });
    }
  };
  const labels: LineData["labels"] = [];
  if ((p.kind === "section" || p.kind === "elevation") && p.line) {
    const { start, end } = p.line;
    const f = viewFrame(v);
    const dir = { x: f.dir[0], y: f.dir[1] };
    const along = { x: f.right[0], y: f.right[1] };
    const head = 350;
    if (p.kind === "section") {
      line(start, end);
      // Head bubble before the start, with the view-direction arrow.
      const c = { x: start.x - along.x * head, y: start.y - along.y * head };
      circle(c, head);
      const tip = { x: c.x + dir.x * head * 2, y: c.y + dir.y * head * 2 };
      line({ x: c.x + along.x * head, y: c.y + along.y * head }, tip);
      line({ x: c.x - along.x * head, y: c.y - along.y * head }, tip);
      labels.push({ text: el.name ?? "", position: [c.x, c.y, 0], size: 220 });
    } else {
      // Elevation marker at the line's midpoint: circle with a pointer towards the building.
      const m = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      circle(m, head);
      const tip = { x: m.x + dir.x * head * 1.8, y: m.y + dir.y * head * 1.8 };
      line({ x: m.x + along.x * head, y: m.y + along.y * head }, tip);
      line({ x: m.x - along.x * head, y: m.y - along.y * head }, tip);
      labels.push({ text: el.name ?? "", position: [m.x - dir.x * head * 1.9, m.y - dir.y * head * 1.9, 0], size: 220 });
    }
  } else if (p.kind === "callout" && p.crop) {
    const { min, max } = p.crop;
    line(min, { x: max.x, y: min.y });
    line({ x: max.x, y: min.y }, max);
    line(max, { x: min.x, y: max.y });
    line({ x: min.x, y: max.y }, min);
    labels.push({ text: el.name ?? "", position: [min.x, max.y + 300, 0], size: 220, align: "left" });
  } else {
    return null;
  }
  return { segments: new Float32Array(seg), labels, planOnly: true, dashed: p.kind === "callout" };
}
