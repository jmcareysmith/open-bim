import { Cat, revisionNumber, type Document, type Element, type Revision, type RevisionCloudParams, type Vec2, type ViewParams } from "@open-bim/core";
import type { LineData } from "./datums.ts";

// Revision clouds: scalloped arcs bulging outwards along the boundary, and a revision tag
// (triangle with the revision number) at the cloud's top-right corner. Sizes are paper mm, so
// clouds look the same at any view scale; on sheets the view is paper space itself.

const ARC = 4; // paper mm between scallop ends
const ARC_STEPS = 6;
const TAG = 4; // triangle side, paper mm

export function buildRevisionCloudLines(doc: Document, el: Element): LineData | null {
  if (el.category !== Cat.RevisionCloud) return null;
  const p = el.params as RevisionCloudParams;
  const owner = doc.get(p.viewId);
  const k = owner?.category === Cat.Sheet ? 1 : ((owner?.params as ViewParams | undefined)?.scale ?? 100);
  const pts = p.boundary;
  const ccw = signedArea(pts) > 0;
  const seg: number[] = [];
  const chord = ARC * k;
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.round(len / chord));
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    // Outward normal: right of the edge for counter-clockwise loops.
    const ox = ccw ? uy : -uy;
    const oy = ccw ? -ux : ux;
    for (let j = 0; j < n; j++) {
      const s0 = { x: a.x + ((b.x - a.x) * j) / n, y: a.y + ((b.y - a.y) * j) / n };
      const s1 = { x: a.x + ((b.x - a.x) * (j + 1)) / n, y: a.y + ((b.y - a.y) * (j + 1)) / n };
      const half = Math.hypot(s1.x - s0.x, s1.y - s0.y) / 2;
      const c = { x: (s0.x + s1.x) / 2, y: (s0.y + s1.y) / 2 };
      // Semicircle through s0 and s1, bulging outward.
      let prev = s0;
      for (let t = 1; t <= ARC_STEPS; t++) {
        const th = Math.PI - (Math.PI * t) / ARC_STEPS;
        const q = { x: c.x + ux * Math.cos(th) * half + ox * Math.sin(th) * half, y: c.y + uy * Math.cos(th) * half + oy * Math.sin(th) * half };
        seg.push(prev.x, prev.y, 0, q.x, q.y, 0);
        prev = q;
      }
    }
  });
  // Revision tag at the top-right-most vertex.
  const rev = doc.get(p.revisionId) as Revision | undefined;
  const labels: LineData["labels"] = [];
  if (rev) {
    const corner = pts.reduce((m, q) => (q.x + q.y > m.x + m.y ? q : m), pts[0]!);
    const s = TAG * k;
    const base = { x: corner.x + s * 0.4, y: corner.y + s * 0.4 };
    const tri: Vec2[] = [base, { x: base.x + s, y: base.y }, { x: base.x + s / 2, y: base.y + s * 0.87 }];
    tri.forEach((a, i) => {
      const b = tri[(i + 1) % 3]!;
      seg.push(a.x, a.y, 0, b.x, b.y, 0);
    });
    labels.push({ text: revisionNumber(doc, rev), position: [base.x + s / 2, base.y + s * 0.3, 0], size: s * 0.45 });
  }
  return { segments: new Float32Array(seg), labels };
}

function signedArea(l: Vec2[]): number {
  let s = 0;
  l.forEach((a, i) => {
    const b = l[(i + 1) % l.length]!;
    s += a.x * b.y - b.x * a.y;
  });
  return s / 2;
}
