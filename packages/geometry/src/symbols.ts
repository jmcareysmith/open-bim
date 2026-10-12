import { Cat, scaleBarLayout, symbolAngle, symbolScale, type AnnotationSymbol, type Document, type Element, type Vec2 } from "@open-bim/core";
import type { LineData } from "./datums.ts";

// Annotation symbols in their view's 2D space, sized on paper × the view scale:
// - north arrow: a half-filled arrowhead with an "N" past its tip;
// - scale bar: alternating filled blocks with distances under the divisions;
// - break line: a straight line with a zigzag in the middle.

const TEXT = 2.5; // paper mm

export function buildSymbolLines(doc: Document, el: Element): LineData | null {
  if (el.category !== Cat.Symbol) return null;
  const s = el as AnnotationSymbol;
  const k = symbolScale(doc, s);
  const size = s.params.size * k;
  const a = symbolAngle(doc, s);
  const o = s.params.position;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  // Local (along, across) → view coordinates.
  const at = (u: number, v: number): Vec2 => ({ x: o.x + ux * u - uy * v, y: o.y + uy * u + ux * v });
  const seg: number[] = [];
  const line = (p: Vec2, q: Vec2) => seg.push(p.x, p.y, 0, q.x, q.y, 0);
  const poly = (pts: Vec2[], closed = true) => pts.forEach((p, i) => (closed || i < pts.length - 1) && line(p, pts[(i + 1) % pts.length]!));
  const labels: LineData["labels"] = [];
  const fills: Vec2[][] = [];

  switch (s.params.kind) {
    case "northArrow": {
      const tip = at(size / 2, 0);
      const tail = at(-size / 2, 0);
      const left = at(-size / 2, size * 0.3);
      const right = at(-size / 2, -size * 0.3);
      const notch = at(-size * 0.3, 0);
      poly([tip, left, notch, right]);
      line(tip, tail);
      fills.push([tip, left, notch]);
      const n = at(size / 2 + TEXT * k * 0.9, 0);
      labels.push({ text: "N", position: [n.x, n.y, 0], size: TEXT * k * 1.2 });
      break;
    }
    case "scaleBar": {
      const { length, divisions } = scaleBarLayout(size);
      if (!length) return null;
      const h = 1.5 * k;
      const step = length / divisions;
      // Centred on the position: blocks from -length/2 to +length/2.
      const x0 = -length / 2;
      poly([at(x0, 0), at(x0 + length, 0), at(x0 + length, h), at(x0, h)]);
      for (let i = 0; i < divisions; i++) {
        const xa = x0 + i * step;
        if (i > 0) line(at(xa, 0), at(xa, h));
        if (i % 2 === 0) fills.push([at(xa, 0), at(xa + step, 0), at(xa + step, h), at(xa, h)]);
      }
      const metres = length >= 1000;
      for (let i = 0; i <= divisions; i++) {
        const value = metres ? (i * step) / 1000 : i * step;
        const text = `${+value.toFixed(2)}${i === divisions ? (metres ? " m" : " mm") : ""}`;
        const p = at(x0 + i * step, -TEXT * k * 1.1);
        labels.push({ text, position: [p.x, p.y, 0], size: TEXT * k });
      }
      break;
    }
    case "breakLine": {
      const w = size * 0.08;
      const h = size * 0.12;
      poly([at(-size / 2, 0), at(-w, 0), at(-w / 2, h), at(w / 2, -h), at(w, 0), at(size / 2, 0)], false);
      break;
    }
  }
  return { segments: new Float32Array(seg), labels, ...(fills.length ? { fill: { loops: fills, color: 0x1f2328, opaque: true } } : {}) };
}
