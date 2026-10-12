import { totalThickness, wallLength, type Document, type ElementId, type LayeredTypeParams, type MaterialParams, type Vec2, type Wall } from "@open-bim/core";
import { joinedWallFootprint } from "./joins.ts";
import { extrudePolygon, type MeshData } from "./mesh.ts";

// Stacked walls: each segment is the wall's joined footprint narrowed to that segment's thickness
// (offsets across the wall, and the corner overhang past each end, scale together so mitres stay
// mitred), extruded over the segment's height and coloured by its type's exterior finish.

type Segment = { typeId: ElementId; bottom: number; top: number; thickness: number };

function finishColour(doc: Document, typeId: ElementId): [number, number, number] {
  const t = doc.get<LayeredTypeParams>(typeId);
  const l = t?.params.layers[0];
  const c = (l?.materialId ? doc.get<MaterialParams>(l.materialId)?.params.color : undefined) ?? 0xcccccc;
  return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
}

export function buildStackedWall(doc: Document, wall: Wall, segments: Segment[]): MeshData | null {
  const full = joinedWallFootprint(doc, wall);
  const T = wall.typeId ? totalThickness(doc.require<LayeredTypeParams>(wall.typeId)) : 0;
  const len = wallLength(wall);
  const { start, end } = wall.params;
  const dir = { x: (end.x - start.x) / len, y: (end.y - start.y) / len };
  const nrm = { x: -dir.y, y: dir.x };
  const local = full.map((p) => ({ u: (p.x - start.x) * dir.x + (p.y - start.y) * dir.y, v: (p.x - start.x) * nrm.x + (p.y - start.y) * nrm.y }));
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (const s of segments) {
    const k = T > 0 ? s.thickness / T : 1;
    const loop: Vec2[] = local.map(({ u, v }) => {
      const uu = u < 0 ? u * k : u > len ? len + (u - len) * k : u;
      return { x: start.x + dir.x * uu + nrm.x * v * k, y: start.y + dir.y * uu + nrm.y * v * k };
    });
    const m = extrudePolygon(loop, [], s.bottom, s.top);
    const base = pos.length / 3;
    const c = finishColour(doc, s.typeId);
    for (let i = 0; i < m.positions.length; i++) {
      pos.push(m.positions[i]!);
      nor.push(m.normals[i]!);
    }
    for (let i = 0; i < m.positions.length / 3; i++) col.push(...c);
    for (const i of m.indices) idx.push(base + i);
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), indices: new Uint32Array(idx), colors: new Float32Array(col) };
}
