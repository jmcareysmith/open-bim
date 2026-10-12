import { Cat, detailContent, detailTransform, type DetailComponentParams, type Document, type Element, type FamilyDef } from "@open-bim/core";
import type { LineData } from "./datums.ts";

// Detail components: their family's detail lines and filled-region outlines, placed in the view,
// with the regions filled (in the first region's colour).

export function buildDetailComponentLines(doc: Document, el: Element): LineData | null {
  if (el.category !== Cat.DetailComponent) return null;
  const p = el.params as DetailComponentParams;
  const def = doc.get(p.familyId) as FamilyDef | undefined;
  if (!def) return null;
  const { lines, regions } = detailContent(def);
  const map = detailTransform(p);
  const seg: number[] = [];
  for (const l of lines) {
    const a = map(l.start);
    const b = map(l.end);
    seg.push(a.x, a.y, 0, b.x, b.y, 0);
  }
  const loops = regions.flatMap((r) => [r.boundary, ...r.holes].map((loop) => loop.map(map)));
  for (const loop of loops) {
    loop.forEach((a, i) => {
      const b = loop[(i + 1) % loop.length]!;
      seg.push(a.x, a.y, 0, b.x, b.y, 0);
    });
  }
  if (!seg.length) return null;
  return { segments: new Float32Array(seg), labels: [], ...(loops.length ? { fill: { loops, color: regions[0]!.color } } : {}) };
}
