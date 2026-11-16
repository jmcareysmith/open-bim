import polygonClipping, { type Polygon } from "polygon-clipping";
import { Cat, crossingWalls, wallExtent, wallThickness, type Document, type LayeredTypeParams, type Vec2, type Wall } from "@open-bim/core";
import { joinedWallFootprint } from "./joins.ts";
import { extrudePolygon, type MeshData } from "./mesh.ts";
import { mergeMeshes } from "./doors.ts";
import { slopedTopWallMesh } from "./wallattach.ts";

// Crossing walls in 3D (as plan cleanup does): where two walls cross, the thicker one runs through
// (on a tie, the one drawn first) and the other is cut by its footprint over the heights they share.

/** Plain layered walls (not curtain or stacked) take part. */
function plain(doc: Document, w: Wall): boolean {
  const t = w.typeId ? doc.get<LayeredTypeParams>(w.typeId)?.params : undefined;
  return !!t && !t.curtain && !t.stack?.length;
}


/** The footprints (with height ranges) of walls running through this one. */
export function crossingCutters(doc: Document, wall: Wall): { loop: Vec2[]; z0: number; z1: number }[] {
  if (!plain(doc, wall)) return [];
  const own = wallThickness(doc, wall);
  const { bottom, top } = wallExtent(doc, wall);
  const out: { loop: Vec2[]; z0: number; z1: number }[] = [];
  for (const id of crossingWalls(doc, wall)) {
    const o = doc.get(id) as Wall | undefined;
    if (!o || !plain(doc, o)) continue;
    const t = wallThickness(doc, o);
    // Equal thickness: the lower id runs through (stable through undo and between collaborators; plan cleanup agrees).
    const wins = t > own + 1e-6 || (Math.abs(t - own) <= 1e-6 && o.id < wall.id);
    if (!wins) continue;
    const r = wallExtent(doc, o);
    const z0 = Math.max(bottom, r.bottom);
    const z1 = Math.min(top, r.top);
    if (z1 - z0 > 1) out.push({ loop: joinedWallFootprint(doc, o), z0, z1 });
  }
  return out;
}

const ring = (l: Vec2[]): [number, number][] => [...l.map((q): [number, number] => [q.x, q.y]), [l[0]!.x, l[0]!.y]];

/** A wall's footprint extruded bottom to top, less the walls running through it (in height bands). */
export function cutWallBody(footprint: Vec2[], bottom: number, top: number, cutters: { loop: Vec2[]; z0: number; z1: number }[]): MeshData {
  if (!cutters.length) return extrudePolygon(footprint, [], bottom, top);
  const zs = [...new Set([bottom, top, ...cutters.flatMap((c) => [c.z0, c.z1])])].filter((z) => z >= bottom && z <= top).sort((a, b) => a - b);
  const parts: MeshData[] = [];
  // Bands between cutter heights; neighbouring bands cut by the same walls are one (no faces inside the wall).
  const bands: { z0: number; z1: number; active: typeof cutters }[] = [];
  for (let i = 0; i + 1 < zs.length; i++) {
    const z0 = zs[i]!;
    const z1 = zs[i + 1]!;
    if (z1 - z0 < 1e-6) continue;
    const active = cutters.filter((c) => c.z0 <= z0 + 1e-6 && c.z1 >= z1 - 1e-6);
    const last = bands[bands.length - 1];
    if (last && last.active.length === active.length && last.active.every((c, k) => c === active[k])) last.z1 = z1;
    else bands.push({ z0, z1, active });
  }
  for (const { z0, z1, active } of bands) {
    let polys: Polygon[] = [[ring(footprint)]];
    if (active.length) polys = polygonClipping.difference(polys[0]!, ...active.map((c) => [ring(c.loop)] as Polygon));
    for (const poly of polys) {
      const [outer, ...holes] = poly.map((r) => r.slice(0, -1).map(([x, y]) => ({ x, y })));
      if (outer && outer.length >= 3) parts.push(extrudePolygon(outer, holes, z0, z1));
    }
  }
  return parts.length === 1 ? parts[0]! : mergeMeshes(parts);
}

/**
 * A wall attached under a sloped roof, cut by the walls running through it: its plan less their
 * footprints, plus, where one stops below its top, the part above that wall. (Cutters starting
 * above the wall's base are left out: they're rare, and OCCT cuts them exactly.)
 */
export function cutSlopedWall(doc: Document, wall: Wall, cutters: { loop: Vec2[]; z0: number; z1: number }[]): MeshData | null {
  const { bottom, top } = wallExtent(doc, wall);
  const fp = joinedWallFootprint(doc, wall);
  const used = cutters.filter((c) => c.z0 <= bottom + 1);
  if (!used.length) return slopedTopWallMesh(doc, wall);
  const outer = (p: Polygon): Vec2[] => p[0]!.slice(0, -1).map(([x, y]) => ({ x, y }));
  const parts: MeshData[] = [];
  for (const p of polygonClipping.difference([ring(fp)], ...used.map((c) => [ring(c.loop)] as Polygon))) {
    const m = slopedTopWallMesh(doc, wall, outer(p));
    if (m) parts.push(m);
  }
  for (const c of used) {
    if (c.z1 >= top - 1) continue;
    for (const p of polygonClipping.intersection([ring(fp)], [ring(c.loop)])) {
      const m = slopedTopWallMesh(doc, wall, outer(p), c.z1);
      if (m) parts.push(m);
    }
  }
  return parts.length ? mergeMeshes(parts) : null;
}
