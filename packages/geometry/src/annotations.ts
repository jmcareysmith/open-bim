import {
  Cat,
  dimensionLayout,
  lengthInputValue,
  modelTextSize,
  projectUnits,
  type DetailLineParams,
  type Dimension,
  type Document,
  type Element,
  type FilledRegionParams,
  type TextNoteParams,
  type Vec2,
  anchorInView,
  tagPosition,
  tagText,
  type Tag,
  type View,
} from "@open-bim/core";
import type { LineData } from "./datums.ts";

// Annotation line work in its view's 2D space (z = 0). Sizes are on paper and scale with the view.

/** Paper sizes, mm (Revit-like defaults). */
const WITNESS_GAP = 1.5;
const WITNESS_EXTEND = 2;
const DIM_EXTEND = 2;
const TICK = 2.5;

export function buildAnnotationLines(doc: Document, el: Element): LineData | null {
  switch (el.category) {
    case Cat.DetailLine: {
      const p = el.params as DetailLineParams;
      return {
        segments: new Float32Array([p.start.x, p.start.y, 0, p.end.x, p.end.y, 0]),
        labels: [],
        dashed: p.style === "hidden",
      };
    }
    case Cat.FilledRegion: {
      const p = el.params as FilledRegionParams;
      const seg: number[] = [];
      for (const loop of [p.boundary, ...p.holes]) {
        loop.forEach((a, i) => {
          const b = loop[(i + 1) % loop.length]!;
          seg.push(a.x, a.y, 0, b.x, b.y, 0);
        });
      }
      return { segments: new Float32Array(seg), labels: [], fill: { loops: [p.boundary, ...p.holes], color: p.color } };
    }
    case Cat.TextNote: {
      const p = el.params as TextNoteParams;
      const size = modelTextSize(doc, p.viewId, p.size);
      // An invisible anchor segment keeps the note pickable and gives it a bounding box.
      return {
        segments: new Float32Array([p.position.x, p.position.y, 0, p.position.x + size * 0.01, p.position.y, 0]),
        labels: [{ text: p.text, position: [p.position.x, p.position.y, 0], size, align: "left" }],
      };
    }
    case Cat.Dimension:
      return buildDimensionLines(doc, el as Dimension);
    case Cat.Tag:
      return buildTagLines(doc, el as Tag);
    default:
      return null;
  }
}

/** Approximate text width for a height (the renderers use a sans-serif at about 0.6 em per glyph). */
const textWidth = (text: string, size: number) => text.length * size * 0.6;

/** Tag: its text in a box at the tag position, with an optional leader to the host's anchor. */
export function buildTagLines(doc: Document, tag: Tag): LineData | null {
  const pos = tagPosition(doc, tag);
  if (!pos) return null;
  const size = modelTextSize(doc, tag.params.viewId, tag.params.size);
  const text = tagText(doc, tag);
  const hw = textWidth(text, size) / 2 + size * 0.4;
  const hh = size * 0.9;
  const seg: number[] = [];
  const line = (a: Vec2, b: Vec2) => seg.push(a.x, a.y, 0, b.x, b.y, 0);
  const c = [
    { x: pos.x - hw, y: pos.y - hh },
    { x: pos.x + hw, y: pos.y - hh },
    { x: pos.x + hw, y: pos.y + hh },
    { x: pos.x - hw, y: pos.y + hh },
  ];
  // Keynote tags are boxed (Revit's keynote tag); category tags are plain text.
  if (tag.params.kind === "keynote") c.forEach((a, i) => line(a, c[(i + 1) % 4]!));
  if (tag.params.leader) {
    const view = doc.get(tag.params.viewId) as View | undefined;
    const host = doc.get(tag.params.hostId);
    const a = view && host ? anchorInView(doc, view, host) : null;
    if (a) {
      // Leader from the anchor to the nearest point on the tag's box.
      const end = { x: Math.max(pos.x - hw, Math.min(pos.x + hw, a.x)), y: Math.max(pos.y - hh, Math.min(pos.y + hh, a.y)) };
      if (Math.hypot(end.x - a.x, end.y - a.y) > size * 0.2) line(a, end);
    }
  }
  // An invisible anchor segment keeps an unboxed tag pickable.
  if (!seg.length) line(pos, { x: pos.x + size * 0.01, y: pos.y });
  return { segments: new Float32Array(seg), labels: [{ text, position: [pos.x, pos.y, 0], size }] };
}

export function buildDimensionLines(doc: Document, dim: Dimension): LineData {
  const { dir, at, viewId, size: paper } = dim.params;
  const k = modelTextSize(doc, viewId, 1); // model mm per paper mm
  const { points, ticks, values } = dimensionLayout(doc, dim);
  const units = projectUnits(doc);
  const seg: number[] = [];
  const line = (a: Vec2, b: Vec2) => seg.push(a.x, a.y, 0, b.x, b.y, 0);
  const add = (p: Vec2, v: Vec2, s: number): Vec2 => ({ x: p.x + v.x * s, y: p.y + v.y * s });

  // Witness lines: from just off each reference to just past the dimension line.
  for (const p of points) {
    const along = (at.x - p.x) * dir.x + (at.y - p.y) * dir.y;
    const foot = add(at, dir, -along); // p projected onto the dimension line
    const dx = foot.x - p.x;
    const dy = foot.y - p.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const u = { x: dx / len, y: dy / len };
    if (len > WITNESS_GAP * k) line(add(p, u, WITNESS_GAP * k), add(foot, u, WITNESS_EXTEND * k));
  }
  // Dimension line, extended past the outer ticks, with 45° architectural ticks.
  const first = ticks[0]!;
  const last = ticks.at(-1)!;
  line(add(first, dir, -DIM_EXTEND * k), add(last, dir, DIM_EXTEND * k));
  const perp = { x: -dir.y, y: dir.x };
  const slash = { x: (dir.x + perp.x) / Math.SQRT2, y: (dir.y + perp.y) / Math.SQRT2 };
  for (const t of ticks) line(add(t, slash, (-TICK / 2) * k), add(t, slash, (TICK / 2) * k));

  // Values above the line, on the side away from the references.
  const side = points.length && (at.x - points[0]!.x) * perp.x + (at.y - points[0]!.y) * perp.y < 0 ? -1 : 1;
  const textSize = paper * k;
  // Family dimensions read like Revit's: "Width = 1200" when labelled, "EQ" when equalised.
  const { label, equality } = dim.params;
  const labels: LineData["labels"] = values.map((v, i) => {
    const mid = { x: (ticks[i]!.x + ticks[i + 1]!.x) / 2, y: (ticks[i]!.y + ticks[i + 1]!.y) / 2 };
    const pos = add(mid, perp, side * textSize * 0.9);
    const value = lengthInputValue(v, units);
    const text = equality ? "EQ" : label && values.length === 1 ? `${label} = ${value}` : value;
    return { text, position: [pos.x, pos.y, 0], size: textSize };
  });
  return { segments: new Float32Array(seg), labels };
}
