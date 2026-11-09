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
  type StructuralLoadParams,
  type Floor,
  floorExtent,
  Cat,
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
  const rise = (p.endOffset ?? p.offset) - p.offset;
  if (Math.abs(rise) > 0.5) return sweepSloped(outer, holes, s.d, p.start, dir, len, zTop, rise);
  return extrudeAlong(outer.map(shift), holes.map((h) => h.map(shift)), p.start, dir, len, zTop);
}

/**
 * A sloped member: the section square to its axis, which runs from the top-centre line at the
 * start (`zTop`) to `rise` higher at the end. Local (across, up, along) map by a rotation.
 */
function sweepSloped(outer: Vec2[], holes: Vec2[][], d: number, start: Vec2, dir: Vec2, len: number, zTop: number, rise: number): MeshData {
  const L = Math.hypot(len, rise);
  const m = extrudePolygon(outer, holes, 0, L);
  const ax = { x: (dir.x * len) / L, y: (dir.y * len) / L, z: rise / L };
  const nrm = { x: -dir.y, y: dir.x, z: 0 };
  // up = ax x nrm... chosen so it points upwards (perpendicular to the axis in its vertical plane).
  const up = { x: -(dir.x * rise) / L, y: -(dir.y * rise) / L, z: len / L };
  // The axis runs through the section's centre: half its depth below the top line.
  const o = { x: start.x - up.x * (d / 2), y: start.y - up.y * (d / 2), z: zTop - up.z * (d / 2) };
  const pos = new Float32Array(m.positions.length);
  const nor = new Float32Array(m.normals.length);
  for (let i = 0; i < m.positions.length; i += 3) {
    const v = m.positions[i]!;
    const w = m.positions[i + 1]!;
    const u = m.positions[i + 2]!;
    pos.set([o.x + nrm.x * v + up.x * w + ax.x * u, o.y + nrm.y * v + up.y * w + ax.y * u, o.z + up.z * w + ax.z * u], i);
    const nv = m.normals[i]!;
    const nw = m.normals[i + 1]!;
    const nu = m.normals[i + 2]!;
    nor.set([nrm.x * nv + up.x * nw + ax.x * nu, nrm.y * nv + up.y * nw + ax.y * nu, up.z * nw + ax.z * nu], i);
  }
  return { positions: pos, normals: nor, indices: m.indices };
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

/**
 * Load symbols (Revit's load arrows): line loads a row of downward arrows over the beam joined
 * at the top, point loads one arrow; labelled with the case and value. Drawn in model space.
 */
export function buildLoadLines(doc: Document, el: Element): LineData | null {
  const l = el.params as StructuralLoadParams;
  if (l.kind === "area") {
    // Area loads: a grid of arrows standing on the floor (about 1.5 m apart), with the label.
    const f = doc.get(l.hostId) as Floor | undefined;
    if (!f || f.category !== Cat.Floor) return null;
    const top = floorExtent(doc, f).top;
    const b = f.params.boundary;
    const xs = b.map((q) => q.x);
    const ys = b.map((q) => q.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const step = Math.max(1500, Math.max(x1 - x0, y1 - y0) / 8);
    const seg: number[] = [];
    let first: Vec2 | null = null;
    for (let x = x0 + step / 2; x < x1; x += step) {
      for (let y = y0 + step / 2; y < y1; y += step) {
        if (!inRing({ x, y }, b)) continue;
        first ??= { x, y };
        seg.push(x, y, top + 600, x, y, top, x, y, top, x - 60, y, top + 120, x, y, top, x + 60, y, top + 120);
      }
    }
    if (!first) return null;
    return { segments: new Float32Array(seg), labels: [{ text: `${l.case} ${l.value} kPa`, position: [first.x, first.y, top + 750], size: 150 }], placement: "model" };
  }
  const beam = doc.get<BeamParams>(l.hostId);
  if (!beam || beam.category !== Cat.Beam) return null;
  const p = beam.params;
  const len = Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y);
  if (len < 1) return null;
  const lv = doc.get<LevelParams>(p.levelId)?.params.elevation ?? 0;
  const zAt = (u: number) => lv + p.offset + (((p.endOffset ?? p.offset) - p.offset) * u) / len + 50;
  const at = (u: number) => ({ x: p.start.x + ((p.end.x - p.start.x) * u) / len, y: p.start.y + ((p.end.y - p.start.y) * u) / len });
  const H = 600;
  const seg: number[] = [];
  const arrow = (u: number) => {
    const q = at(u);
    const z = zAt(u);
    const d = { x: (p.end.x - p.start.x) / len, y: (p.end.y - p.start.y) / len };
    seg.push(q.x, q.y, z + H, q.x, q.y, z);
    seg.push(q.x, q.y, z, q.x - d.x * 60, q.y - d.y * 60, z + 120);
    seg.push(q.x, q.y, z, q.x + d.x * 60, q.y + d.y * 60, z + 120);
  };
  let label: { u: number; text: string };
  if (l.kind === "line") {
    const n = Math.max(2, Math.round(len / 1000) + 1);
    for (let i = 0; i < n; i++) arrow((len * i) / (n - 1));
    const a = at(0);
    const b = at(len);
    seg.push(a.x, a.y, zAt(0) + H, b.x, b.y, zAt(len) + H);
    label = { u: len / 2, text: `${l.case} ${l.value} kN/m` };
  } else {
    const u = Math.min(Math.max(l.at ?? len / 2, 0), len);
    arrow(u);
    label = { u, text: `${l.case} ${l.value} kN` };
  }
  const q = at(label.u);
  return { segments: new Float32Array(seg), labels: [{ text: label.text, position: [q.x, q.y, zAt(label.u) + H + 150], size: 150 }], placement: "model" };
}

function inRing(q: Vec2, ring: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
