import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, Vec2 } from "../element.ts";
import { Cat } from "./architecture.ts";
import { projectLocation } from "./settings.ts";
import { polygonArea } from "./sketch.ts";

// Property lines (Revit: Massing & Site → Property Line): the legal boundary, sketched or entered
// as bearings and distances off the survey plan. Bearings are whole-circle, clockwise from north
// (the project's survey north, so a rotated project still reads true to the title), shown in
// degrees, minutes and seconds as on NZ survey plans; distances in metres.

export type PropertyLineParams = { points: Vec2[] };
export type PropertyLine = Element<PropertyLineParams>;

registerCategory({ name: Cat.PropertyLine, dependencies: () => [], cascadeDelete: false, isType: false });

export function createPropertyLine(tx: Transaction, points: Vec2[], name = "Property line"): PropertyLine {
  if (points.length < 3) throw new Error("A property line needs at least three corners");
  return tx.create<PropertyLineParams>(Cat.PropertyLine, { points: points.map((p) => ({ ...p })) }, { name }) as PropertyLine;
}

/** One leg of a traverse: whole-circle bearing (degrees from north, clockwise) and length, mm. */
export type Leg = { bearing: number; distance: number };

/** Degrees the project's +Y (plan up) is turned clockwise from north. */
function northOffset(doc: Document): number {
  return (-projectLocation(doc).rotation * 180) / Math.PI;
}

const norm360 = (d: number) => ((d % 360) + 360) % 360;

/** The legs round a property line, from its first corner (the last leg closes it). */
export function propertyLegs(doc: Document, pl: PropertyLine): Leg[] {
  const pts = pl.params.points;
  const off = northOffset(doc);
  return pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return { bearing: norm360((Math.atan2(dx, dy) * 180) / Math.PI + off), distance: Math.hypot(dx, dy) };
  });
}

/** Corners from a start point and legs (Revit: Create by entering distances and bearings). */
export function pointsFromLegs(doc: Document, start: Vec2, legs: Leg[]): Vec2[] {
  const off = northOffset(doc);
  const out: Vec2[] = [{ ...start }];
  for (const l of legs.slice(0, -1)) {
    const a = (((l.bearing - off) * Math.PI) / 180);
    const p = out.at(-1)!;
    out.push({ x: p.x + Math.sin(a) * l.distance, y: p.y + Math.cos(a) * l.distance });
  }
  return out;
}

/** How far the legs miss closing (mm): the misclose a surveyor checks. */
export function misclose(doc: Document, start: Vec2, legs: Leg[]): number {
  const off = northOffset(doc);
  let x = start.x;
  let y = start.y;
  for (const l of legs) {
    const a = ((l.bearing - off) * Math.PI) / 180;
    x += Math.sin(a) * l.distance;
    y += Math.cos(a) * l.distance;
  }
  return Math.hypot(x - start.x, y - start.y);
}

export function propertyArea(pl: PropertyLine): number {
  return Math.abs(polygonArea(pl.params.points));
}

/** 45.5 → 45°30'00". */
export function formatBearing(deg: number): string {
  let total = Math.round(norm360(deg) * 3600);
  if (total >= 360 * 3600) total = 0;
  const d = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${d}°${String(m).padStart(2, "0")}'${String(s).padStart(2, "0")}"`;
}

/** Bearings as typed: 45°30'00", 45 30 00, 45-30-00 or 45.5. */
export function parseBearing(text: string): number | null {
  const parts = text
    .trim()
    .split(/[^0-9.]+/)
    .filter(Boolean)
    .map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  const [d, m = 0, s = 0] = parts;
  if (m >= 60 || s >= 60) return null;
  return norm360(d! + m / 60 + s / 3600);
}
