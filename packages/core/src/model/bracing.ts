import type { Document, Transaction } from "../document.ts";
import type { ElementId } from "../element.ts";
import { Cat, levels, wallExtent, wallLength, type FloorParams, type LayeredTypeParams, type Level, type Wall, type WallParams } from "./architecture.ts";
import { wallFunction } from "./h1.ts";
import { roofBaseElevation, roofHeightAt, roofPlanes, type Roof } from "./roofs.ts";
import { ensureProjectSettings, projectSettings, type ProjectSettingsParams } from "./settings.ts";
import { pointInPolygon, polygonArea } from "./sketch.ts";

// NZS 3604 bracing (timber-framed buildings). Bracing panels sit on walls and carry a rating in
// bracing units (BU) per metre for wind and earthquake. Walls group into bracing lines per storey and
// direction; each storey's demand is compared with the capacity of its lines, and each line with the
// minimum a line must carry. 20 BU = 1 kN.
//
// PROVISIONAL: demand here is estimated from first principles (design wind speed per NZS 3604 wind
// zone; seismic weight × a coefficient per earthquake zone), not read from NZS 3604 Tables 5.5–5.10,
// and the system ratings are nominal. Every number is a project setting, and each storey's demand
// can be overridden with the tabulated value. Check against NZS 3604:2011 and manufacturers' data.

export type WindZone = "L" | "M" | "H" | "VH" | "EH";
export type Direction = "x" | "y";

export type BracingSystem = { name: string; windPerM: number; eqPerM: number; minLength: number };

export type BracingSettings = {
  windZone: WindZone;
  eqZone: 1 | 2 | 3 | 4;
  /** Roof weight, kPa (light steel ≈ 0.2; concrete tile ≈ 0.6). */
  roofKPa: number;
  /** Exterior cladding weight, kPa (weatherboard ≈ 0.3; brick veneer ≈ 2.2). */
  claddingKPa: number;
  /** Floor seismic weight including the live-load share, kPa. */
  floorKPa: number;
  /** Design wind speed per zone, m/s. */
  windSpeeds: Record<WindZone, number>;
  /** Net pressure coefficient on the building's elevation. */
  windCoefficient: number;
  /** Seismic coefficient per earthquake zone (index 0 = zone 1). */
  eqCoefficients: number[];
  /** Walls within this distance of each other (perpendicular, mm) form one bracing line. */
  lineTolerance: number;
  /** Maximum distance between adjacent bracing lines, mm. */
  maxLineSpacing: number;
  /** A line must carry at least this many BU, or `lineShare` of the storey demand per line. */
  minLineBU: number;
  lineShare: number;
  systems: BracingSystem[];
  /** Tabulated demand overrides (BU) per base level id and direction. */
  overrides?: Record<string, Partial<Record<`wind${"X" | "Y"}` | `eq${"X" | "Y"}`, number>>> | null;
};

export const DEFAULT_BRACING: BracingSettings = {
  windZone: "H",
  eqZone: 2,
  roofKPa: 0.2,
  claddingKPa: 0.3,
  floorKPa: 0.9,
  windSpeeds: { L: 32, M: 37, H: 44, VH: 50, EH: 55 },
  windCoefficient: 1.2,
  eqCoefficients: [0.08, 0.12, 0.16, 0.2],
  lineTolerance: 650,
  maxLineSpacing: 6000,
  minLineBU: 100,
  lineShare: 0.5,
  systems: [
    { name: "Lining one side (nominal)", windPerM: 55, eqPerM: 50, minLength: 400 },
    { name: "Lining both sides (nominal)", windPerM: 95, eqPerM: 85, minLength: 400 },
    { name: "Ply sheathing with hold-downs (nominal)", windPerM: 150, eqPerM: 135, minLength: 600 },
  ],
};

/** A bracing panel on a wall: system name, start along the wall (mm from its start) and length. */
export type BracingPanel = { system: string; offset: number; length: number };
export type BracedWallParams = WallParams & { bracing?: BracingPanel[] | null };

export function bracingSettings(doc: Document): BracingSettings {
  const s = projectSettings(doc)?.params.bracing;
  return { ...DEFAULT_BRACING, ...(s ?? {}) };
}

export function setBracingSettings(tx: Transaction, doc: Document, patch: Partial<BracingSettings>): void {
  const s = ensureProjectSettings(tx, doc);
  tx.update<ProjectSettingsParams>(s.id, { bracing: { ...bracingSettings(doc), ...patch } });
}

/** Set a wall's bracing panels (validated against the wall's length and the systems' minimum lengths). */
export function setWallBracing(tx: Transaction, doc: Document, wallId: ElementId, panels: BracingPanel[]): void {
  const wall = doc.require<WallParams>(wallId) as Wall;
  const len = wallLength(wall);
  const systems = bracingSettings(doc).systems;
  for (const p of panels) {
    const sys = systems.find((s) => s.name === p.system);
    if (!sys) throw new Error(`Unknown bracing system "${p.system}"`);
    if (p.length < sys.minLength) throw new Error(`${p.system} panels must be at least ${sys.minLength} mm long`);
    if (p.offset < -1e-6 || p.offset + p.length > len + 1e-6) throw new Error("Bracing panel runs past the end of the wall");
  }
  tx.update<BracedWallParams>(wallId, { bracing: panels.map((p) => ({ ...p })) });
}

export type BracingLine = {
  direction: Direction;
  /** Perpendicular position (y for x-lines, x for y-lines), mm. */
  position: number;
  /** Plan length of the walls on the line, mm. */
  length: number;
  walls: ElementId[];
  wind: number;
  eq: number;
  /** Minimum BU this line must carry (both wind and earthquake). */
  required: number;
  pass: boolean;
};

export type StoreyBracing = {
  levelId: ElementId;
  levelName: string;
  direction: Direction;
  demandWind: number;
  demandEq: number;
  overridden: boolean;
  capacityWind: number;
  capacityEq: number;
  lines: BracingLine[];
  /** Largest gap between adjacent lines, mm. */
  maxSpacing: number;
  spacingPass: boolean;
  pass: boolean;
};

export type BracingReport = { storeys: StoreyBracing[]; notes: string[]; pass: boolean };

type Box = { minX: number; minY: number; maxX: number; maxY: number };

function wallsBox(walls: Wall[]): Box | null {
  if (!walls.length) return null;
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const w of walls)
    for (const p of [w.params.start, w.params.end]) {
      b.minX = Math.min(b.minX, p.x);
      b.minY = Math.min(b.minY, p.y);
      b.maxX = Math.max(b.maxX, p.x);
      b.maxY = Math.max(b.maxY, p.y);
    }
  return b;
}

/** Highest point of a roof (sampled), absolute mm. */
function roofTop(doc: Document, roof: Roof): number {
  const { boundary, slopes } = roof.params;
  const planes = roofPlanes(boundary, slopes);
  const xs = boundary.map((p) => p.x);
  const ys = boundary.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let h = 0;
  const n = 24;
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++) {
      const p = { x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * j) / n };
      if (pointInPolygon(p, boundary)) h = Math.max(h, roofHeightAt(planes, p));
    }
  return roofBaseElevation(doc, roof) + h;
}

/** Bracing capacity (BU) of a wall's panels, for wind and earthquake. */
export function wallBracing(doc: Document, wall: Wall, systems = bracingSettings(doc).systems): { wind: number; eq: number } {
  let wind = 0;
  let eq = 0;
  for (const p of (wall.params as BracedWallParams).bracing ?? []) {
    const s = systems.find((x) => x.name === p.system);
    if (!s) continue;
    wind += (s.windPerM * p.length) / 1000;
    eq += (s.eqPerM * p.length) / 1000;
  }
  return { wind, eq };
}

/** Run the bracing check for every storey (base level with walls) and direction. */
export function bracingCheck(doc: Document): BracingReport {
  const set = bracingSettings(doc);
  const notes: string[] = [];
  const allWalls = doc.byCategory<WallParams>(Cat.Wall) as Wall[];
  const lv = levels(doc);
  const roofs = doc.byCategory(Cat.Roof) as Roof[];
  const box = wallsBox(allWalls);
  const top = Math.max(...roofs.map((r) => roofTop(doc, r)), ...allWalls.map((w) => wallExtent(doc, w).top), -Infinity);
  const roofArea = roofs.reduce((a, r) => a + polygonArea(r.params.boundary) / 1e6, 0);
  const q = (0.6 * set.windSpeeds[set.windZone] ** 2) / 1000; // kPa
  const cd = set.eqCoefficients[set.eqZone - 1] ?? 0;
  const storeys: StoreyBracing[] = [];
  const skewed = new Set<ElementId>();

  const storeyLevels = lv.filter((l) => allWalls.some((w) => w.params.baseLevelId === l.id));
  storeyLevels.forEach((level: Level) => {
    const walls = allWalls.filter((w) => w.params.baseLevelId === level.id);
    const base = level.params.elevation;
    const height = Math.max(...walls.map((w) => wallExtent(doc, w).top)) - base;
    const mid = base + height / 2;
    // Seismic weight above mid-storey: roof, floors on higher levels, exterior cladding above mid-height.
    const floorsAbove = doc
      .byCategory<FloorParams>(Cat.Floor)
      .filter((f) => (doc.get<{ elevation: number }>(f.params.levelId)?.params.elevation ?? -Infinity) > mid)
      .reduce((a, f) => a + polygonArea(f.params.boundary) / 1e6, 0);
    const claddingAbove = allWalls
      .filter((w) => wallFunction(w.typeId ? doc.get<LayeredTypeParams>(w.typeId) : undefined) === "exterior")
      .reduce((a, w) => {
        const e = wallExtent(doc, w);
        return a + (wallLength(w) * Math.max(0, e.top - Math.max(e.bottom, mid))) / 1e6;
      }, 0);
    const weight = roofArea * set.roofKPa + floorsAbove * set.floorKPa + claddingAbove * set.claddingKPa; // kN
    const exposed = Math.max(0, top - mid) / 1000; // m of elevation above mid-storey

    for (const direction of ["x", "y"] as Direction[]) {
      // Wind along X loads the elevation facing X: its width runs in Y.
      const width = box ? (direction === "x" ? box.maxY - box.minY : box.maxX - box.minX) / 1000 : 0;
      let demandWind = q * set.windCoefficient * width * exposed * 20;
      let demandEq = cd * weight * 20;
      const key = direction.toUpperCase() as "X" | "Y";
      const o = set.overrides?.[level.id];
      const overridden = o?.[`wind${key}`] !== undefined || o?.[`eq${key}`] !== undefined;
      demandWind = o?.[`wind${key}`] ?? demandWind;
      demandEq = o?.[`eq${key}`] ?? demandEq;

      // Walls running in this direction (within 15°), grouped into lines by perpendicular position.
      const runs = walls
        .map((w) => {
          const dx = w.params.end.x - w.params.start.x;
          const dy = w.params.end.y - w.params.start.y;
          const along = direction === "x" ? Math.abs(dx) : Math.abs(dy);
          const len = Math.hypot(dx, dy);
          if (!len) return null;
          const cos = along / len;
          if (cos < Math.cos((15 * Math.PI) / 180)) {
            if (cos > Math.cos((75 * Math.PI) / 180)) skewed.add(w.id);
            return null;
          }
          const pos = direction === "x" ? (w.params.start.y + w.params.end.y) / 2 : (w.params.start.x + w.params.end.x) / 2;
          return { w, pos, len: along, ...wallBracing(doc, w, set.systems) };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .sort((a, b) => a.pos - b.pos);
      const groups: (typeof runs)[] = [];
      for (const r of runs) {
        const g = groups.at(-1);
        if (g && r.pos - g[0]!.pos <= set.lineTolerance) g.push(r);
        else groups.push([r]);
      }
      const nLines = groups.length;
      const required = nLines ? Math.max(set.minLineBU, (set.lineShare * Math.max(demandWind, demandEq)) / nLines) : set.minLineBU;
      const lines: BracingLine[] = groups.map((g) => {
        const wind = g.reduce((a, r) => a + r.wind, 0);
        const eq = g.reduce((a, r) => a + r.eq, 0);
        const position = g.reduce((a, r) => a + r.pos * r.len, 0) / g.reduce((a, r) => a + r.len, 0);
        return { direction, position, length: g.reduce((a, r) => a + r.len, 0), walls: g.map((r) => r.w.id), wind, eq, required, pass: wind >= required - 1e-6 && eq >= required - 1e-6 };
      });
      let maxSpacing = 0;
      for (let i = 1; i < lines.length; i++) maxSpacing = Math.max(maxSpacing, lines[i]!.position - lines[i - 1]!.position);
      const capacityWind = lines.reduce((a, l) => a + l.wind, 0);
      const capacityEq = lines.reduce((a, l) => a + l.eq, 0);
      const spacingPass = maxSpacing <= set.maxLineSpacing + 1e-6;
      storeys.push({
        levelId: level.id,
        levelName: level.name ?? level.id,
        direction,
        demandWind,
        demandEq,
        overridden,
        capacityWind,
        capacityEq,
        lines,
        maxSpacing,
        spacingPass,
        pass: capacityWind >= demandWind - 1e-6 && capacityEq >= demandEq - 1e-6 && spacingPass && lines.length > 0 && lines.every((l) => l.pass),
      });
    }
  });
  if (skewed.size) notes.push(`${skewed.size} wall(s) are at an angle to the project axes and aren't counted.`);
  if (!roofs.length) notes.push("No roof: wind demand uses the wall tops only.");
  if (!storeys.length) notes.push("No walls in the model.");
  return { storeys, notes, pass: storeys.length > 0 && storeys.every((s) => s.pass) };
}
