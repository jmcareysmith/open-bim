import * as WebIFC from "web-ifc";
import { createDirectShape, createGrid, createLevel, createRoom, levels, type DirectShapeParams, type Document, type ElementId, type LevelParams } from "@open-bim/core";

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
  /** IfcSpaces brought in as rooms (number from Name, name from LongName). */
  rooms: number;
  /** IfcGrid axes brought in as grids (named by their tags). */
  grids: number;
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
  const take = (fm: WebIFC.FlatMesh) => {
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
  };
  api.StreamAllMeshes(model, take);
  // Spaces (rooms) aren't in the default stream.
  try {
    api.StreamAllMeshesWithTypes(model, [WebIFC.IFCSPACE], take);
  } catch {
    // Older web-ifc without typed streaming: no rooms.
  }
  return out;
}

type M34 = number[]; // row-major 3×4: [x-axis, y-axis, z-axis, origin] as columns

/** World transform of an object placement (local placements chained to their parents), in file units. */
function placement(api: IfcApi, model: number, id: number | undefined, depth = 0): M34 {
  const I: M34 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  if (!id || depth > 50) return I;
  const lp = api.GetLine(model, id);
  const parent = placement(api, model, lp.PlacementRelTo?.value as number | undefined, depth + 1);
  const ap = lp.RelativePlacement?.value ? api.GetLine(model, lp.RelativePlacement.value as number) : null;
  if (!ap) return parent;
  const vec = (ref: { value?: number } | null | undefined, def: number[]) => {
    if (!ref?.value) return def;
    const l = api.GetLine(model, ref.value);
    const c = ((l.DirectionRatios ?? l.Coordinates) as { value: number }[]).map((x) => Number(x.value));
    return [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0];
  };
  const o = vec(ap.Location, [0, 0, 0]);
  const z = vec(ap.Axis, [0, 0, 1]);
  let x = vec(ap.RefDirection, [1, 0, 0]);
  const norm = (v: number[]) => {
    const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
    return v.map((k) => k / l);
  };
  const zn = norm(z);
  // x made square to z, then y = z × x.
  const d = x[0]! * zn[0]! + x[1]! * zn[1]! + x[2]! * zn[2]!;
  x = norm([x[0]! - d * zn[0]!, x[1]! - d * zn[1]!, x[2]! - d * zn[2]!]);
  const y = [zn[1]! * x[2]! - zn[2]! * x[1]!, zn[2]! * x[0]! - zn[0]! * x[2]!, zn[0]! * x[1]! - zn[1]! * x[0]!];
  const local: M34 = [x[0]!, y[0]!, zn[0]!, o[0]!, x[1]!, y[1]!, zn[1]!, o[1]!, x[2]!, y[2]!, zn[2]!, o[2]!];
  // parent · local
  const out: M34 = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      let v = 0;
      for (let k = 0; k < 3; k++) v += parent[r * 4 + k]! * local[k * 4 + c]!;
      if (c === 3) v += parent[r * 4 + 3]!;
      out.push(v);
    }
  }
  return out;
}

/** Grid axes: their tag and plan line (model mm), from IfcGrid placements and polyline/line curves. */
function gridAxes(api: IfcApi, model: number, mm: number): { tag: string; a: { x: number; y: number }; b: { x: number; y: number } }[] {
  const out: { tag: string; a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
  const grids = api.GetLineIDsWithType(model, WebIFC.IFCGRID);
  for (let i = 0; i < grids.size(); i++) {
    const g = api.GetLine(model, grids.get(i));
    const m = placement(api, model, g.ObjectPlacement?.value as number | undefined);
    const world = (p: number[]) => ({ x: (m[0]! * p[0]! + m[1]! * p[1]! + m[2]! * (p[2] ?? 0) + m[3]!) * mm, y: (m[4]! * p[0]! + m[5]! * p[1]! + m[6]! * (p[2] ?? 0) + m[7]!) * mm });
    for (const list of [g.UAxes, g.VAxes, g.WAxes]) {
      for (const ref of (list ?? []) as { value: number }[]) {
        const ax = api.GetLine(model, ref.value);
        const curve = ax.AxisCurve?.value ? api.GetLine(model, ax.AxisCurve.value as number) : null;
        if (!curve) continue;
        const pt = (r: { value: number }) => ((api.GetLine(model, r.value).Coordinates ?? []) as { value: number }[]).map((c) => Number(c.value));
        let ends: number[][] = [];
        if (curve.Points) ends = (curve.Points as { value: number }[]).map(pt);
        else if (curve.Pnt && curve.Dir) {
          const p0 = pt(curve.Pnt);
          const v = api.GetLine(model, curve.Dir.value as number);
          const dir = ((api.GetLine(model, v.Orientation.value as number).DirectionRatios ?? []) as { value: number }[]).map((c) => Number(c.value));
          const len = Number(v.Magnitude?.value ?? 1);
          ends = [p0, p0.map((c, k) => c + (dir[k] ?? 0) * len)];
        }
        if (ends.length < 2) continue;
        out.push({ tag: label(ax.AxisTag) ?? "", a: world(ends[0]!), b: world(ends[ends.length - 1]!) });
      }
    }
  }
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
      const props = await properties(api, model, p.expressID);
      // Doors and windows: their stated opening size (mm), truer than the shape (which has trims).
      for (const k of ["OverallWidth", "OverallHeight"]) {
        const v = Number(label(line[k]));
        if (Number.isFinite(v) && v > 0) props[k] = String(Math.round(v * mm));
      }
      // Spaces: the room name (Revit puts the number in Name and the name in LongName).
      const longName = label(line.LongName);
      if (longName) props.LongName = longName;
      // Predefined type (e.g. a slab that is part of a roof: ROOF).
      const pre = label(line.PredefinedType);
      if (pre && pre !== "NOTDEFINED" && pre !== "USERDEFINED") props.PredefinedType = pre;
      info.set(p.expressID, {
        cls: api.GetNameFromTypeCode(api.GetLineType(model, p.expressID)),
        guid: label(line.GlobalId) ?? "",
        name: label(line.Name),
        props,
      });
    }

    let created = 0;
    let skipped = 0;
    let rooms = 0;
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
        if (meta.cls === "IfcOpeningElement") {
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
        if (meta.cls === "IfcSpace") {
          // A room at a point surely inside the space: the middle of its biggest floor triangle.
          let best = { a: -1, x: 0, y: 0 };
          let z0 = Infinity;
          let z1 = -Infinity;
          for (let i = 2; i < p.positions.length; i += 3) {
            z0 = Math.min(z0, p.positions[i]!);
            z1 = Math.max(z1, p.positions[i]!);
          }
          for (let i = 0; i < p.indices.length; i += 3) {
            const v = [p.indices[i]! * 3, p.indices[i + 1]! * 3, p.indices[i + 2]! * 3];
            if (v.some((k) => Math.abs(p.positions[k + 2]! - z0) > 1)) continue;
            const [a, b, c] = v as [number, number, number];
            const area = Math.abs((p.positions[b]! - p.positions[a]!) * (p.positions[c + 1]! - p.positions[a + 1]!) - (p.positions[b + 1]! - p.positions[a + 1]!) * (p.positions[c]! - p.positions[a]!)) / 2;
            if (area > best.a) best = { a: area, x: (p.positions[a]! + p.positions[b]! + p.positions[c]!) / 3, y: (p.positions[a + 1]! + p.positions[b + 1]! + p.positions[c + 1]!) / 3 };
          }
          if (best.a > 0) {
            const lvl = (doc.get<LevelParams>(levelId)?.params.elevation ?? 0);
            const r = createRoom(tx, doc, levelId, { x: best.x, y: best.y }, { number: meta.name ?? "", name: meta.props.LongName ?? meta.name ?? "Room", upperLevelId: null, limitOffset: Math.max(100, z1 - lvl) });
            if (Math.abs(z0 - lvl) > 1) tx.update(r.id, { baseOffset: z0 - lvl });
            rooms++;
          } else skipped++;
          continue;
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
    // Grids: one per axis, named by its tag (a number added if the name is taken).
    let grids = 0;
    const axes = gridAxes(api, model, mm);
    if (axes.length) {
      doc.transact("Import IFC grids", (tx) => {
        for (const ax of axes) {
          if (Math.hypot(ax.b.x - ax.a.x, ax.b.y - ax.a.y) < 1) continue;
          let name = ax.tag || undefined;
          for (let k = 2; name && doc.byCategory("Grid").some((g) => g.name === name); k++) name = `${ax.tag} (${k})`;
          createGrid(tx, doc, ax.a, ax.b, name);
          grids++;
        }
      });
    }
    return { shapes, levelsCreated: created, skipped, rooms, grids, project };
  } finally {
    api.CloseModel(model);
  }
}

