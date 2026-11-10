import { instanceOrigin, tangentLine,
  DISPLAY_DETAIL,
  DISPLAY_PLAN,
  DISPLAY_SIDE,
  type DetailLevel,
  type Vec2,
  Cat,
  familyDocument,
  instanceValues,
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

/** The view a family instance is drawn for (form visibility by detail level and plan). */
export interface FamilyDisplay {
  detail: DetailLevel;
  plan: boolean;
  /** Sections/elevations: the direction the view looks, in plan (front/back vs left/right forms). */
  viewDir?: Vec2 | null;
}

export function displayValues(d: FamilyDisplay): Values {
  return { [DISPLAY_DETAIL]: d.detail === "coarse" ? 0 : d.detail === "fine" ? 2 : 1, [DISPLAY_PLAN]: d.plan ? 1 : 0 };
}

function pickDisplay(v: Values): Values {
  const out: Values = {};
  for (const k of [DISPLAY_DETAIL, DISPLAY_PLAN, DISPLAY_SIDE]) if (k in v) out[k] = v[k]!;
  return out;
}

/** Kernel hook: geometry of a family document for given values (solids minus voids where supported). */
export type FamilyMesher = (familyDoc: Document, values: Values) => MeshData | null;

// Keyed by mesher (one per kernel, so a SimpleKernel result never stands in for an OCCT one),
// then family JSON, then values.
const cache = new WeakMap<FamilyMesher, WeakMap<object, Map<string, MeshData | null>>>();

function familyMeshCached(def: FamilyDef, values: Values, mesher: FamilyMesher): MeshData | null {
  let byDef = cache.get(mesher);
  if (!byDef) cache.set(mesher, (byDef = new WeakMap()));
  let byValues = byDef.get(def.params.json);
  if (!byValues) byDef.set(def.params.json, (byValues = new Map()));
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
  return instanceOrigin(doc, inst);
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

/** An instance's mesh in `doc`'s coordinates. `hostValues`: when `doc` is a family, its values. */
export function buildFamilyInstance(doc: Document, el: Element, mesher: FamilyMesher, hostValues?: Values, display?: FamilyDisplay): MeshData | null {
  const inst = el as FamilyInstance;
  // Shared nested families' project elements are drawn by their host's mesh.
  if (inst.params.nestedOf) return null;
  const def = doc.require(inst.params.familyId) as FamilyDef;
  // The view's detail level and plan-ness ride along as reserved values (nested families inherit them).
  const shown = display ? displayValues(display) : hostValues ? pickDisplay(hostValues) : {};
  if (display?.viewDir) {
    // Looking along the family's Y (at its front or back), or along its X (at a side).
    const x = instancePlacement(doc, inst).x;
    const alongX = Math.abs(display.viewDir.x * x.x + display.viewDir.y * x.y);
    const alongY = Math.abs(display.viewDir.x * -x.y + display.viewDir.y * x.x);
    shown[DISPLAY_SIDE] = alongY >= alongX ? 1 : 2;
  }
  const local = familyMeshCached(def, { ...instanceValues(doc, inst, hostValues), ...shown }, mesher);
  return local ? placeMeshData(local, instancePlacement(doc, inst)) : null;
}

/** Meshes of the family instances nested in a family document, for the host's values. */
export function nestedMeshes(familyDoc: Document, values: Values, mesher: FamilyMesher): MeshData[] {
  return familyDoc
    .byCategory(Cat.FamilyInstance)
    .flatMap((inst) => buildFamilyInstance(familyDoc, inst, mesher, values) ?? []);
}
