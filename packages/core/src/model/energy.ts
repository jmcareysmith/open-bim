import type { Document } from "../document.ts";
import { Cat, levels, type FloorParams, type LevelParams } from "./architecture.ts";
import { DEFAULT_H1, H1_CLASS_LABELS, h1Check, h1Settings, type ClimateZone, type H1Class } from "./h1.ts";
import { polygonArea } from "./sketch.ts";

// Energy analysis (Revit: Analyze → Energy Optimization; ours is a steady-state estimate on the
// H1 envelope): fabric heat loss Σ A/R from the H1 take-off (walls net of their windows and
// doors), ventilation 0.33·n·V, so H in W/K; peak heating load H·ΔT at the design temperature;
// annual heating H·HDD·24 h (no solar or internal gains — an upper bound); and the H1
// calculation-method comparison against a reference building with the schedule R-values and the
// glazing limit.
//
// PROVISIONAL (Jeremy: build with our own figures): heating degree-days (base 18 °C) and winter
// design temperatures per H1 climate zone, 0.5 air changes an hour, 20 °C indoors, 2.4 m storeys
// when there's no level above.

export const ZONE_CLIMATE: Record<ClimateZone, { hdd: number; design: number; label: string }> = {
  1: { hdd: 1100, design: 3, label: "Northland / Auckland" },
  2: { hdd: 1350, design: 1, label: "Waikato / Bay of Plenty" },
  3: { hdd: 1700, design: 0, label: "Lower North Island" },
  4: { hdd: 2100, design: -2, label: "Central Plateau / upper South Island" },
  5: { hdd: 2500, design: -3, label: "Canterbury / Otago coast" },
  6: { hdd: 3100, design: -5, label: "Inland South Island / Queenstown" },
};
export const AIR_CHANGES = 0.5;
export const INDOOR_TEMP = 20;

export interface EnergyRow {
  cls: H1Class;
  label: string;
  typeName: string;
  /** m², net for walls. */
  area: number;
  /** m²K/W used (the type's, else the H1 minimum when unset). */
  r: number;
  assumed: boolean;
  /** W/K */
  ua: number;
}

export interface EnergyReport {
  zone: ClimateZone;
  rows: EnergyRow[];
  /** Fabric and ventilation heat loss, W/K. */
  fabric: number;
  ventilation: number;
  total: number;
  /** m² heated floor, m³ volume. */
  floorArea: number;
  volume: number;
  /** Peak heating load, W, at the zone's design temperature. */
  peak: number;
  /** Annual heating demand, kWh, and per m² of floor. */
  annual: number;
  intensity: number;
  /** H1 calculation method: the reference building's fabric heat loss, W/K. */
  reference: number;
  /** Proposed fabric heat loss within the reference. */
  pass: boolean;
  notes: string[];
}

export function energyAnalysis(doc: Document): EnergyReport {
  const h1 = h1Check(doc);
  const zone = h1.zone;
  const req = h1Settings(doc).requirements ?? DEFAULT_H1;
  const climate = ZONE_CLIMATE[zone];
  const notes: string[] = [];
  // Windows and doors come out of the wall area they sit in (curtain walls are already glazing rows).
  const openings = h1.items.filter((i) => i.cls === "door" || (i.cls === "window" && !isCurtain(doc, i.typeId))).reduce((s, i) => s + i.area, 0);
  const grossWall = h1.items.filter((i) => i.cls === "wall").reduce((s, i) => s + i.area, 0);
  const netShare = grossWall > 0 ? Math.max(0, grossWall - openings) / grossWall : 0;
  const rows: EnergyRow[] = h1.items.map((i) => {
    const area = i.cls === "wall" ? i.area * netShare : i.area;
    const assumed = i.rValue === null;
    const r = i.rValue ?? i.required;
    return { cls: i.cls, label: H1_CLASS_LABELS[i.cls], typeName: i.typeName, area, r, assumed, ua: r > 0 ? area / r : 0 };
  });
  for (const row of rows) if (row.assumed) notes.push(`${row.typeName}: R-value not set, the H1 minimum (R${row.r.toFixed(2)}) is assumed.`);
  const fabric = rows.reduce((s, r) => s + r.ua, 0);

  // Floor area and volume: every floor below the top level, to the level above (or 2.4 m).
  const elevations = levels(doc).map((l) => (l.params as LevelParams).elevation).sort((a, b) => a - b);
  let floorArea = 0;
  let volume = 0;
  for (const f of doc.byCategory<FloorParams>(Cat.Floor)) {
    const z = doc.get<LevelParams>(f.params.levelId)?.params.elevation ?? 0;
    const above = elevations.find((e) => e > z + 1);
    const height = above !== undefined ? Math.min(above - z, 4000) : 2400;
    const a = (polygonArea(f.params.boundary) - f.params.holes.reduce((s, h) => s + polygonArea(h), 0)) / 1e6;
    floorArea += a;
    volume += (a * height) / 1000;
  }
  if (!floorArea) notes.push("No floors: floor area, volume and ventilation are zero.");
  const ventilation = 0.33 * AIR_CHANGES * volume;
  const total = fabric + ventilation;
  const peak = total * (INDOOR_TEMP - climate.design);
  const annual = (total * climate.hdd * 24) / 1000;

  // Reference building: schedule R-values; glazing over the limit counts as wall instead.
  const minR = (cls: H1Class) => req.minR[cls][zone - 1] ?? 1;
  const glazing = rows.filter((r) => r.cls === "window").reduce((s, r) => s + r.area, 0);
  const wallsAndGlazing = h1.wallArea;
  const refGlazing = Math.min(glazing, wallsAndGlazing * req.maxGlazingRatio);
  let reference = 0;
  for (const r of rows) if (r.cls !== "window" && r.cls !== "wall") reference += r.area / minR(r.cls);
  const doorArea = rows.filter((r) => r.cls === "door").reduce((s, r) => s + r.area, 0);
  reference += Math.max(0, wallsAndGlazing - refGlazing - doorArea) / minR("wall") + refGlazing / minR("window");
  notes.push("Provisional: steady-state estimate without solar or internal gains; degree-days, design temperatures and air changes are our own figures.");
  return { zone, rows, fabric, ventilation, total, floorArea, volume, peak, annual, intensity: floorArea ? annual / floorArea : 0, reference, pass: fabric <= reference + 1e-6, notes };
}

function isCurtain(doc: Document, typeId: string): boolean {
  return !!(doc.get(typeId)?.params as { curtain?: unknown } | undefined)?.curtain;
}
