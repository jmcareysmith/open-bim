import type { LineData } from "./datums.ts";
import {
  columnExtent,
  sectionProfile,
  wallExtent,
  wallLength,
  type Beam,
  type BeamParams,
  type Column,
  type Document,
  type Element,
  type LevelParams,
  type PadFootingParams,
  type StripFootingParams,
  type StructuralSectionParams,
  type Vec2,
  type Wall,
} from "@open-bim/core";
import { extrudePolygon, type MeshData } from "./mesh.ts";

// Structural geometry: columns extrude their section vertically (rotated about their point), beams
// sweep it along their axis with the top of the section at the level, footings are boxes.

function section(doc: Document, el: Element): StructuralSectionParams | undefined {
  return el.typeId ? doc.get<StructuralSectionParams>(el.typeId)?.params : undefined;
}

const rot = (p: Vec2, a: number, at: Vec2): Vec2 => ({ x: at.x + p.x * Math.cos(a) - p.y * Math.sin(a), y: at.y + p.x * Math.sin(a) + p.y * Math.cos(a) });

export function buildColumn(doc: Document, el: Element): MeshData | null {
  const c = el as Column;
  const s = section(doc, c);
  if (!s) return null;
  const { bottom, top } = columnExtent(doc, c);
  if (top <= bottom) return null;
  const { outer, holes } = sectionProfile(s);
  const at = c.params.position;
  return extrudePolygon(outer.map((p) => rot(p, c.params.rotation, at)), holes.map((h) => h.map((p) => rot(p, c.params.rotation, at))), bottom, top);
}

/** Extrude a profile drawn in (across, up) along a plan axis from `start` for `length`. */
function extrudeAlong(outer: Vec2[], holes: Vec2[][], start: Vec2, dir: Vec2, length: number, zTop: number): MeshData {
  const m = extrudePolygon(outer, holes, 0, length);
  const nrm = { x: -dir.y, y: dir.x };
  const pos = new Float32Array(m.positions.length);
  const nor = new Float32Array(m.normals.length);
  for (let i = 0; i < m.positions.length; i += 3) {
    const v = m.positions[i]!;
    const z = m.positions[i + 1]!;
    const u = m.positions[i + 2]!;
    pos.set([start.x + dir.x * u + nrm.x * v, start.y + dir.y * u + nrm.y * v, zTop + z], i);
    const nv = m.normals[i]!;
    const nz = m.normals[i + 1]!;
    const nu = m.normals[i + 2]!;
    nor.set([dir.x * nu + nrm.x * nv, dir.y * nu + nrm.y * nv, nz], i);
  }
  // Local (across, up, along) maps to plan (nrm, z, dir): a rotation, so the winding holds.
  return { positions: pos, normals: nor, indices: m.indices };
}

export function buildBeam(doc: Document, el: Element): MeshData | null {
  const b = el as Beam;
  const s = section(doc, b);
  if (!s) return null;
  const p = b.params as BeamParams;
  const len = Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y);
  if (len < 1) return null;
  const dir = { x: (p.end.x - p.start.x) / len, y: (p.end.y - p.start.y) / len };
  const zTop = (doc.get<LevelParams>(p.levelId)?.params.elevation ?? 0) + p.offset;
  const { outer, holes } = sectionProfile(s);
  // Section hangs below the top: shift so its top edge is at 0.
  const shift = (q: Vec2) => ({ x: q.x, y: q.y - s.d / 2 });
  return extrudeAlong(outer.map(shift), holes.map((h) => h.map(shift)), p.start, dir, len, zTop);
}

/**
 * Beam plan symbol: a dashed centreline at its level (Revit's structural framing in plan at
 * Coarse/Medium), drawn just above the level so plans of that level show it below their cut.
 */
export function buildBeamLines(doc: Document, el: Element): LineData | null {
  const p = el.params as BeamParams;
  if (Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y) < 1) return null;
  const z = (doc.get<LevelParams>(p.levelId)?.params.elevation ?? 0) + 1;
  return { segments: new Float32Array([p.start.x, p.start.y, z, p.end.x, p.end.y, z]), labels: [], dashed: true, planOnly: true, placement: "model" };
}

export function buildPadFooting(doc: Document, el: Element): MeshData | null {
  const p = el.params as PadFootingParams;
  const top = (doc.get<LevelParams>(p.levelId)?.params.elevation ?? 0) + p.offset;
  const r = [
    { x: -p.width / 2, y: -p.length / 2 },
    { x: p.width / 2, y: -p.length / 2 },
    { x: p.width / 2, y: p.length / 2 },
    { x: -p.width / 2, y: p.length / 2 },
  ].map((q) => rot(q, p.rotation, p.position));
  return extrudePolygon(r, [], top - p.depth, top);
}

export function buildStripFooting(doc: Document, el: Element): MeshData | null {
  const p = el.params as StripFootingParams;
  const w = doc.get(p.wallId) as Wall | undefined;
  if (!w) return null;
  const len = wallLength(w);
  if (len < 1) return null;
  const { start, end } = w.params;
  const d = { x: (end.x - start.x) / len, y: (end.y - start.y) / len };
  const n = { x: -d.y, y: d.x };
  // Runs past each end by half its width so footings meet at corners.
  const e = p.width / 2;
  const a = { x: start.x - d.x * e, y: start.y - d.y * e };
  const b = { x: end.x + d.x * e, y: end.y + d.y * e };
  const bottom = wallExtent(doc, w).bottom;
  const r = [
    { x: a.x - n.x * e, y: a.y - n.y * e },
    { x: b.x - n.x * e, y: b.y - n.y * e },
    { x: b.x + n.x * e, y: b.y + n.y * e },
    { x: a.x + n.x * e, y: a.y + n.y * e },
  ];
  return extrudePolygon(r, [], bottom - p.depth, bottom);
}
