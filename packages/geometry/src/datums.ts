import {
  wallCuts,
  wallDirection,
  wallThickness,
  type Document,
  type Element,
  type Grid,
  type HostedParams,
  type ReferencePlane,
  type Wall,
} from "@open-bim/core";

/** Line work for datums and annotation, model mm, Z up. */
export interface LineData {
  /** Segment pairs: [x0, y0, z0, x1, y1, z1, …]. */
  segments: Float32Array;
  labels: { text: string; position: [number, number, number] }[];
  /** Draw dashed (reference planes) rather than solid. */
  dashed?: boolean;
  /**
   * "workplane" (default): drawn at z = 0 and placed on the active level by the view (datums).
   * "model": coordinates are absolute model space (e.g. opening outlines).
   */
  placement?: "workplane" | "model";
}

/** Grid head (bubble) radius, mm. ~8 mm on paper at 1:100. */
export const GRID_BUBBLE_RADIUS = 400;
const BUBBLE_SEGMENTS = 32;

/**
 * Grid line with a labelled bubble beyond each end, drawn at z = 0.
 * Grids span every level, so the view places them at the level it shows.
 */
export function buildGridLines(_doc: Document, el: Element): LineData {
  const g = el as Grid;
  const { start, end } = g.params;
  const len = Math.hypot(end.x - start.x, end.y - start.y);
  const ux = (end.x - start.x) / len;
  const uy = (end.y - start.y) / len;
  const r = GRID_BUBBLE_RADIUS;
  const seg: number[] = [start.x, start.y, 0, end.x, end.y, 0];
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
    labels.push({ text: g.name ?? "", position: [cx, cy, 0] });
  }
  return { segments: new Float32Array(seg), labels };
}

/** Reference plane: dashed line at z = 0; its name, if any, labels the end. */
export function buildReferencePlaneLines(_doc: Document, el: Element): LineData {
  const { start, end } = (el as ReferencePlane).params;
  const labels: LineData["labels"] = [];
  if (el.name) {
    const len = Math.hypot(end.x - start.x, end.y - start.y);
    const off = REF_PLANE_LABEL_OFFSET / len;
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
