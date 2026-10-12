import {
  Cat,
  customValue,
  elementKeynote,
  elementMark,
  elementMaterial,
  familyDefs,
  hostedPlacement,
  levels,
  parametersFor,
  projectSettings,
  projectLocation,
  CRS_OPTIONS,
  roomExtent,
  totalThickness,
  wallExtent,
  wallLength,
  wallThickness,
  type Document,
  type Element,
  type ElementId,
  type FamilyInstanceParams,
  type LayeredTypeParams,
  type Level,
  type MaterialParams,
  type Room,
  type Wall,
  type WallParams,
} from "@open-bim/core";
import { SimpleKernel, elementArea, elementVolume, roomBoundary, type GeometryKernel, type MeshData } from "@open-bim/geometry";
import { ifcGuid } from "./guid.ts";
import { DERIVED, StepWriter, en, real, typed, type Ref, type StepArg } from "./step.ts";

// IFC4 export (Reference View style): spatial structure (project → site → building → storeys),
// building elements with triangulated bodies in storey-relative placement, types, layered
// materials with colours, Pset_*Common / Open-BIM property sets and base quantities.
// Units: millimetres, square and cubic metres, radians.

export interface IfcExportOptions {
  /** Kernel for element bodies (OCCT gives walls cut by their openings). Default: SimpleKernel. */
  kernel?: GeometryKernel;
  fileName?: string;
  /** ISO timestamp for the header (fixed in tests). */
  timestamp?: string;
}

/** What each Open-BIM element becomes. */
interface Mapping {
  entity: string;
  predefined: string;
  type?: { entity: string; predefined: string };
}

function mapping(doc: Document, el: Element): Mapping | null {
  switch (el.category) {
    case Cat.Wall:
      return { entity: "IfcWall", predefined: "STANDARD", type: { entity: "IfcWallType", predefined: "STANDARD" } };
    case Cat.Floor:
      return { entity: "IfcSlab", predefined: "FLOOR", type: { entity: "IfcSlabType", predefined: "FLOOR" } };
    case Cat.Roof:
      return { entity: "IfcRoof", predefined: "NOTDEFINED", type: { entity: "IfcRoofType", predefined: "NOTDEFINED" } };
    case Cat.Ceiling:
      return { entity: "IfcCovering", predefined: "CEILING", type: { entity: "IfcCoveringType", predefined: "CEILING" } };
    case Cat.Door:
      return { entity: "IfcDoor", predefined: "DOOR" };
    case Cat.Window:
      return { entity: "IfcWindow", predefined: "WINDOW" };
    case Cat.Room:
      return { entity: "IfcSpace", predefined: "INTERNAL" };
    case Cat.FamilyInstance: {
      const def = familyDefs(doc).find((d) => d.id === (el.params as FamilyInstanceParams).familyId);
      const c = def?.params.category;
      if (c === "Door") return { entity: "IfcDoor", predefined: "DOOR" };
      if (c === "Window") return { entity: "IfcWindow", predefined: "WINDOW" };
      if (c === "Furniture" || c === "Casework") return { entity: "IfcFurniture", predefined: "NOTDEFINED" };
      return { entity: "IfcBuildingElementProxy", predefined: "NOTDEFINED" };
    }
    default:
      return null;
  }
}

/** The level an element sits on (hosted elements: their wall's base level). */
function levelOf(doc: Document, el: Element): ElementId | undefined {
  const p = el.params as Record<string, unknown>;
  if (el.category === Cat.Wall) return (p as WallParams).baseLevelId;
  const host = typeof p.hostId === "string" ? doc.get<WallParams>(p.hostId) : undefined;
  if (host) return host.params.baseLevelId;
  return typeof p.levelId === "string" ? p.levelId : undefined;
}

export function exportIfc(doc: Document, opts: IfcExportOptions = {}): string {
  const kernel = opts.kernel ?? new SimpleKernel();
  const w = new StepWriter();
  const info = projectSettings(doc)?.params.info;
  const guid = (key: string) => ifcGuid(key);
  let relN = 0;
  const relGuid = (kind: string) => ifcGuid(`${kind}:${relN++}`);

  // ---- context and units ----------------------------------------------------------------
  const origin = w.add("IfcCartesianPoint", [real(0), real(0), real(0)]);
  const zAxis = w.add("IfcDirection", [real(0), real(0), real(1)]);
  const xAxis = w.add("IfcDirection", [real(1), real(0), real(0)]);
  const world = w.add("IfcAxis2Placement3D", origin, zAxis, xAxis);
  const north = w.add("IfcDirection", [real(0), real(1)]);
  const ctx = w.add("IfcGeometricRepresentationContext", null, "Model", 3, real(1e-5), world, north);
  const body = w.add("IfcGeometricRepresentationSubContext", "Body", "Model", DERIVED, DERIVED, DERIVED, DERIVED, ctx, null, en("MODEL_VIEW"), null);
  const units = w.add("IfcUnitAssignment", [
    w.add("IfcSIUnit", DERIVED, en("LENGTHUNIT"), en("MILLI"), en("METRE")),
    w.add("IfcSIUnit", DERIVED, en("AREAUNIT"), null, en("SQUARE_METRE")),
    w.add("IfcSIUnit", DERIVED, en("VOLUMEUNIT"), null, en("CUBIC_METRE")),
    w.add("IfcSIUnit", DERIVED, en("PLANEANGLEUNIT"), null, en("RADIAN")),
  ]);

  // ---- spatial structure ------------------------------------------------------------------
  const projectName = info?.name || "Open-BIM project";
  const project = w.add("IfcProject", guid("project"), null, projectName, info?.number || null, null, info?.name || null, null, [ctx], units);
  // Shared coordinates: georeference the model context (IFC4 IfcMapConversion, metres).
  const loc = projectLocation(doc);
  if (projectSettings(doc)?.params.location) {
    const crs = CRS_OPTIONS.find((c) => c.epsg === loc.epsg);
    const metre = w.add("IfcSIUnit", DERIVED, en("LENGTHUNIT"), null, en("METRE"));
    const target = w.add("IfcProjectedCRS", `EPSG:${loc.epsg}`, crs?.name ?? null, crs?.datum ?? null, crs?.vertical ?? null, crs ? "Transverse Mercator" : null, null, metre);
    w.add("IfcMapConversion", ctx, target, real(loc.eastings), real(loc.northings), real(loc.height), real(Math.cos(loc.rotation)), real(Math.sin(loc.rotation)), real(0.001));
  }
  const sitePlacement = w.add("IfcLocalPlacement", null, world);
  const site = w.add("IfcSite", guid("site"), null, "Site", null, null, sitePlacement, null, null, en("ELEMENT"), null, null, null, null, null);
  const buildingPlacement = w.add("IfcLocalPlacement", sitePlacement, world);
  const address = info?.address ? w.add("IfcPostalAddress", null, null, null, null, [info.address], null, null, null, null, "New Zealand") : null;
  const building = w.add("IfcBuilding", guid("building"), null, projectName, null, null, buildingPlacement, null, null, en("ELEMENT"), null, null, address);
  w.add("IfcRelAggregates", relGuid("agg"), null, null, null, project, [site]);
  w.add("IfcRelAggregates", relGuid("agg"), null, null, null, site, [building]);

  const storeys = new Map<ElementId, { ref: Ref; placement: Ref; elevation: number; elements: Ref[]; spaces: Ref[] }>();
  const levelList = levels(doc) as Level[];
  for (const l of levelList) {
    const e = l.params.elevation;
    const p = w.add("IfcAxis2Placement3D", w.add("IfcCartesianPoint", [real(0), real(0), real(e)]), null, null);
    const placement = w.add("IfcLocalPlacement", buildingPlacement, p);
    const ref = w.add("IfcBuildingStorey", guid(l.id), null, l.name ?? "Level", null, null, placement, null, null, en("ELEMENT"), real(e));
    storeys.set(l.id, { ref, placement, elevation: e, elements: [], spaces: [] });
  }
  if (storeys.size) w.add("IfcRelAggregates", relGuid("agg"), null, null, null, building, [...storeys.values()].map((s) => s.ref));

  // ---- materials (shared) -------------------------------------------------------------------
  const materialRefs = new Map<string, Ref>();
  const styleRefs = new Map<string, Ref>();
  const material = (name: string) => {
    let m = materialRefs.get(name);
    if (!m) materialRefs.set(name, (m = w.add("IfcMaterial", name, null, null)));
    return m;
  };
  const surfaceStyle = (name: string, colour: number) => {
    const key = `${name}|${colour}`;
    let s = styleRefs.get(key);
    if (!s) {
      const rgb = w.add("IfcColourRgb", null, real(((colour >> 16) & 255) / 255), real(((colour >> 8) & 255) / 255), real((colour & 255) / 255));
      const shading = w.add("IfcSurfaceStyleShading", rgb, real(0));
      styleRefs.set(key, (s = w.add("IfcSurfaceStyle", name, en("BOTH"), [shading])));
    }
    return s;
  };
  const layerSets = new Map<ElementId, Ref>();
  const layerSetOf = (typeId: ElementId): Ref | null => {
    const t = doc.get<LayeredTypeParams>(typeId);
    if (!t?.params.layers) return null;
    let s = layerSets.get(typeId);
    if (!s) {
      const layers = t.params.layers.map((l) => {
        const mname = (l.materialId ? doc.get<MaterialParams>(l.materialId)?.name : undefined) ?? l.material ?? "Material";
        return w.add("IfcMaterialLayer", material(mname), real(l.thickness), null, mname, null, l.function, null);
      });
      layerSets.set(typeId, (s = w.add("IfcMaterialLayerSet", layers, t.name ?? null, null)));
    }
    return s;
  };

  // ---- types -----------------------------------------------------------------------------------
  const typeRefs = new Map<ElementId, { ref: Ref; members: Ref[] }>();
  const typeOf = (el: Element, m: Mapping): { ref: Ref; members: Ref[] } | null => {
    if (!m.type || !el.typeId) return null;
    let t = typeRefs.get(el.typeId);
    if (!t) {
      const te = doc.get(el.typeId);
      const ref = w.add(m.type.entity, guid(el.typeId), null, te?.name ?? "Type", null, null, null, null, null, null, en(m.type.predefined));
      typeRefs.set(el.typeId, (t = { ref, members: [] }));
    }
    return t;
  };

  // ---- elements ----------------------------------------------------------------------------------
  const materialUse = new Map<Ref, Ref[]>();
  const noLevel = levelList[0]?.id;
  for (const el of doc.all()) {
    const m = mapping(doc, el);
    if (!m) continue;
    const levelId = levelOf(doc, el) ?? noLevel;
    const storey = levelId ? storeys.get(levelId) : undefined;
    if (!storey) continue;
    let mesh: MeshData | null = null;
    try {
      mesh = el.category === Cat.Room ? roomMesh(doc, el as Room) : kernel.build(doc, el);
    } catch {
      mesh = null;
    }
    const placement = w.add("IfcLocalPlacement", storey.placement, w.add("IfcAxis2Placement3D", origin, null, null));
    let shape: Ref | null = null;
    if (mesh && mesh.indices.length) {
      const item = faceSet(w, mesh, storey.elevation);
      const mat = elementMaterial(doc, el);
      const colour = mat?.params.color ?? DEFAULT_COLOURS[m.entity] ?? 0xcccccc;
      w.add("IfcStyledItem", item, [surfaceStyle(mat?.name ?? m.entity, colour)], null);
      const rep = w.add("IfcShapeRepresentation", body, "Body", "Tessellation", [item]);
      shape = w.add("IfcProductDefinitionShape", null, null, [rep]);
    }
    const name = el.category === Cat.Room ? (el.params as { number: string }).number : (el.name ?? doc.get(el.typeId ?? "")?.name ?? typeLabel(el));
    const tag = elementMark(el) ?? null;
    const common = [guid(el.id), null, name, null, typeLabel(el, doc), placement, shape] as StepArg[];
    let ref: Ref;
    if (m.entity === "IfcDoor" || m.entity === "IfcWindow") {
      const h = hostedPlacement(doc, el);
      ref = w.add(m.entity, ...common, tag, real(h.height), real(h.width), en(m.predefined), null, null);
    } else if (m.entity === "IfcSpace") {
      ref = w.add("IfcSpace", ...common.slice(0, 7), el.name ?? null, en("ELEMENT"), en("INTERNAL"), null);
    } else {
      ref = w.add(m.entity, ...common, tag, en(m.predefined));
    }
    if (m.entity === "IfcSpace") storey.spaces.push(ref);
    else storey.elements.push(ref);
    typeOf(el, m)?.members.push(ref);
    if (el.typeId) {
      const ls = layerSetOf(el.typeId);
      if (ls) materialUse.set(ls, [...(materialUse.get(ls) ?? []), ref]);
    }
    properties(w, doc, el, m, ref, relGuid);
  }

  // ---- relationships -----------------------------------------------------------------------------
  for (const s of storeys.values()) {
    if (s.elements.length) w.add("IfcRelContainedInSpatialStructure", relGuid("cont"), null, null, null, s.elements, s.ref);
    if (s.spaces.length) w.add("IfcRelAggregates", relGuid("agg"), null, null, null, s.ref, s.spaces);
  }
  for (const t of typeRefs.values()) if (t.members.length) w.add("IfcRelDefinesByType", relGuid("type"), null, null, null, t.members, t.ref);
  for (const [ls, els] of materialUse) w.add("IfcRelAssociatesMaterial", relGuid("mat"), null, null, null, els, ls);

  return w.toString({
    name: opts.fileName ?? `${projectName}.ifc`,
    description: "ViewDefinition [ReferenceView_V1.2]",
    timestamp: opts.timestamp ?? new Date().toISOString().slice(0, 19),
  });
}

const DEFAULT_COLOURS: Record<string, number> = {
  IfcWall: 0xd9d4c7,
  IfcSlab: 0xb7b2a6,
  IfcRoof: 0x5e6670,
  IfcCovering: 0xf0efe9,
  IfcDoor: 0x8a5a3c,
  IfcWindow: 0x9cc3d9,
  IfcSpace: 0x7fb3e6,
  IfcFurniture: 0xb9a48a,
  IfcBuildingElementProxy: 0xc8c3b6,
};

function typeLabel(el: Element, doc?: Document): string {
  if (el.category === Cat.FamilyInstance) {
    const p = el.params as FamilyInstanceParams;
    const def = doc ? familyDefs(doc).find((d) => d.id === p.familyId) : undefined;
    return def ? `${def.name}:${p.typeName}` : p.typeName;
  }
  const t = doc && el.typeId ? doc.get(el.typeId)?.name : undefined;
  return t ?? el.category;
}

/** Triangulated face set with shared vertices, in storey coordinates (z relative to the storey). */
function faceSet(w: StepWriter, mesh: MeshData, z0: number): Ref {
  const key = (i: number) => `${Math.round(mesh.positions[i * 3]! * 100)},${Math.round(mesh.positions[i * 3 + 1]! * 100)},${Math.round(mesh.positions[i * 3 + 2]! * 100)}`;
  const index = new Map<string, number>();
  const coords: StepArg[] = [];
  const remap: number[] = [];
  for (let i = 0; i < mesh.positions.length / 3; i++) {
    const k = key(i);
    let n = index.get(k);
    if (n === undefined) {
      n = coords.length + 1;
      index.set(k, n);
      coords.push([real(mesh.positions[i * 3]!), real(mesh.positions[i * 3 + 1]!), real(mesh.positions[i * 3 + 2]! - z0)]);
    }
    remap.push(n);
  }
  const tris: StepArg[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = remap[mesh.indices[t]!]!;
    const b = remap[mesh.indices[t + 1]!]!;
    const c = remap[mesh.indices[t + 2]!]!;
    if (a !== b && b !== c && c !== a) tris.push([a, b, c]);
  }
  const pts = w.add("IfcCartesianPointList3D", coords);
  return w.add("IfcTriangulatedFaceSet", pts, null, true, tris, null);
}

/** A room's body: its boundary extruded through its height. */
function roomMesh(doc: Document, room: Room): MeshData | null {
  const b = roomBoundary(doc, room);
  if (!b) return null;
  const { bottom, top } = roomExtent(doc, room);
  const pos: number[] = [];
  const idx: number[] = [];
  const loop = b.outer;
  const n = loop.length;
  // Fan-triangulate the (simple) outline for the caps; sides as quads.
  const base = (z: number) => {
    const start = pos.length / 3;
    for (const p of loop) pos.push(p.x, p.y, z);
    return start;
  };
  const lo = base(bottom);
  const hi = base(top);
  for (const [a, b2, c] of earClip(loop)) {
    idx.push(lo + c, lo + b2, lo + a);
    idx.push(hi + a, hi + b2, hi + c);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(lo + i, lo + j, hi + j, lo + i, hi + j, hi + i);
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(pos.length), indices: new Uint32Array(idx) };
}

/** Ear clipping for a simple polygon (counter-clockwise or not). */
function earClip(pts: { x: number; y: number }[]): [number, number, number][] {
  const area = pts.reduce((s, p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    return s + p.x * q.y - q.x * p.y;
  }, 0);
  const order = pts.map((_, i) => i);
  if (area < 0) order.reverse();
  const out: [number, number, number][] = [];
  const cross = (a: number, b: number, c: number) =>
    (pts[b]!.x - pts[a]!.x) * (pts[c]!.y - pts[a]!.y) - (pts[b]!.y - pts[a]!.y) * (pts[c]!.x - pts[a]!.x);
  const inside = (p: number, a: number, b: number, c: number) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = 0;
  while (order.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < order.length; i++) {
      const a = order[(i + order.length - 1) % order.length]!;
      const b = order[i]!;
      const c = order[(i + 1) % order.length]!;
      if (cross(a, b, c) <= 1e-9) continue;
      if (order.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      out.push([a, b, c]);
      order.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (order.length === 3) out.push([order[0]!, order[1]!, order[2]!]);
  return out;
}

const PSET_COMMON: Record<string, string> = {
  IfcWall: "Pset_WallCommon",
  IfcSlab: "Pset_SlabCommon",
  IfcRoof: "Pset_RoofCommon",
  IfcCovering: "Pset_CoveringCommon",
  IfcDoor: "Pset_DoorCommon",
  IfcWindow: "Pset_WindowCommon",
  IfcSpace: "Pset_SpaceCommon",
  IfcFurniture: "Pset_FurnitureTypeCommon",
  IfcBuildingElementProxy: "Pset_BuildingElementProxyCommon",
};

function properties(w: StepWriter, doc: Document, el: Element, m: Mapping, target: Ref, relGuid: (k: string) => string): void {
  const prop = (name: string, value: StepArg) => w.add("IfcPropertySingleValue", name, null, value, null);
  const psets: [string, Ref[]][] = [];
  const reference = el.typeId ? doc.get(el.typeId)?.name : el.category === Cat.FamilyInstance ? (el.params as FamilyInstanceParams).typeName : undefined;
  const common: Ref[] = [];
  if (reference) common.push(prop("Reference", typed("IFCIDENTIFIER", reference)));
  if (m.entity === "IfcWall" || m.entity === "IfcSlab") common.push(prop("LoadBearing", typed("IFCBOOLEAN", false)));
  if (common.length && PSET_COMMON[m.entity]) psets.push([PSET_COMMON[m.entity]!, common]);

  const own: Ref[] = [];
  const keynote = elementKeynote(doc, el);
  if (keynote) own.push(prop("Keynote", typed("IFCLABEL", keynote)));
  if (elementMark(el)) own.push(prop("Mark", typed("IFCLABEL", elementMark(el)!)));
  for (const p of parametersFor(doc, el.category)) {
    const v = customValue(doc, el, p.name ?? "");
    if (v === undefined || v === null || v === "") continue;
    if (typeof v === "boolean") own.push(prop(p.name ?? "", typed("IFCBOOLEAN", v)));
    else if (typeof v === "number") own.push(prop(p.name ?? "", typed(p.params.dataType === "length" ? "IFCLENGTHMEASURE" : "IFCREAL", real(v))));
    else if (typeof v === "string") own.push(prop(p.name ?? "", typed("IFCLABEL", v)));
  }
  if (own.length) psets.push(["Open-BIM", own]);

  for (const [name, props] of psets) {
    const ps = w.add("IfcPropertySet", relGuid("pset"), null, name, null, props);
    w.add("IfcRelDefinesByProperties", relGuid("defp"), null, null, null, [target], ps);
  }

  // Base quantities (Qto_*BaseQuantities), lengths mm, areas m², volumes m³.
  const q: Ref[] = [];
  const len = (n: string, v: number | undefined) => v !== undefined && Number.isFinite(v) && q.push(w.add("IfcQuantityLength", n, null, null, real(v), null));
  const area = (n: string, v: number | undefined) => v !== undefined && Number.isFinite(v) && q.push(w.add("IfcQuantityArea", n, null, null, real(v / 1e6), null));
  const vol = (n: string, v: number | undefined) => v !== undefined && Number.isFinite(v) && q.push(w.add("IfcQuantityVolume", n, null, null, real(v / 1e9), null));
  const safe = <T>(f: () => T): T | undefined => {
    try {
      return f();
    } catch {
      return undefined;
    }
  };
  let qto = "";
  if (m.entity === "IfcWall") {
    const wall = el as Wall;
    const e = wallExtent(doc, wall);
    qto = "Qto_WallBaseQuantities";
    len("Length", wallLength(wall));
    len("Height", e.top - e.bottom);
    len("Width", safe(() => wallThickness(doc, wall)));
    area("NetSideArea", safe(() => elementArea(doc, el)));
    vol("NetVolume", safe(() => elementVolume(doc, el)));
  } else if (m.entity === "IfcSlab" || m.entity === "IfcCovering" || m.entity === "IfcRoof") {
    qto = m.entity === "IfcSlab" ? "Qto_SlabBaseQuantities" : m.entity === "IfcRoof" ? "Qto_RoofBaseQuantities" : "Qto_CoveringBaseQuantities";
    const t = el.typeId ? doc.get<LayeredTypeParams>(el.typeId) : undefined;
    if (t?.params.layers && m.entity === "IfcSlab") len("Width", totalThickness(t));
    area(m.entity === "IfcRoof" ? "GrossArea" : "NetArea", safe(() => elementArea(doc, el)));
    if (m.entity === "IfcSlab") vol("NetVolume", safe(() => elementVolume(doc, el)));
  } else if (m.entity === "IfcDoor" || m.entity === "IfcWindow") {
    qto = m.entity === "IfcDoor" ? "Qto_DoorBaseQuantities" : "Qto_WindowBaseQuantities";
    const h = safe(() => hostedPlacement(doc, el));
    len("Width", h?.width);
    len("Height", h?.height);
  } else if (m.entity === "IfcSpace") {
    qto = "Qto_SpaceBaseQuantities";
    const b = roomBoundary(doc, el as Room);
    const { bottom, top } = roomExtent(doc, el as Room);
    len("Height", top - bottom);
    area("NetFloorArea", b?.area);
    len("GrossPerimeter", b?.perimeter);
    vol("NetVolume", b ? b.area * (top - bottom) : undefined);
  }
  if (qto && q.length) {
    const eq = w.add("IfcElementQuantity", relGuid("qto"), null, qto, null, null, q);
    w.add("IfcRelDefinesByProperties", relGuid("defq"), null, null, null, [target], eq);
  }
}
