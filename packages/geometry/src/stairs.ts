import { arcInfo, arcPoints, stairLayout, tangentLine, type Document, type Element, type Stair, type StairTypeParams, type Vec2 } from "@open-bim/core";
import type { LineData } from "./datums.ts";
import { mergeMeshes } from "./doors.ts";
import { extrudePolygon, type MeshData } from "./mesh.ts";

// Stair geometry: each run is a sawtooth profile (risers and treads over a sloping soffit) swept
// across the stair width; landings are slabs. Plan symbol: run centreline arrows with "UP".

/** Extrude a profile drawn in (u, z) across the width, into the run's frame. */
export function sweepProfile(profile: Vec2[], origin: Vec2, dir: Vec2, width: number): MeshData {
  // Local extrusion: profile in XY (x = u, y = z), extruded along local Z = across the run.
  const m = extrudePolygon(profile, [], -width / 2, width / 2);
  const nrm = { x: -dir.y, y: dir.x };
  const pos = new Float32Array(m.positions.length);
  const nor = new Float32Array(m.normals.length);
  for (let i = 0; i < m.positions.length; i += 3) {
    const u = m.positions[i]!;
    const z = m.positions[i + 1]!;
    const v = m.positions[i + 2]!;
    pos.set([origin.x + dir.x * u + nrm.x * v, origin.y + dir.y * u + nrm.y * v, z], i);
    const nu = m.normals[i]!;
    const nz = m.normals[i + 1]!;
    const nv = m.normals[i + 2]!;
    nor.set([dir.x * nu + nrm.x * nv, dir.y * nu + nrm.y * nv, nz], i);
  }
  // The local frame (u, z, v) is left-handed against plan (u, v, z): flip triangles to keep faces outward.
  const idx = new Uint32Array(m.indices.length);
  for (let t = 0; t < m.indices.length; t += 3) idx.set([m.indices[t]!, m.indices[t + 2]!, m.indices[t + 1]!], t);
  return { positions: pos, normals: nor, indices: idx };
}

export function buildStair(doc: Document, el: Element): MeshData | null {
  const s = el as Stair;
  const L = stairLayout(doc, s);
  if (L.height <= 0) return null;
  const t = (s.typeId ? doc.get<StairTypeParams>(s.typeId)?.params : undefined) ?? { waist: 150, landingThickness: 200 };
  const parts: MeshData[] = [];
  for (const r of L.runs) {
    // A run of one riser has no tread: it's just the step up to the landing or floor edge.
    if (r.treads < 1) continue;
    if (r.arc) {
      // Curved: each tread a wedge of the arc band, a riser above the last, down to the soffit.
      const a = r.arc;
      for (let j = 0; j < r.treads; j++) {
        const s0 = (r.length * j) / r.treads;
        const s1 = (r.length * (j + 1)) / r.treads;
        const pts = arcPoints(a.start, a.end, a.curve, Math.PI / 90);
        const cum = [0];
        for (let q = 1; q < pts.length; q++) cum.push(cum[q - 1]! + Math.hypot(pts[q]!.x - pts[q - 1]!.x, pts[q]!.y - pts[q - 1]!.y));
        const scale = r.length / cum[cum.length - 1]!;
        const inside = pts.filter((_, q) => cum[q]! * scale > s0 + 1e-6 && cum[q]! * scale < s1 - 1e-6);
        const t0 = tangentLine({ params: a }, s0);
        const t1 = tangentLine({ params: a }, s1);
        const p0 = { x: t0.start.x + t0.dir.x * s0, y: t0.start.y + t0.dir.y * s0 };
        const p1 = { x: t1.start.x + t1.dir.x * s1, y: t1.start.y + t1.dir.y * s1 };
        const path = [p0, ...inside, p1];
        // Offset the centre path both ways (radially) for the tread's edges.
        const info = arcInfo(a.start, a.end, a.curve)!;
        const off = (p: Vec2, d: number) => {
          const ux = (p.x - info.center.x) / info.radius;
          const uy = (p.y - info.center.y) / info.radius;
          return { x: p.x + ux * d, y: p.y + uy * d };
        };
        const outline = [...path.map((p) => off(p, L.width / 2)), ...[...path].reverse().map((p) => off(p, -L.width / 2))];
        const top = r.z0 + (j + 1) * L.riser;
        parts.push(extrudePolygon(outline, [], Math.max(r.z0, top - L.riser - t.waist), top));
      }
      continue;
    }
    const R = L.riser;
    const G = L.going;
    const prof: Vec2[] = [{ x: 0, y: r.z0 }];
    for (let j = 0; j < r.risers; j++) {
      prof.push({ x: j * G, y: r.z0 + (j + 1) * R });
      if (j < r.treads) prof.push({ x: (j + 1) * G, y: r.z0 + (j + 1) * R });
    }
    // Soffit parallel to the pitch line, `waist` below it (measured square to the pitch).
    const pitch = Math.atan2(R, G);
    const wv = t.waist / Math.cos(pitch);
    const end = r.treads * G;
    const topZ = r.z0 + r.risers * R;
    prof.push({ x: end, y: Math.max(r.z0, topZ - R - wv) });
    const u0 = Math.min(end, (wv * G) / R);
    if (u0 > 1e-6 && u0 < end) prof.push({ x: u0, y: r.z0 });
    parts.push(sweepProfile(dedupe(prof), r.start, r.dir, L.width));
  }
  for (const l of L.landings) parts.push(extrudePolygon(l.boundary, [], l.z - t.landingThickness, l.z));
  // Winders: each tread a block down to the one below it (the first down to the landing's soffit).
  L.winders.forEach((w, j) => parts.push(extrudePolygon(w.boundary, [], j === 0 ? w.z - t.landingThickness : w.z - L.riser - t.waist, w.z)));
  return parts.length ? mergeMeshes(parts) : null;
}

function dedupe(p: Vec2[]): Vec2[] {
  return p.filter((q, i) => {
    const n = p[(i + 1) % p.length]!;
    return Math.hypot(n.x - q.x, n.y - q.y) > 1e-6;
  });
}

/** Plan symbol: a walking line up each run with an arrow head, and "UP" at the start. */
export function buildStairLines(doc: Document, el: Element): LineData | null {
  const s = el as Stair;
  const L = stairLayout(doc, s);
  const seg: number[] = [];
  const labels: LineData["labels"] = [];
  const line = (a: Vec2, b: Vec2) => seg.push(a.x, a.y, 0, b.x, b.y, 0);
  L.runs.forEach((r, i) => {
    const a = r.start;
    let b = { x: a.x + r.dir.x * r.length, y: a.y + r.dir.y * r.length };
    if (r.arc) {
      // Walking line along the arc; the arrow points along its end.
      const pts = arcPoints(r.arc.start, r.arc.end, r.arc.curve);
      for (let q = 0; q + 1 < pts.length; q++) line(pts[q]!, pts[q + 1]!);
      b = r.arc.end;
      const e = tangentLine({ params: r.arc }, r.length).dir;
      r = { ...r, dir: e };
    } else line(a, b);
    if (i === L.runs.length - 1) {
      const n = { x: -r.dir.y, y: r.dir.x };
      const h = Math.min(250, L.width / 4);
      line(b, { x: b.x - r.dir.x * h + n.x * h * 0.6, y: b.y - r.dir.y * h + n.y * h * 0.6 });
      line(b, { x: b.x - r.dir.x * h - n.x * h * 0.6, y: b.y - r.dir.y * h - n.y * h * 0.6 });
    }
    if (i === 0) labels.push({ text: "UP", position: [a.x - r.dir.x * 250, a.y - r.dir.y * 250, 0], size: 200 });
  });
  // Joins between runs across landings.
  for (let i = 0; i + 1 < L.runs.length; i++) {
    const a = L.runs[i]!;
    line(a.arc ? a.arc.end : { x: a.start.x + a.dir.x * a.length, y: a.start.y + a.dir.y * a.length }, L.runs[i + 1]!.start);
  }
  return { segments: new Float32Array(seg), labels, planOnly: true, placement: "workplane" };
}
