import { rampLayout, type Document, type Element, type Ramp } from "@open-bim/core";
import type { LineData } from "./datums.ts";
import { mergeMeshes } from "./doors.ts";
import { extrudePolygon, type MeshData } from "./mesh.ts";
import { sweepProfile } from "./stairs.ts";

// Ramp geometry: each run a sloping slab (constant thickness measured vertically), landings flat.

export function buildRamp(doc: Document, el: Element): MeshData | null {
  const L = rampLayout(doc, el as Ramp);
  const parts: MeshData[] = [];
  for (const r of L.runs) {
    const prof = [
      { x: 0, y: r.z0 - L.thickness },
      { x: r.length, y: r.z1 - L.thickness },
      { x: r.length, y: r.z1 },
      { x: 0, y: r.z0 },
    ];
    parts.push(sweepProfile(prof, r.start, r.dir, L.width));
  }
  for (const l of L.landings) parts.push(extrudePolygon(l.boundary, [], l.z - L.thickness, l.z));
  return parts.length ? mergeMeshes(parts) : null;
}

/** Plan symbol: run centrelines with an arrow up the slope. */
export function buildRampLines(doc: Document, el: Element): LineData | null {
  const L = rampLayout(doc, el as Ramp);
  const seg: number[] = [];
  L.runs.forEach((r, i) => {
    const b = { x: r.start.x + r.dir.x * r.length, y: r.start.y + r.dir.y * r.length };
    seg.push(r.start.x, r.start.y, 0, b.x, b.y, 0);
    if (i === L.runs.length - 1) {
      const n = { x: -r.dir.y, y: r.dir.x };
      const h = Math.min(300, L.width / 4);
      seg.push(b.x, b.y, 0, b.x - r.dir.x * h + n.x * h * 0.6, b.y - r.dir.y * h + n.y * h * 0.6, 0);
      seg.push(b.x, b.y, 0, b.x - r.dir.x * h - n.x * h * 0.6, b.y - r.dir.y * h - n.y * h * 0.6, 0);
    }
  });
  const r0 = L.runs[0];
  const labels: LineData["labels"] = r0 ? [{ text: "UP", position: [r0.start.x - r0.dir.x * 250, r0.start.y - r0.dir.y * 250, 0], size: 200 }] : [];
  return { segments: new Float32Array(seg), labels, planOnly: true };
}
