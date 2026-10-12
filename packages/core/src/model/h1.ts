import type { Document, Transaction } from "../document.ts";
import type { Element } from "../element.ts";
import { Cat, wallExtent, wallLength, levels, type FloorParams, type LayeredTypeParams, type Wall } from "./architecture.ts";
import { doorPlacement, windowPlacement } from "./doors.ts";
import { layerMaterial } from "./materials.ts";
import { ensureProjectSettings, projectSettings, type ProjectSettingsParams } from "./settings.ts";
import { polygonArea } from "./sketch.ts";

// NZBC H1 energy efficiency, schedule method (H1/AS1, housing). Each element of the thermal
// envelope must meet a minimum construction R-value for the climate zone, and glazing must stay
// within an area limit. Construction R-values (m²K/W, including framing) are type properties, as
// taken from e.g. the BRANZ House Insulation Guide or manufacturers' data.
//
// PROVISIONAL: the default requirements below are from memory of H1/AS1 6th edition (2023) for
// housing and must be checked against the current document. They are held per project and can be
// edited (Project Information → H1 energy).

export type ClimateZone = 1 | 2 | 3 | 4 | 5 | 6;
export type H1Class = "roof" | "wall" | "slab" | "suspended" | "window" | "door";

export type H1Requirements = {
  /** Minimum construction R-value per element class, per climate zone (index 0 = zone 1). */
  minR: Record<H1Class, number[]>;
  /** Maximum vertical glazing (windows, glazed doors, curtain walls) as a fraction of wall area. */
  maxGlazingRatio: number;
};

export const DEFAULT_H1: H1Requirements = {
  minR: {
    roof: [6.6, 6.6, 6.6, 6.6, 6.6, 6.6],
    wall: [2.0, 2.0, 2.0, 2.0, 2.0, 2.0],
    slab: [1.5, 1.5, 1.5, 1.5, 1.5, 1.5],
    suspended: [2.5, 2.5, 2.5, 2.5, 2.5, 2.5],
    window: [0.46, 0.46, 0.46, 0.46, 0.5, 0.5],
    door: [0.46, 0.46, 0.46, 0.46, 0.5, 0.5],
  },
  maxGlazingRatio: 0.3,
};

export const H1_CLASS_LABELS: Record<H1Class, string> = {
  roof: "Roofs",
  wall: "Walls",
  slab: "Slab-on-ground floors",
  suspended: "Other (suspended) floors",
  window: "Windows and glazing",
  door: "Doors",
};

/** H1 settings kept in project settings. */
export type H1Settings = { climateZone: ClimateZone; requirements?: H1Requirements | null };

export function h1Settings(doc: Document): H1Settings {
  return projectSettings(doc)?.params.h1 ?? { climateZone: 1 };
}

export function setH1Settings(tx: Transaction, doc: Document, patch: Partial<H1Settings>): void {
  const s = ensureProjectSettings(tx, doc);
  tx.update<ProjectSettingsParams>(s.id, { h1: { ...h1Settings(doc), ...patch } });
}

/** Type thermal properties (on wall/floor/roof/window/door types). */
export type ThermalTypeParams = {
  /** Construction R-value, m²K/W (including framing). */
  rValue?: number | null;
  /** Wall types: exterior walls form the envelope; interior walls don't. */
  function?: "exterior" | "interior" | null;
  /** Floor types: how H1 treats it (default: by level and construction). */
  thermalKind?: "slab" | "suspended" | "intermediate" | null;
};

/** Wall type function: as set, else interior if its name says so, else exterior. */
export function wallFunction(type: Element | undefined): "exterior" | "interior" {
  const f = (type?.params as ThermalTypeParams | undefined)?.function;
  if (f) return f;
  return /interior|internal|partition/i.test(type?.name ?? "") ? "interior" : "exterior";
}

/** Floor kind: as set, else floors on the lowest level are slab (concrete) or suspended; others intermediate. */
export function floorKind(doc: Document, floor: Element): "slab" | "suspended" | "intermediate" {
  const type = floor.typeId ? doc.get(floor.typeId) : undefined;
  const k = (type?.params as ThermalTypeParams | undefined)?.thermalKind;
  if (k) return k;
  const lowest = levels(doc)[0]?.id;
  if ((floor.params as FloorParams).levelId !== lowest) return "intermediate";
  const layers = (type?.params as LayeredTypeParams | undefined)?.layers ?? [];
  const concrete = layers.some((l) => /concrete/i.test(layerMaterial(doc, l)?.name ?? l.material));
  return concrete ? "slab" : "suspended";
}

export type H1Item = {
  cls: H1Class;
  /** Type (one row per type in use). */
  typeId: string;
  typeName: string;
  count: number;
  /** m² */
  area: number;
  rValue: number | null;
  required: number;
  pass: boolean;
};

export type H1Report = {
  zone: ClimateZone;
  items: H1Item[];
  /** m² */
  wallArea: number;
  glazingArea: number;
  glazingRatio: number;
  maxGlazingRatio: number;
  glazingPass: boolean;
  /** Messages for anything the check couldn't assess. */
  notes: string[];
  pass: boolean;
};

const typeR = (t: Element | undefined): number | null => {
  const r = (t?.params as ThermalTypeParams | undefined)?.rValue;
  return typeof r === "number" && r > 0 ? r : null;
};

/** Run the H1/AS1 schedule-method check over the model. */
export function h1Check(doc: Document): H1Report {
  const { climateZone: zone, requirements } = h1Settings(doc);
  const req = requirements ?? DEFAULT_H1;
  const rows = new Map<string, H1Item>();
  const notes: string[] = [];
  const add = (cls: H1Class, type: Element | undefined, area: number) => {
    if (!type) return;
    const key = `${cls}:${type.id}`;
    let row = rows.get(key);
    if (!row) {
      const rValue = typeR(type);
      const required = req.minR[cls][zone - 1] ?? 0;
      row = { cls, typeId: type.id, typeName: type.name ?? type.id, count: 0, area: 0, rValue, required, pass: rValue !== null && rValue >= required - 1e-9 };
      rows.set(key, row);
    }
    row.count++;
    row.area += area;
  };

  let wallArea = 0;
  let glazingArea = 0;
  const exteriorWalls = new Set<string>();
  for (const w of doc.byCategory(Cat.Wall) as Wall[]) {
    const type = w.typeId ? doc.get<LayeredTypeParams>(w.typeId) : undefined;
    if (wallFunction(type) !== "exterior") continue;
    exteriorWalls.add(w.id);
    const { bottom, top } = wallExtent(doc, w);
    const area = (wallLength(w) * (top - bottom)) / 1e6;
    wallArea += area;
    if (type?.params.curtain) {
      glazingArea += area;
      add("window", type, area);
    } else add("wall", type, area);
  }
  // Openings: glazing area counts against the limit; wall rows keep gross area (H1/AS1 uses the
  // total wall area including openings for the ratio).
  for (const win of doc.byCategory(Cat.Window)) {
    const p = windowPlacement(doc, win);
    if (!exteriorWalls.has(p.hostId)) continue;
    const area = (p.width * p.height) / 1e6;
    glazingArea += area;
    add("window", win.typeId ? doc.get(win.typeId) : undefined, area);
  }
  for (const d of doc.byCategory(Cat.Door)) {
    const p = doorPlacement(doc, d);
    if (!exteriorWalls.has(p.hostId)) continue;
    add("door", d.typeId ? doc.get(d.typeId) : undefined, (p.width * p.height) / 1e6);
  }
  for (const r of doc.byCategory(Cat.Roof)) {
    add("roof", r.typeId ? doc.get(r.typeId) : undefined, polygonArea((r.params as { boundary: FloorParams["boundary"] }).boundary) / 1e6);
  }
  for (const f of doc.byCategory(Cat.Floor)) {
    const kind = floorKind(doc, f);
    if (kind === "intermediate") continue;
    add(kind, f.typeId ? doc.get(f.typeId) : undefined, polygonArea((f.params as FloorParams).boundary) / 1e6);
  }

  const items = [...rows.values()].sort((a, b) => Object.keys(H1_CLASS_LABELS).indexOf(a.cls) - Object.keys(H1_CLASS_LABELS).indexOf(b.cls));
  for (const i of items) if (i.rValue === null) notes.push(`${i.typeName}: construction R-value not set (type properties).`);
  if (!items.some((i) => i.cls === "roof")) notes.push("No roofs in the model.");
  if (!wallArea) notes.push("No exterior walls in the model.");
  const glazingRatio = wallArea ? glazingArea / wallArea : 0;
  const glazingPass = glazingRatio <= req.maxGlazingRatio + 1e-9;
  return {
    zone,
    items,
    wallArea,
    glazingArea,
    glazingRatio,
    maxGlazingRatio: req.maxGlazingRatio,
    glazingPass,
    notes,
    pass: glazingPass && items.length > 0 && items.every((i) => i.pass),
  };
}
