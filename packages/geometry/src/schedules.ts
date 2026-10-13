import {
  AREA_SCHEMES,
  Cat,
  customValue,
  evaluate,
  formulaRefs,
  elementKeynote,
  elementMark,
  familyDefs,
  formatArea,
  formatLength,
  hostedPlacement,
  parametersFor,
  projectUnits,
  regionArea,
  roomExtent,
  totalThickness,
  wallCuts,
  wallExtent,
  wallLength,
  type Area,
  type CellValue,
  type Document,
  type Element,
  type ElementId,
  type FamilyDef,
  type FamilyInstanceParams,
  type LayeredTypeParams,
  type MaterialParams,
  type Region,
  type Room,
  type Schedule,
  type ScheduleFilter,
  type ScheduleTable,
  type TableRowKind,
  type UnitsSettings,
  type ViewParams,
  type Wall,
  type WallParams,
  type MassFloor,
  SYSTEM_CLASSIFICATIONS,
} from "@open-bim/core";
import { SimpleKernel } from "./kernel.ts";
import { meshVolume, type MeshData } from "./mesh.ts";
import { areaBoundary, roomBoundary } from "./rooms.ts";
import { massFloorArea } from "./massfloors.ts";

// Schedule evaluation: a field registry per category, then filter → sort → group/collapse → totals.
// Values are kept in model units (mm, mm², mm³) until display, so totals are exact.

/** "total": a number that sums in totals (calculated numbers such as costs). */
export type FieldKind = "text" | "count" | "length" | "area" | "volume" | "number" | "total";

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  get(doc: Document, el: Element, layer?: TakeoffLayer): CellValue | undefined;
}

/** A layer of a layered element, for material takeoffs. */
export interface TakeoffLayer {
  material: string;
  thickness: number;
}

const ADDITIVE = new Set<FieldKind>(["count", "length", "area", "volume", "total"]);

const nameOf = (doc: Document, id: ElementId | null | undefined) => (id ? (doc.get(id)?.name ?? "") : "");

function familyOf(doc: Document, el: Element): FamilyDef | undefined {
  return el.category === Cat.FamilyInstance ? (doc.get((el.params as FamilyInstanceParams).familyId) as FamilyDef | undefined) : undefined;
}

function typeName(doc: Document, el: Element): string {
  if (el.category === Cat.FamilyInstance) return (el.params as FamilyInstanceParams).typeName;
  return nameOf(doc, el.typeId);
}

function familyName(doc: Document, el: Element): string {
  const def = familyOf(doc, el);
  if (def) return def.name ?? "";
  return (
    {
      [Cat.Wall]: "Basic Wall",
      [Cat.Floor]: "Floor",
      [Cat.Ceiling]: "Compound Ceiling",
      [Cat.Roof]: "Basic Roof",
      [Cat.Door]: "Single Door",
      [Cat.Window]: "Fixed Window",
    }[el.category] ?? el.category
  );
}

function levelOf(doc: Document, el: Element): string {
  const p = el.params as Record<string, unknown>;
  if (el.category === Cat.Wall) return nameOf(doc, (p as WallParams).baseLevelId);
  if (el.category === Cat.Area) return nameOf(doc, doc.get<ViewParams>((el as Area).params.viewId)?.params.levelId);
  if (el.category === Cat.Door || el.category === Cat.Window || (el.category === Cat.FamilyInstance && (p as FamilyInstanceParams).hostId)) {
    const host = doc.get<WallParams>(String(p.hostId));
    return host ? nameOf(doc, host.params.baseLevelId) : "";
  }
  return nameOf(doc, p.levelId as ElementId | undefined);
}

function wallNetArea(doc: Document, w: Wall): number {
  const { bottom, top } = wallExtent(doc, w);
  const len = wallLength(w);
  const cuts = wallCuts(doc, w).reduce((s, c) => {
    const u = Math.max(0, Math.min(len, c.u1) - Math.max(0, c.u0));
    const z = Math.max(0, Math.min(top, c.z1) - Math.max(bottom, c.z0));
    return s + u * z;
  }, 0);
  return len * (top - bottom) - cuts;
}

let kernel: SimpleKernel | null = null;
function mesh(doc: Document, el: Element): MeshData | null {
  kernel ??= new SimpleKernel();
  try {
    return kernel.build(doc, el);
  } catch {
    return null;
  }
}

/** Upward-facing area of a mesh (a roof's sloped top surface). */
function topArea(m: MeshData): number {
  let s = 0;
  const p = m.positions;
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [m.indices[t]! * 3, m.indices[t + 1]! * 3, m.indices[t + 2]! * 3];
    const u = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!];
    const v = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!];
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const len = Math.hypot(n[0]!, n[1]!, n[2]!);
    if (len > 0 && n[2]! / len > 0.05) s += len / 2;
  }
  return s;
}

/** Area used for schedules and takeoffs: walls net of openings, sketched elements by region, roofs sloped. */
export function elementArea(doc: Document, el: Element): number | undefined {
  switch (el.category) {
    case Cat.Wall:
      return wallNetArea(doc, el as Wall);
    case Cat.Floor:
    case Cat.Ceiling:
      return regionArea(el.params as unknown as Region);
    case Cat.Roof: {
      const m = mesh(doc, el);
      return m ? topArea(m) : undefined;
    }
    case Cat.Room:
      return roomBoundary(doc, el as Room)?.area;
    case Cat.Area:
      return areaBoundary(doc, el as Area)?.area;
    default:
      return undefined;
  }
}

function typeThickness(doc: Document, el: Element): number | undefined {
  const t = el.typeId ? doc.get<LayeredTypeParams>(el.typeId) : undefined;
  return t?.params.layers ? totalThickness(t) : undefined;
}

export function elementVolume(doc: Document, el: Element): number | undefined {
  if (el.category === Cat.Room) {
    const r = el as Room;
    const a = roomBoundary(doc, r)?.area;
    const { bottom, top } = roomExtent(doc, r);
    return a === undefined ? undefined : a * (top - bottom);
  }
  if (el.category === Cat.Roof) {
    const m = mesh(doc, el);
    return m ? meshVolume(m) : undefined;
  }
  const a = elementArea(doc, el);
  const t = typeThickness(doc, el);
  return a !== undefined && t !== undefined ? a * t : undefined;
}

const COMMON: FieldDef[] = [
  { key: "count", label: "Count", kind: "count", get: () => 1 },
  { key: "family", label: "Family", kind: "text", get: (d, e) => familyName(d, e) },
  { key: "type", label: "Type", kind: "text", get: (d, e) => typeName(d, e) },
  { key: "familyAndType", label: "Family and Type", kind: "text", get: (d, e) => `${familyName(d, e)}: ${typeName(d, e)}` },
  { key: "level", label: "Level", kind: "text", get: (d, e) => levelOf(d, e) },
  { key: "mark", label: "Mark", kind: "text", get: (_d, e) => elementMark(e) ?? "" },
  { key: "keynote", label: "Keynote", kind: "text", get: (d, e) => elementKeynote(d, e) ?? "" },
];

const OPENING: FieldDef[] = [
  { key: "width", label: "Width", kind: "length", get: (d, e) => hostedPlacement(d, e).width },
  { key: "height", label: "Height", kind: "length", get: (d, e) => hostedPlacement(d, e).height },
  { key: "sillHeight", label: "Sill Height", kind: "length", get: (d, e) => hostedPlacement(d, e).sillHeight },
  { key: "hostType", label: "Host Wall Type", kind: "text", get: (d, e) => nameOf(d, d.get(hostedPlacement(d, e).hostId)?.typeId) },
];

const SKETCHED: FieldDef[] = [
  { key: "area", label: "Area", kind: "area", get: (d, e) => elementArea(d, e) },
  { key: "volume", label: "Volume", kind: "volume", get: (d, e) => elementVolume(d, e) },
  { key: "thickness", label: "Thickness", kind: "length", get: (d, e) => typeThickness(d, e) },
];

/** Schedulable categories made of loadable families. */
const FAMILY_SCHEDULE_CATEGORIES = new Set(["Furniture", "Casework", "GenericModel", "AirTerminal", "MechanicalEquipment", "PlumbingFixture", "ElectricalFixture", "LightingFixture", "ElectricalEquipment"]);

/** MEP run fields: system, size and length. */
const runFields: FieldDef[] = [
  { key: "system", label: "System", kind: "text", get: (_d, e) => { const c = (e.params as { classification?: string }).classification; return c ? (SYSTEM_CLASSIFICATIONS.find((x) => x.value === c)?.label ?? c) : ""; } },
  { key: "size", label: "Size", kind: "text", get: (_d, e) => { const p = e.params as { diameter?: number; width?: number; height?: number }; return e.category === Cat.CableTray || (e.category === Cat.Duct && p.width && !p.diameter) ? `${p.width}×${p.height}` : `Ø${p.diameter}`; } },
  { key: "length", label: "Length", kind: "length", get: (_d, e) => { const p = e.params as { start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } }; return Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y, p.end.z - p.start.z); } },
];

const BY_CATEGORY: Record<string, FieldDef[]> = {
  [Cat.Duct]: runFields,
  [Cat.Pipe]: runFields,
  [Cat.CableTray]: runFields.filter((f) => f.key !== "system"),
  [Cat.Conduit]: runFields.filter((f) => f.key !== "system"),
  [Cat.DuctFitting]: [{ key: "kind", label: "Fitting", kind: "text", get: (_d, e) => (e.params as { kind: string }).kind }],
  [Cat.PipeFitting]: [{ key: "kind", label: "Fitting", kind: "text", get: (_d, e) => (e.params as { kind: string }).kind }],
  [Cat.MassFloor]: [
    { key: "mass", label: "Mass", kind: "text", get: (d, e) => { const m = d.get((e.params as { massId: ElementId }).massId); return m ? familyName(d, m) : "" } },
    { key: "area", label: "Floor Area", kind: "area", get: (d, e) => massFloorArea(d, e as MassFloor).area },
    { key: "perimeter", label: "Floor Perimeter", kind: "length", get: (d, e) => massFloorArea(d, e as MassFloor).perimeter },
  ],
  [Cat.Wall]: [
    { key: "length", label: "Length", kind: "length", get: (_d, e) => wallLength(e as Wall) },
    { key: "height", label: "Height", kind: "length", get: (d, e) => wallExtent(d, e as Wall).top - wallExtent(d, e as Wall).bottom },
    { key: "area", label: "Area", kind: "area", get: (d, e) => elementArea(d, e) },
    { key: "volume", label: "Volume", kind: "volume", get: (d, e) => elementVolume(d, e) },
    { key: "thickness", label: "Width", kind: "length", get: (d, e) => typeThickness(d, e) },
  ],
  [Cat.Door]: OPENING,
  [Cat.Window]: OPENING,
  [Cat.Floor]: SKETCHED,
  [Cat.Ceiling]: SKETCHED,
  [Cat.Roof]: SKETCHED,
  [Cat.Room]: [
    { key: "number", label: "Number", kind: "text", get: (_d, e) => (e as Room).params.number },
    { key: "name", label: "Name", kind: "text", get: (_d, e) => e.name ?? "" },
    { key: "area", label: "Area", kind: "area", get: (d, e) => elementArea(d, e) },
    { key: "perimeter", label: "Perimeter", kind: "length", get: (d, e) => roomBoundary(d, e as Room)?.perimeter },
    { key: "unboundedHeight", label: "Unbounded Height", kind: "length", get: (d, e) => roomExtent(d, e as Room).top - roomExtent(d, e as Room).bottom },
    { key: "volume", label: "Volume", kind: "volume", get: (d, e) => elementVolume(d, e) },
  ],
  [Cat.Area]: [
    { key: "name", label: "Name", kind: "text", get: (_d, e) => e.name ?? "" },
    { key: "number", label: "Number", kind: "text", get: (_d, e) => (e as Area).params.number },
    { key: "area", label: "Area", kind: "area", get: (d, e) => elementArea(d, e) },
    { key: "perimeter", label: "Perimeter", kind: "length", get: (d, e) => areaBoundary(d, e as Area)?.perimeter },
    {
      key: "scheme",
      label: "Area Scheme",
      kind: "text",
      get: (d, e) => {
        const s = d.get<ViewParams>((e as Area).params.viewId)?.params.areaScheme;
        return s ? AREA_SCHEMES[s].label : "";
      },
    },
  ],
};

const TAKEOFF: FieldDef[] = [
  { key: "materialName", label: "Material: Name", kind: "text", get: (_d, _e, l) => l?.material ?? "" },
  { key: "materialThickness", label: "Material: Thickness", kind: "length", get: (_d, _e, l) => l?.thickness },
  { key: "materialArea", label: "Material: Area", kind: "area", get: (d, e) => elementArea(d, e) },
  { key: "materialVolume", label: "Material: Volume", kind: "volume", get: (d, e, l) => (l ? (elementArea(d, e) ?? 0) * l.thickness : undefined) },
];

/** Fields available to a schedule: common, the category's own, takeoff fields, and project parameters. */
/** Model units per SI unit, for calculated fields (mm per m, mm² per m², mm³ per m³). */
const SI: Partial<Record<FieldKind, number>> = { length: 1e3, area: 1e6, volume: 1e9 };

/** Calculated fields: each formula over the other fields (and earlier calculated ones) by label. */
function calculatedFields(s: Pick<Schedule["params"], "calculated">, base: FieldDef[]): FieldDef[] {
  const out: FieldDef[] = [];
  for (const c of s.calculated ?? []) {
    const known = [...base, ...out];
    out.push({
      key: `calc:${c.name}`,
      label: c.name,
      kind: c.type === "number" ? "total" : c.type,
      get: (doc, el, layer) => {
        const values: Record<string, number> = {};
        for (const name of formulaRefs(c.formula, known.map((f) => f.label))) {
          const f = known.find((x) => x.label === name)!;
          const v = f.get(doc, el, layer);
          if (typeof v !== "number") return undefined;
          values[name] = v / (SI[f.kind] ?? 1);
        }
        const r = evaluate(c.formula, values);
        return Number.isFinite(r) ? r * (SI[c.type] ?? 1) : undefined;
      },
    });
  }
  return out;
}

export function scheduleFields(doc: Document, s: Pick<Schedule["params"], "category" | "kind"> & Partial<Pick<Schedule["params"], "calculated">>): FieldDef[] {
  const base = scheduleBaseFields(doc, s);
  return [...base, ...calculatedFields(s, base)];
}

function scheduleBaseFields(doc: Document, s: Pick<Schedule["params"], "category" | "kind">): FieldDef[] {
  const elCat = elementCategory(s.category);
  const own = BY_CATEGORY[elCat] ?? [];
  const common = COMMON.filter((f) => !(f.key === "type" && elCat === Cat.Room) && !(elCat === Cat.Area && ["family", "type", "familyAndType"].includes(f.key)));
  const params: FieldDef[] = parametersFor(doc, elCat).map((p) => ({
    key: `param:${p.name}`,
    label: p.name ?? "",
    kind: p.params.dataType === "length" ? "length" : p.params.dataType === "area" ? "area" : p.params.dataType === "number" ? "number" : "text",
    get: (d, e) => {
      const v = customValue(d, e, p.name ?? "");
      if (typeof v === "boolean") return v ? "Yes" : "No";
      return typeof v === "string" || typeof v === "number" ? v : undefined;
    },
  }));
  return [...common, ...own.filter((f) => !common.some((c) => c.key === f.key)), ...(s.kind === "takeoff" ? TAKEOFF : []), ...params];
}

/** Family categories schedule family instances; element categories also include families of that category. */
function elementCategory(category: string): string {
  return FAMILY_SCHEDULE_CATEGORIES.has(category) ? Cat.FamilyInstance : category;
}

export function scheduleElements(doc: Document, category: string): Element[] {
  const fam = (c: string) => {
    const defs = new Set(familyDefs(doc).filter((d) => d.params.category === c).map((d) => d.id));
    return doc.byCategory<FamilyInstanceParams>(Cat.FamilyInstance).filter((i) => defs.has(i.params.familyId));
  };
  if (FAMILY_SCHEDULE_CATEGORIES.has(category)) return fam(category);
  if (category === Cat.Door || category === Cat.Window) return [...doc.byCategory(category), ...fam(category)];
  return doc.byCategory(category);
}

interface Item {
  ids: string[];
  values: (CellValue | undefined)[];
}

/** Compute a schedule's table. */
export function scheduleTable(doc: Document, schedule: Schedule): ScheduleTable {
  const s = schedule.params;
  const all = scheduleFields(doc, s);
  const byKey = new Map(all.map((f) => [f.key, f]));
  const fields = s.fields.map((k) => byKey.get(k)).filter((f): f is FieldDef => !!f);
  const units = projectUnits(doc);
  // Values needed: shown fields plus any used only for filtering/sorting.
  const keys = [...new Set([...fields.map((f) => f.key), ...s.filters.map((f) => f.field), ...s.sort.map((x) => x.field)])].filter((k) => byKey.has(k));
  const col = new Map(keys.map((k, i) => [k, i]));

  let items: Item[] = [];
  for (const el of scheduleElements(doc, s.category)) {
    const layers: (TakeoffLayer | undefined)[] = s.kind === "takeoff" ? takeoffLayers(doc, el) : [undefined];
    for (const layer of layers) {
      items.push({
        ids: [el.id],
        values: keys.map((k) => {
          try {
            return byKey.get(k)!.get(doc, el, layer);
          } catch {
            return undefined;
          }
        }),
      });
    }
  }

  items = items.filter((it) => s.filters.every((f) => passes(f, it.values[col.get(f.field) ?? -1], byKey.get(f.field)?.kind ?? "text", units)));
  const cmp = (a: CellValue | undefined, b: CellValue | undefined) =>
    typeof a === "number" && typeof b === "number" ? a - b : String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true });
  items.sort((a, b) => {
    for (const o of s.sort) {
      const i = col.get(o.field);
      if (i === undefined) continue;
      const c = cmp(a.values[i], b.values[i]);
      if (c) return o.descending ? -c : c;
    }
    return 0;
  });

  if (!s.itemize) {
    // Rows with equal sort keys collapse: additive fields sum, others show when they agree.
    const sortIdx = s.sort.map((o) => col.get(o.field)).filter((i): i is number => i !== undefined);
    const merged: Item[] = [];
    for (const it of items) {
      const last = merged.at(-1);
      if (last && sortIdx.every((i) => last.values[i] === it.values[i])) {
        last.ids.push(...it.ids);
        last.values = last.values.map((v, i) => combine(byKey.get(keys[i]!)!.kind, v, it.values[i]));
      } else merged.push({ ids: [...it.ids], values: [...it.values] });
    }
    items = merged;
  }

  const display = (f: FieldDef, v: CellValue | undefined): { text: string; value: CellValue } => format(f.kind, v, units);
  const out: ScheduleTable = { title: schedule.name ?? "Schedule", headings: fields.map((f) => f.label), rows: [] };
  const push = (kind: TableRowKind, it: Item, label?: string) => {
    const cells = fields.map((f) => {
      const i = col.get(f.key)!;
      const additive = ADDITIVE.has(f.kind);
      if (kind !== "row" && !additive) return { text: "", value: null as CellValue };
      return display(f, it.values[i]);
    });
    if (label !== undefined && cells.length) cells[0] = { text: label, value: label };
    out.rows.push({ kind, cells: cells.map((c) => c.text), values: cells.map((c) => c.value), ids: it.ids });
  };
  const sum = (group: Item[]): Item => ({
    ids: group.flatMap((g) => g.ids),
    values: keys.map((k, i) => (ADDITIVE.has(byKey.get(k)!.kind) ? group.reduce((s2, g) => s2 + (typeof g.values[i] === "number" ? (g.values[i] as number) : 0), 0) : undefined)),
  });

  const emit = (group: Item[], level: number) => {
    const o = s.sort[level];
    const i = o ? col.get(o.field) : undefined;
    if (!o || i === undefined || (!o.header && !o.footer)) {
      if (o && i !== undefined) return emit(group, level + 1);
      for (const it of group) push("row", it);
      return;
    }
    let start = 0;
    while (start < group.length) {
      let end = start + 1;
      while (end < group.length && group[end]!.values[i] === group[start]!.values[i]) end++;
      const g = group.slice(start, end);
      const f = byKey.get(o.field)!;
      const label = display(f, g[0]!.values[i]).text || "(none)";
      if (o.header) out.rows.push({ kind: "header", cells: fields.map((_, c) => (c === 0 ? label : "")), values: fields.map(() => null), ids: [] });
      emit(g, level + 1);
      if (o.footer) push("subtotal", sum(g), o.header ? `${g.length}` : label);
      start = end;
    }
  };
  emit(items, 0);
  if (s.grandTotals) push("total", sum(items), "Grand total");
  return out;
}

function takeoffLayers(doc: Document, el: Element): TakeoffLayer[] {
  const t = el.typeId ? doc.get<LayeredTypeParams>(el.typeId) : undefined;
  return (t?.params.layers ?? []).map((l) => ({
    material: (l.materialId ? doc.get<MaterialParams>(l.materialId)?.name : undefined) ?? l.material,
    thickness: l.thickness,
  }));
}

function combine(kind: FieldKind, a: CellValue | undefined, b: CellValue | undefined): CellValue | undefined {
  if (ADDITIVE.has(kind)) return (typeof a === "number" ? a : 0) + (typeof b === "number" ? b : 0);
  return a === b ? a : undefined;
}

const LENGTH_FACTOR = { mm: 1, cm: 10, m: 1000 } as const;

/** Display text, and the number a spreadsheet should get (in the displayed unit). */
function format(kind: FieldKind, v: CellValue | undefined, units: UnitsSettings): { text: string; value: CellValue } {
  if (v === undefined || v === null || v === "") return { text: "", value: null };
  if (typeof v === "string") return { text: v, value: v };
  switch (kind) {
    case "length":
      return { text: formatLength(v, units), value: v / LENGTH_FACTOR[units.length.unit] };
    case "area":
      return { text: formatArea(v, units), value: units.area.unit === "m2" ? v / 1e6 : v };
    case "volume":
      return { text: `${(v / 1e9).toFixed(2)} m³`, value: Math.round((v / 1e9) * 1000) / 1000 };
    case "total": {
      const r = Math.round(v * 100) / 100;
      return { text: r.toLocaleString("en-NZ", { maximumFractionDigits: 2 }), value: r };
    }
    default:
      return { text: String(v), value: v };
  }
}

/** Filter values are typed in display units (e.g. "10" m² for areas, "2400" mm for lengths). */
function passes(f: ScheduleFilter, v: CellValue | undefined, kind: FieldKind, units: UnitsSettings): boolean {
  const shown = format(kind, v, units).value;
  if (typeof shown === "number" && f.value.trim() !== "" && Number.isFinite(Number(f.value))) {
    const x = Number(f.value);
    switch (f.op) {
      case "eq":
        return Math.abs(shown - x) < 1e-6;
      case "ne":
        return Math.abs(shown - x) >= 1e-6;
      case "gt":
        return shown > x;
      case "lt":
        return shown < x;
      default:
        break;
    }
  }
  const a = String(shown ?? "").toLowerCase();
  const b = f.value.toLowerCase();
  switch (f.op) {
    case "eq":
      return a === b;
    case "ne":
      return a !== b;
    case "contains":
      return a.includes(b);
    case "notContains":
      return !a.includes(b);
    case "gt":
      return a.localeCompare(b, undefined, { numeric: true }) > 0;
    case "lt":
      return a.localeCompare(b, undefined, { numeric: true }) < 0;
  }
}
