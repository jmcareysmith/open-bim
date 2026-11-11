import polygonClipping, { type Polygon } from "polygon-clipping";
import { Cat, crossingWalls, wallExtent, wallThickness, type Document, type LayeredTypeParams, type Vec2, type Wall } from "@open-bim/core";
import { joinedWallFootprint } from "./joins.ts";
import { extrudePolygon, type MeshData } from "./mesh.ts";
import { mergeMeshes } from "./doors.ts";

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
  const order = new Map(doc.byCategory(Cat.Wall).map((w, i) => [w.id, i]));
  const own = wallThickness(doc, wall);
  const { bottom, top } = wallExtent(doc, wall);
  const out: { loop: Vec2[]; z0: number; z1: number }[] = [];
  for (const id of crossingWalls(doc, wall)) {
    const o = doc.get(id) as Wall | undefined;
    if (!o || !plain(doc, o)) continue;
    const t = wallThickness(doc, o);
    const wins = t > own + 1e-6 || (Math.abs(t - own) <= 1e-6 && (order.get(o.id) ?? 0) < (order.get(wall.id) ?? 0));
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
  for (let i = 0; i + 1 < zs.length; i++) {
    const z0 = zs[i]!;
    const z1 = zs[i + 1]!;
    if (z1 - z0 < 1e-6) continue;
    const active = cutters.filter((c) => c.z0 <= z0 + 1e-6 && c.z1 >= z1 - 1e-6);
    let polys: Polygon[] = [[ring(footprint)]];
    if (active.length) polys = polygonClipping.difference(polys[0]!, ...active.map((c) => [ring(c.loop)] as Polygon));
    for (const poly of polys) {
      const [outer, ...holes] = poly.map((r) => r.slice(0, -1).map(([x, y]) => ({ x, y })));
      if (outer && outer.length >= 3) parts.push(extrudePolygon(outer, holes, z0, z1));
    }
  }
  return parts.length === 1 ? parts[0]! : mergeMeshes(parts);
}
