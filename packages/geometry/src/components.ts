import {
  familyDocument,
  instanceValues,
  wallDirection,
  type Document,
  type Element,
  type FamilyDef,
  type FamilyInstance,
  type LevelParams,
  type Values,
  type Wall,
} from "@open-bim/core";
import type { MeshData } from "./mesh.ts";

// Placed family instances: the family's mesh (in family coordinates) moved into the project.
// Free-standing: rotated about Z, placed on the level. Wall-hosted: family X along the wall,
// family Y across it (towards the wall's left / exterior face), origin on the location line at
// `along`, at the wall base + sill height.

/** Kernel hook: geometry of a family document for given values (solids minus voids where supported). */
export type FamilyMesher = (familyDoc: Document, values: Values) => MeshData | null;

const cache = new WeakMap<object, Map<string, MeshData | null>>();

function familyMeshCached(def: FamilyDef, values: Values, mesher: FamilyMesher): MeshData | null {
  let byValues = cache.get(def.params.json);
  if (!byValues) cache.set(def.params.json, (byValues = new Map()));
  const key = JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
  if (!byValues.has(key)) byValues.set(key, mesher(familyDocument(def), values));
  return byValues.get(key) ?? null;
}

/** 2D-rotation + translation placing family coordinates into the model. */
export interface Placement {
  origin: [number, number, number];
  /** Unit vector of family +X in plan. */
  x: { x: number; y: number };
}

export function instancePlacement(doc: Document, inst: FamilyInstance): Placement {
  const p = inst.params;
  if (p.hostId) {
    const wall = doc.require(p.hostId) as Wall;
    const d = wallDirection(wall);
    const base = doc.require<LevelParams>(wall.params.baseLevelId).params.elevation + wall.params.baseOffset;
    const x = p.flipped ? { x: -d.x, y: -d.y } : d;
    return { origin: [wall.params.start.x + d.x * p.along, wall.params.start.y + d.y * p.along, base + p.sillHeight], x };
  }
  const z = doc.require<LevelParams>(p.levelId).params.elevation + p.offset;
  return { origin: [p.position.x, p.position.y, z], x: { x: Math.cos(p.rotation), y: Math.sin(p.rotation) } };
}

export function placeMeshData(m: MeshData, pl: Placement): MeshData {
  const { x, origin } = pl;
  const y = { x: -x.y, y: x.x };
  const positions = new Float32Array(m.positions.length);
  const normals = new Float32Array(m.normals.length);
  for (let i = 0; i < m.positions.length; i += 3) {
    const px = m.positions[i]!;
    const py = m.positions[i + 1]!;
    positions[i] = origin[0] + x.x * px + y.x * py;
    positions[i + 1] = origin[1] + x.y * px + y.y * py;
    positions[i + 2] = origin[2] + m.positions[i + 2]!;
    const nx = m.normals[i]!;
    const ny = m.normals[i + 1]!;
    normals[i] = x.x * nx + y.x * ny;
    normals[i + 1] = x.y * nx + y.y * ny;
    normals[i + 2] = m.normals[i + 2]!;
  }
  return { positions, normals, indices: m.indices };
}

export function buildFamilyInstance(doc: Document, el: Element, mesher: FamilyMesher): MeshData | null {
  const inst = el as FamilyInstance;
  const def = doc.require(inst.params.familyId) as FamilyDef;
  const local = familyMeshCached(def, instanceValues(doc, inst), mesher);
  return local ? placeMeshData(local, instancePlacement(doc, inst)) : null;
}
