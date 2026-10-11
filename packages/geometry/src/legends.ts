import {
  Cat,
  keynotesInView,
  modelTextSize,
  type DoorTypeParams,
  type Document,
  type Element,
  type KeynoteLegendParams,
  type LayeredTypeParams,
  type LegendComponentParams,
  type MaterialParams,
  type Vec2,
  type ViewParams,
  type WindowTypeParams,
} from "@open-bim/core";
import type { LineData } from "./datums.ts";
import { hatch, patternFamilies } from "./patterns.ts";

// Legend line work in the legend's 2D space (x right, y up; components hang down from their position).

const LAYERED = new Set<string>([Cat.WallType, Cat.FloorType, Cat.CeilingType, Cat.RoofType]);

export function buildLegendLines(doc: Document, el: Element): LineData | null {
  if (el.category === Cat.LegendComponent) return buildLegendComponent(doc, el.params as LegendComponentParams);
  if (el.category === Cat.KeynoteLegend) return buildKeynoteLegend(doc, el.params as KeynoteLegendParams);
  return null;
}

function buildLegendComponent(doc: Document, p: LegendComponentParams): LineData | null {
  const type = doc.get(p.typeId);
  if (!type) return null;
  const scale = doc.get<ViewParams>(p.viewId)?.params.scale ?? 20;
  const size = modelTextSize(doc, p.viewId, 2.5);
  const seg: number[] = [];
  const line = (a: Vec2, b: Vec2) => seg.push(a.x, a.y, 0, b.x, b.y, 0);
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    line({ x: x0, y: y0 }, { x: x1, y: y0 });
    line({ x: x1, y: y0 }, { x: x1, y: y1 });
    line({ x: x1, y: y1 }, { x: x0, y: y1 });
    line({ x: x0, y: y1 }, { x: x0, y: y0 });
  };
  const { x, y } = p.position;
  const solids: Vec2[][] = [];
  let w = 0;
  let h = 0;
  if (LAYERED.has(type.category)) {
    // Section swatch: layers stacked from the exterior (top) down, each hatched with its cut pattern.
    const layers = (type.params as LayeredTypeParams).layers ?? [];
    w = p.length;
    let top = y;
    for (const l of layers) {
      const bottom = top - l.thickness;
      rect(x, bottom, x + w, top);
      const loop = [
        { x, y: bottom },
        { x: x + w, y: bottom },
        { x: x + w, y: top },
        { x, y: top },
      ];
      const m = l.materialId ? doc.get<MaterialParams>(l.materialId) : undefined;
      const pattern = m?.params.cutPattern ?? "diagonal";
      if (pattern === "solid") solids.push(loop);
      const fam = patternFamilies(pattern, scale);
      if (fam) {
        const hs = hatch([loop], fam);
        for (let i = 0; i < hs.length; i += 4) seg.push(hs[i]!, hs[i + 1]!, 0, hs[i + 2]!, hs[i + 3]!, 0);
      }
      top = bottom;
    }
    h = y - top;
  } else if (type.category === Cat.DoorType) {
    // Elevation: frame, leaf, and the swing triangle pointing to the hinge side.
    const d = type.params as DoorTypeParams;
    w = d.leafWidth + 2 * d.frameWidth;
    h = d.leafHeight + d.frameWidth;
    rect(x, y - h, x + w, y);
    const lx0 = x + d.frameWidth;
    const lx1 = x + w - d.frameWidth;
    const ly1 = y - d.frameWidth;
    rect(lx0, y - h, lx1, ly1);
    line({ x: lx1, y: y - h }, { x: lx0, y: (y - h + ly1) / 2 });
    line({ x: lx0, y: (y - h + ly1) / 2 }, { x: lx1, y: ly1 });
  } else if (type.category === Cat.WindowType) {
    const wt = type.params as WindowTypeParams;
    w = wt.width;
    h = wt.height;
    rect(x, y - h, x + w, y);
    rect(x + wt.frameWidth, y - h + wt.frameWidth, x + w - wt.frameWidth, y - wt.frameWidth);
  } else {
    return null;
  }
  const labels: LineData["labels"] = p.label
    ? [{ text: type.name ?? type.category, position: [x + w + size, y - h / 2, 0], size, align: "left" }]
    : [];
  return { segments: new Float32Array(seg), labels, ...(solids.length ? { fill: { loops: solids, color: 0x808080 } } : {}) };
}

function buildKeynoteLegend(doc: Document, p: KeynoteLegendParams): LineData {
  const size = modelTextSize(doc, p.viewId, 2.5);
  const rows = keynotesInView(doc, p.sourceViewId);
  const keyW = Math.max(4, ...rows.map((r) => r.key.length)) * size * 0.6 + size * 1.2;
  const textW = Math.max(16, ...rows.map((r) => r.text.length)) * size * 0.6 + size * 1.2;
  const rowH = size * 2;
  const { x, y } = p.position;
  const seg: number[] = [];
  const line = (x0: number, y0: number, x1: number, y1: number) => seg.push(x0, y0, 0, x1, y1, 0);
  const labels: LineData["labels"] = [{ text: "Keynote Legend", position: [x, y + size * 0.8, 0], size: size * 1.2, align: "left" }];
  const n = Math.max(rows.length, 1);
  const bottom = y - rowH * n;
  // Outline, column divider and row lines.
  line(x, y, x + keyW + textW, y);
  line(x, bottom, x + keyW + textW, bottom);
  line(x, y, x, bottom);
  line(x + keyW, y, x + keyW, bottom);
  line(x + keyW + textW, y, x + keyW + textW, bottom);
  rows.forEach((r, i) => {
    const cy = y - rowH * (i + 0.5);
    if (i > 0) line(x, y - rowH * i, x + keyW + textW, y - rowH * i);
    labels.push({ text: r.key, position: [x + size * 0.6, cy, 0], size, align: "left" });
    labels.push({ text: r.text, position: [x + keyW + size * 0.6, cy, 0], size, align: "left" });
  });
  if (!rows.length) labels.push({ text: "(no keynotes tagged)", position: [x + size * 0.6, y - rowH / 2, 0], size, align: "left" });
  return { segments: new Float32Array(seg), labels };
}
