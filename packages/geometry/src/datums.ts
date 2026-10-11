import type { Document, Element, Grid, ReferencePlane } from "@open-bim/core";

/** Line work for datums and annotation, model mm, Z up. */
export interface LineData {
  /** Segment pairs: [x0, y0, z0, x1, y1, z1, …]. */
  segments: Float32Array;
  labels: { text: string; position: [number, number, number] }[];
  /** Draw dashed (reference planes) rather than solid. */
  dashed?: boolean;
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
