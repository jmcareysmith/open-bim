import {
  classificationInfo,
  evaluate,
  familyValues,
  type ConnectorParams,
  type Num,
  wallCuts,
  wallDirection,
  wallThickness,
  type Document,
  type Element,
  type Grid,
  type HostedParams,
  type ReferencePlane,
  type Vec2,
  type Wall,
} from "@open-bim/core";

/** Line work for datums and annotation, model mm, Z up. */
export interface LineData {
  /** Segment pairs: [x0, y0, z0, x1, y1, z1, …]. */
  segments: Float32Array;
  /** Text; `size` is the text height in mm (default fits a grid bubble), `align` its anchor. */
  labels: { text: string; position: [number, number, number]; size?: number; align?: "center" | "left" }[];
  /** Draw dashed (reference planes) rather than solid. */
  dashed?: boolean;
  /**
   * "workplane" (default): drawn at z = 0 and placed on the active level by the view (datums).
   * "model": coordinates are absolute model space (e.g. opening outlines).
   */
  placement?: "workplane" | "model";
  /** Only drawn in plan views (e.g. door swings). */
  planOnly?: boolean;
  /** Filled areas (filled regions), as loops with even-odd nesting. */
  fill?: { loops: Vec2[][]; color: number; /** Solid (symbols, markers) rather than translucent (filled regions). */ opaque?: boolean };
}

/** Grid head (bubble) radius, mm. ~8 mm on paper at 1:100. */
export const GRID_BUBBLE_RADIUS = 400;
const BUBBLE_SEGMENTS = 32;

/**
 * Grid line with a labelled bubble beyond each end, drawn at z = 0.
 * Grids span every level, so the view places them at the level it shows.
 */
/** Grid: sizes are for 1:100 and scale with the view (`scale` = n of 1:n), as Revit's do. */
export function buildGridLines(_doc: Document, el: Element, scale = 100): LineData {
  const g = el as Grid;
  const { start, end } = g.params;
  const len = Math.hypot(end.x - start.x, end.y - start.y);
  const ux = (end.x - start.x) / len;
  const uy = (end.y - start.y) / len;
  const k = scale / 100;
  const r = GRID_BUBBLE_RADIUS * k;
  // Dash-dot-dash centre line with short solid ends at the bubbles (Revit's default grid).
  const seg: number[] = [];
  const at = (t: number) => [start.x + ux * t, start.y + uy * t, 0];
  const ends = len > 4 * GRID_END * k ? GRID_END * k : 0;
  if (ends) seg.push(...at(0), ...at(ends), ...at(len - ends), ...at(len));
  let t = ends;
  for (let i = 0; t < len - ends; i++) {
    const d = GRID_DASH[i % GRID_DASH.length]! * k;
    if (i % 2 === 0) seg.push(...at(t), ...at(Math.min(len - ends, t + d)));
    t += d;
  }
  const labels: LineData["labels"] = [];
  for (const [p, s] of [
    [start, -1],
    [end, 1],
  ] as const) {
    const cx = p.x + ux * r * s;
    const cy = p.y + uy * r * s;
    for (let i = 0; i < BUBBLE_SEGMENTS; i++) {
      const a0 = (i / BUBBLE_SEGMENTS) * 2 * Math.PI;
      const a1 = ((i + 1) / BUBBLE_SEGMENTS) * 2 * Math.PI;
      seg.push(cx + r * Math.cos(a0), cy + r * Math.sin(a0), 0, cx + r * Math.cos(a1), cy + r * Math.sin(a1), 0);
    }
    labels.push({ text: g.name ?? "", position: [cx, cy, 0], ...(k !== 1 ? { size: r * 0.75 } : {}) });
  }
  return { segments: new Float32Array(seg), labels };
}

/** Grid line pattern, model mm (paper mm × 100): dash, gap, dot, gap. */
const GRID_DASH = [600, 150, 60, 150];
/** Solid length at each end of a grid line, model mm. */
const GRID_END = 500;

/** Reference plane: dashed line at z = 0; its name, if any, labels the end. */
export function buildReferencePlaneLines(_doc: Document, el: Element, scale = 100): LineData {
  const { start, end } = (el as ReferencePlane).params;
  const labels: LineData["labels"] = [];
  if (el.name) {
    const len = Math.hypot(end.x - start.x, end.y - start.y);
    const off = (REF_PLANE_LABEL_OFFSET * scale) / 100 / len;
    labels.push({ text: el.name, position: [end.x + (end.x - start.x) * off, end.y + (end.y - start.y) * off, 0] });
  }
  return { segments: new Float32Array([start.x, start.y, 0, end.x, end.y, 0]), labels, dashed: true };
}

const REF_PLANE_LABEL_OFFSET = 300; // mm beyond the end

/** Outline of a wall opening on both wall faces, so it can be seen and picked. */
export function buildOpeningLines(doc: Document, el: Element): LineData | null {
  const host = doc.get(((el.params as HostedParams).hostId)) as Wall | undefined;
  if (!host) return null;
  const cut = wallCuts(doc, host).find((c) => c.id === el.id);
  if (!cut) return null;
  const d = wallDirection(host);
  const n = { x: -d.y, y: d.x };
  const h = wallThickness(doc, host) / 2;
  const { start } = host.params;
  const seg: number[] = [];
  for (const s of [-1, 1]) {
    const at = (u: number, z: number) => [start.x + d.x * u + n.x * h * s, start.y + d.y * u + n.y * h * s, z];
    const corners = [at(cut.u0, cut.z0), at(cut.u1, cut.z0), at(cut.u1, cut.z1), at(cut.u0, cut.z1)];
    corners.forEach((c, i) => seg.push(...c, ...corners[(i + 1) % 4]!));
  }
  return { segments: new Float32Array(seg), labels: [], placement: "model" };
}

/**
 * Family editor: a connector as a circle the size of the duct or pipe (electrical: 150 mm) with an
 * arrow the way it faces (a cross when it faces up or down).
 */
export function buildConnectorLines(doc: Document, el: Element): LineData | null {
  const values = familyValues(doc);
  const p = el.params as ConnectorParams;
  const num = (n: Num) => {
    try {
      return evaluate(n, values);
    } catch {
      return 0;
    }
  };
  const x = num(p.x);
  const y = num(p.y);
  const z = num(p.z);
  const domain = classificationInfo(p.classification).domain;
  const r = domain === "electrical" ? 75 : Math.max(25, (p.shape === "round" ? num(p.diameter) : Math.max(num(p.width), num(p.height))) / 2);
  const seg: number[] = [];
  const n = 32;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * 2 * Math.PI;
    const a1 = ((i + 1) / n) * 2 * Math.PI;
    seg.push(x + r * Math.cos(a0), y + r * Math.sin(a0), z, x + r * Math.cos(a1), y + r * Math.sin(a1), z);
  }
  const d = { "+x": [1, 0], "-x": [-1, 0], "+y": [0, 1], "-y": [0, -1] }[p.facing as "+x"] as [number, number] | undefined;
  if (d) {
    const tip = [x + d[0] * r * 2, y + d[1] * r * 2];
    seg.push(x, y, z, tip[0]!, tip[1]!, z);
    const back = 0.5 * r;
    const nx = -d[1];
    const ny = d[0];
    seg.push(tip[0]!, tip[1]!, z, tip[0]! - d[0] * back + nx * back * 0.6, tip[1]! - d[1] * back + ny * back * 0.6, z);
    seg.push(tip[0]!, tip[1]!, z, tip[0]! - d[0] * back - nx * back * 0.6, tip[1]! - d[1] * back - ny * back * 0.6, z);
  } else {
    const k = r * 0.7;
    seg.push(x - k, y - k, z, x + k, y + k, z, x - k, y + k, z, x + k, y - k, z);
  }
  return { segments: new Float32Array(seg), labels: [{ text: classificationInfo(p.classification).prefix, position: [x, y - r - 60, z], size: 60 }], placement: "model" };
}
