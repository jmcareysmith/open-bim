import * as WebIFC from "web-ifc";
import { createDirectShape, createLevel, levels, type DirectShapeParams, type Document, type ElementId, type LevelParams } from "@open-bim/core";

// IFC import via web-ifc. Storeys become levels (matched to existing levels by elevation), and each
// product with a body becomes a DirectShape carrying its IFC class, GlobalId, name, colour and
// flattened property sets / quantities. web-ifc returns geometry in metres, Y up, as local meshes
// with a column-major 4x4 placement; model space here is millimetres, Z up.

export type IfcApi = WebIFC.IfcAPI;

/** Start web-ifc. In the browser pass `locateFile` to point at web-ifc.wasm (e.g. a Vite ?url). */
export async function createIfcApi(locateFile?: (path: string, prefix: string) => string): Promise<IfcApi> {
  const api = new WebIFC.IfcAPI();
  await api.Init(locateFile, true);
  return api;
}

export interface IfcImportResult {
  shapes: number;
  levelsCreated: number;
  skipped: number;
  project: string;
}

interface Product {
  expressID: number;
  positions: number[];
  indices: number[];
  color: number;
}

const label = (v: unknown): string | undefined => {
  const x = (v as { value?: unknown } | null | undefined)?.value;
  return x === undefined || x === null ? undefined : String(x);
};

/** Millimetres per file length unit (from the project's IfcUnitAssignment). */
function lengthScale(api: IfcApi, model: number): number {
  const ua = api.GetLineIDsWithType(model, WebIFC.IFCUNITASSIGNMENT);
  if (!ua.size()) return 1000;
  const units = api.GetLine(model, ua.get(0), true).Units as { UnitType?: { value: string }; Prefix?: { value: string } | null; Name?: { value: string } }[];
  for (const u of units ?? []) {
    if (u?.UnitType?.value !== "LENGTHUNIT") continue;
    const name = u.Name?.value?.toUpperCase() ?? "";
    if (name === "FOOT" || name === "'FOOT'") return 304.8;
    if (name === "INCH" || name === "'INCH'") return 25.4;
    const prefix = u.Prefix?.value;
    return prefix === "MILLI" ? 1 : prefix === "CENTI" ? 10 : prefix === "DECI" ? 100 : prefix === "KILO" ? 1e6 : 1000;
  }
  return 1000;
}

function meshes(api: IfcApi, model: number): Product[] {
  const out: Product[] = [];
  api.StreamAllMeshes(model, (fm) => {
    const positions: number[] = [];
    const indices: number[] = [];
    let color = 0xcccccc;
    for (let i = 0; i < fm.geometries.size(); i++) {
      const pg = fm.geometries.get(i);
      const g = api.GetGeometry(model, pg.geometryExpressID);
      const v = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
      const idx = api.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize());
      const t = pg.flatTransformation;
      const base = positions.length / 3;
      for (let k = 0; k < v.length; k += 6) {
        const x = v[k]!;
        const y = v[k + 1]!;
        const z = v[k + 2]!;
        const X = t[0]! * x + t[4]! * y + t[8]! * z + t[12]!;
        const Y = t[1]! * x + t[5]! * y + t[9]! * z + t[13]!;
        const Z = t[2]! * x + t[6]! * y + t[10]! * z + t[14]!;
        positions.push(Math.round(X * 1e4) / 10, Math.round(-Z * 1e4) / 10, Math.round(Y * 1e4) / 10);
      }
      for (const n of idx) indices.push(base + n);
      if (i === 0) {
        const c = pg.color;
        color = (Math.round(c.x * 255) << 16) | (Math.round(c.y * 255) << 8) | Math.round(c.z * 255);
      }
      g.delete();
    }
    if (indices.length) out.push({ expressID: fm.expressID, positions, indices, color });
  });
  return out;
}

/** Element expressID → storey expressID (contained-in and aggregated-by). */
function storeyOf(api: IfcApi, model: number, storeyIds: Set<number>): Map<number, number> {
  const map = new Map<number, number>();
  const rels = api.GetLineIDsWithType(model, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE);
  for (let i = 0; i < rels.size(); i++) {
    const r = api.GetLine(model, rels.get(i));
    const s = r.RelatingStructure?.value as number;
    if (!storeyIds.has(s)) continue;
    for (const e of r.RelatedElements ?? []) map.set(e.value as number, s);
  }
  const aggs = api.GetLineIDsWithType(model, WebIFC.IFCRELAGGREGATES);
  for (let i = 0; i < aggs.size(); i++) {
    const r = api.GetLine(model, aggs.get(i));
    const s = r.RelatingObject?.value as number;
    if (!storeyIds.has(s)) continue;
    for (const e of r.RelatedObjects ?? []) map.set(e.value as number, s);
  }
  return map;
}

/** "Pset.Property" → value text, from property sets and element quantities (own and type). */
async function properties(api: IfcApi, model: number, id: number): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let sets: Record<string, unknown>[] = [];
  try {
    sets = (await api.properties.getPropertySets(model, id, true, true)) as Record<string, unknown>[];
  } catch {
    // web-ifc's type-property lookup throws on types without property sets; fall back to the element's.
    try {
      sets = (await api.properties.getPropertySets(model, id, true)) as Record<string, unknown>[];
    } catch {
      return out;
    }
  }
  for (const s of sets) {
    const set = label(s.Name) ?? "Properties";
    const items = ((s.HasProperties ?? s.Quantities) as Record<string, unknown>[] | undefined) ?? [];
    for (const p of items) {
      const name = label(p?.Name);
      if (!name) continue;
      const v =
        label(p.NominalValue) ??
        label(p.LengthValue) ??
        label(p.AreaValue) ??
        label(p.VolumeValue) ??
        label(p.CountValue) ??
        label(p.WeightValue);
      if (v !== undefined) out[`${set}.${name}`] = v;
    }
  }
  return out;
}

/** Import an IFC file into `doc` as levels and direct shapes, in one undoable transaction. */
export async function importIfc(doc: Document, data: Uint8Array, api: IfcApi): Promise<IfcImportResult> {
  const model = api.OpenModel(data, { COORDINATE_TO_ORIGIN: false });
  try {
    const mm = lengthScale(api, model);
    const projIds = api.GetLineIDsWithType(model, WebIFC.IFCPROJECT);
    const project = projIds.size() ? (label(api.GetLine(model, projIds.get(0)).Name) ?? "IFC project") : "IFC project";

    const storeyLines = api.GetLineIDsWithType(model, WebIFC.IFCBUILDINGSTOREY);
    const storeys: { id: number; name: string; elevation: number }[] = [];
    for (let i = 0; i < storeyLines.size(); i++) {
      const l = api.GetLine(model, storeyLines.get(i));
      storeys.push({ id: l.expressID, name: label(l.Name) ?? `Level ${i + 1}`, elevation: Number(label(l.Elevation) ?? 0) * mm });
    }
    const where = storeyOf(api, model, new Set(storeys.map((s) => s.id)));
    const products = meshes(api, model);
    const info = new Map<number, { cls: string; guid: string; name?: string; props: Record<string, string> }>();
    for (const p of products) {
      const line = api.GetLine(model, p.expressID);
      info.set(p.expressID, {
        cls: api.GetNameFromTypeCode(api.GetLineType(model, p.expressID)),
        guid: label(line.GlobalId) ?? "",
        name: label(line.Name),
        props: await properties(api, model, p.expressID),
      });
    }

    let created = 0;
    let skipped = 0;
    const shapes = doc.transact("Import IFC", (tx) => {
      // Levels: reuse one within 1 mm of the storey's elevation, else create it.
      const levelFor = new Map<number, ElementId>();
      for (const s of storeys) {
        const match = levels(doc).find((l) => Math.abs((l.params as LevelParams).elevation - s.elevation) < 1);
        if (match) levelFor.set(s.id, match.id);
        else {
          levelFor.set(s.id, createLevel(tx, s.name, Math.round(s.elevation * 10) / 10).id);
          created++;
        }
      }
      if (!levels(doc).length) createLevel(tx, "Level 0", 0);
      const sorted = [...levels(doc)].sort((a, b) => (a.params as LevelParams).elevation - (b.params as LevelParams).elevation);
      let n = 0;
      for (const p of products) {
        const meta = info.get(p.expressID)!;
        if (meta.cls === "IfcOpeningElement" || meta.cls === "IfcSpace") {
          skipped++;
          continue;
        }
        let levelId = where.has(p.expressID) ? levelFor.get(where.get(p.expressID)!) : undefined;
        if (!levelId) {
          // Uncontained products go on the highest level at or below their lowest point.
          let zMin = Infinity;
          for (let i = 2; i < p.positions.length; i += 3) zMin = Math.min(zMin, p.positions[i]!);
          levelId = (sorted.filter((l) => (l.params as LevelParams).elevation <= zMin + 1).at(-1) ?? sorted[0]!).id;
        }
        const params: DirectShapeParams = {
          levelId,
          ifcClass: meta.cls,
          globalId: meta.guid,
          positions: p.positions,
          indices: p.indices,
          color: p.color,
          properties: meta.props,
        };
        createDirectShape(tx, params, meta.name);
        n++;
      }
      return n;
    });
    return { shapes, levelsCreated: created, skipped, project };
  } finally {
    api.CloseModel(model);
  }
}

