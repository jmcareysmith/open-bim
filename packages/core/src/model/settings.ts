import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element } from "../element.ts";
import { Cat } from "./architecture.ts";

// Project units and information (Revit "Project Units" and "Project Information").
// Values are always stored in mm / mm² / radians; units only change display and input.

export type LengthUnit = "mm" | "cm" | "m";
export type AreaUnit = "m2" | "mm2";
export type AngleUnit = "deg" | "rad";

export type UnitsSettings = {
  length: { unit: LengthUnit; decimals: number };
  area: { unit: AreaUnit; decimals: number };
  angle: { unit: AngleUnit; decimals: number };
};

export type ProjectInfo = {
  name: string;
  number: string;
  client: string;
  address: string;
};

export type ProjectSettingsParams = {
  units: UnitsSettings;
  info: ProjectInfo;
};
export type ProjectSettings = Element<ProjectSettingsParams>;

/** NZ practice: drawings dimensioned in millimetres, areas in square metres. */
export const DEFAULT_UNITS: UnitsSettings = {
  length: { unit: "mm", decimals: 0 },
  area: { unit: "m2", decimals: 2 },
  angle: { unit: "deg", decimals: 1 },
};

export const DEFAULT_PROJECT_INFO: ProjectInfo = { name: "", number: "", client: "", address: "" };

registerCategory({ name: Cat.ProjectSettings, dependencies: () => [], cascadeDelete: false, isType: false });

/** The project's settings element, if the document has one (older files may not). */
export function projectSettings(doc: Document): ProjectSettings | undefined {
  return doc.byCategory<ProjectSettingsParams>(Cat.ProjectSettings)[0];
}

/** Units in force, falling back to defaults for documents without settings. */
export function projectUnits(doc: Document): UnitsSettings {
  return projectSettings(doc)?.params.units ?? DEFAULT_UNITS;
}

/** Create the settings element (one per document). */
export function createProjectSettings(tx: Transaction, doc: Document, params: Partial<ProjectSettingsParams> = {}): ProjectSettings {
  if (projectSettings(doc)) throw new Error("Project settings already exist");
  return tx.create<ProjectSettingsParams>(
    Cat.ProjectSettings,
    { units: params.units ?? DEFAULT_UNITS, info: params.info ?? DEFAULT_PROJECT_INFO },
    { name: "Project Settings" },
  );
}

/** Get the settings element, creating it inside `tx` if the document lacks one. */
export function ensureProjectSettings(tx: Transaction, doc: Document): ProjectSettings {
  return projectSettings(doc) ?? createProjectSettings(tx, doc);
}

// ---- formatting & parsing ----------------------------------------------------

const LENGTH_FACTOR: Record<LengthUnit, number> = { mm: 1, cm: 10, m: 1000 };
const LENGTH_SUFFIX = /^(-?[\d\s.,]*\d|-?\.\d+)\s*(mm|cm|m)?$/i;

/** Format with fixed decimals, grouping thousands with a thin space for readability (e.g. "12 500"). */
function fixed(v: number, decimals: number): string {
  const s = (Math.abs(v) < 0.5 * 10 ** -decimals ? 0 : v).toFixed(decimals);
  const [int, frac] = s.split(".");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return frac ? `${grouped}.${frac}` : grouped;
}

export function formatLength(mm: number, units: UnitsSettings = DEFAULT_UNITS): string {
  const { unit, decimals } = units.length;
  return `${fixed(mm / LENGTH_FACTOR[unit], decimals)} ${unit}`;
}

/** Decimals needed to show whole millimetres in each unit. */
export const MM_EXACT_DECIMALS: Record<LengthUnit, number> = { mm: 0, cm: 1, m: 3 };

/**
 * The number to put in an input box, without unit or digit grouping. Never coarser than 1 mm,
 * so editing a value can't silently round it to the display precision.
 */
export function lengthInputValue(mm: number, units: UnitsSettings = DEFAULT_UNITS): string {
  const { unit, decimals } = units.length;
  return String(Number((mm / LENGTH_FACTOR[unit]).toFixed(Math.max(decimals, MM_EXACT_DECIMALS[unit]))));
}

/**
 * Parse a typed length to mm. A bare number is in the project's length unit; a suffix overrides it
 * ("2.4m", "240 cm", "2400mm"). Spaces and commas group digits ("12 500", "12,500").
 * Returns null if the text isn't a length.
 */
export function parseLength(text: string, units: UnitsSettings = DEFAULT_UNITS): number | null {
  const m = LENGTH_SUFFIX.exec(text.trim());
  if (!m) return null;
  const v = Number(m[1]!.replace(/[\s,]/g, ""));
  if (!Number.isFinite(v)) return null;
  const unit = (m[2]?.toLowerCase() as LengthUnit | undefined) ?? units.length.unit;
  return v * LENGTH_FACTOR[unit];
}

export function formatArea(mm2: number, units: UnitsSettings = DEFAULT_UNITS): string {
  const { unit, decimals } = units.area;
  return unit === "m2" ? `${fixed(mm2 / 1e6, decimals)} m²` : `${fixed(mm2, decimals)} mm²`;
}

export function formatAngle(rad: number, units: UnitsSettings = DEFAULT_UNITS): string {
  const { unit, decimals } = units.angle;
  return unit === "deg" ? `${fixed((rad * 180) / Math.PI, decimals)}°` : `${fixed(rad, decimals)} rad`;
}

/** Angle value for an input box in the project's angle unit. */
export function angleInputValue(rad: number, units: UnitsSettings = DEFAULT_UNITS): string {
  const v = units.angle.unit === "deg" ? (rad * 180) / Math.PI : rad;
  return String(Number(v.toFixed(units.angle.decimals)));
}

/** Parse a typed angle to radians: bare numbers use the project unit; "°"/"deg" or "rad" override. */
export function parseAngle(text: string, units: UnitsSettings = DEFAULT_UNITS): number | null {
  const m = /^(-?\d*\.?\d+)\s*(°|deg|rad)?$/i.exec(text.trim());
  if (!m) return null;
  const v = Number(m[1]);
  const unit = m[2] ? (m[2].toLowerCase() === "rad" ? "rad" : "deg") : units.angle.unit;
  return unit === "deg" ? (v * Math.PI) / 180 : v;
}
