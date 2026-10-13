import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element } from "../element.ts";
import { Cat } from "./architecture.ts";

// Schedules and material takeoffs (Revit: Schedule/Quantities, Material Takeoff). The schedule is a
// definition — category, fields, filters, sorting/grouping, totals; its rows are computed on demand
// from the model (geometry/src/schedules.ts), so they are always current.

export type ScheduleKind = "schedule" | "takeoff";
export type ScheduleFilterOp = "eq" | "ne" | "gt" | "lt" | "contains" | "notContains";

export type ScheduleFilter = { field: string; op: ScheduleFilterOp; value: string };
export type ScheduleSort = {
  field: string;
  descending: boolean;
  /** Grouping: a header row before each group and/or a subtotal row after it. */
  header: boolean;
  footer: boolean;
};

export type ScheduleParams = {
  kind: ScheduleKind;
  /** Element category, or a family category (Furniture, Casework, GenericModel). */
  category: string;
  /** Field keys in column order (see the field registry in geometry). */
  fields: string[];
  filters: ScheduleFilter[];
  sort: ScheduleSort[];
  /** Every element on its own row; when false, rows with equal sort keys collapse into one. */
  itemize: boolean;
  grandTotals: boolean;
  /** Calculated fields (Revit's Calculated Value): add `calc:<name>` to `fields` to show one. */
  calculated?: CalculatedField[] | null;
};
export type Schedule = Element<ScheduleParams>;

/**
 * A calculated field: a formula over the schedule's other fields by name (e.g. "Area * 45").
 * Lengths go in as metres, areas as m² and volumes as m³; the result is read the same way for
 * its type (a "length" result is metres), and a "number" result is shown as is.
 */
export type CalculatedField = { name: string; type: "number" | "length" | "area" | "volume"; formula: string };

registerCategory({ name: Cat.Schedule, dependencies: () => [], cascadeDelete: false, isType: false });

/** Categories that can be scheduled, with display names (NZ English). */
export const SCHEDULE_CATEGORIES: [string, string][] = [
  [Cat.Wall, "Walls"],
  [Cat.Door, "Doors"],
  [Cat.Window, "Windows"],
  [Cat.Room, "Rooms"],
  [Cat.Area, "Areas"],
  [Cat.Floor, "Floors"],
  [Cat.Ceiling, "Ceilings"],
  [Cat.Roof, "Roofs"],
  ["Furniture", "Furniture"],
  ["Casework", "Casework"],
  ["GenericModel", "Generic Models"],
];

/** Material takeoffs work on layered elements. */
export const TAKEOFF_CATEGORIES = new Set<string>([Cat.Wall, Cat.Floor, Cat.Ceiling, Cat.Roof]);

export function schedules(doc: Document): Schedule[] {
  return doc.byCategory<ScheduleParams>(Cat.Schedule) as Schedule[];
}

export function createSchedule(
  tx: Transaction,
  doc: Document,
  category: string,
  opts: { kind?: ScheduleKind; name?: string; fields?: string[] } = {},
): Schedule {
  const kind = opts.kind ?? "schedule";
  const label = SCHEDULE_CATEGORIES.find(([c]) => c === category)?.[1];
  if (!label) throw new Error(`${category} can't be scheduled`);
  if (kind === "takeoff" && !TAKEOFF_CATEGORIES.has(category)) throw new Error(`Material takeoffs need a layered category (walls, floors, ceilings, roofs)`);
  const base = kind === "takeoff" ? `${label.replace(/s$/, "")} Material Takeoff` : `${label.replace(/s$/, "")} Schedule`;
  let name = opts.name ?? base;
  for (let i = 2; !opts.name && schedules(doc).some((s) => s.name === name); i++) name = `${base} ${i}`;
  if (schedules(doc).some((s) => s.name === name)) throw new Error(`A schedule called "${name}" already exists`);
  return tx.create<ScheduleParams>(
    Cat.Schedule,
    {
      kind,
      category,
      fields: opts.fields ?? defaultFields(category, kind),
      filters: [],
      sort: [],
      itemize: true,
      grandTotals: false,
    },
    { name },
  ) as Schedule;
}

/** Revit-like starting fields per category. */
export function defaultFields(category: string, kind: ScheduleKind = "schedule"): string[] {
  if (kind === "takeoff") return ["type", "materialName", "materialArea", "materialVolume"];
  switch (category) {
    case Cat.Wall:
      return ["type", "level", "length", "area"];
    case Cat.Door:
    case Cat.Window:
      return ["mark", "type", "width", "height", "level"];
    case Cat.Room:
      return ["number", "name", "level", "area"];
    case Cat.Area:
      return ["name", "scheme", "level", "area"];
    case Cat.Floor:
    case Cat.Ceiling:
    case Cat.Roof:
      return ["type", "level", "area", "volume"];
    default:
      return ["familyAndType", "level", "count"];
  }
}

// ---- tables & export ------------------------------------------------------------------------

export type CellValue = string | number | null;
export type TableRowKind = "row" | "header" | "subtotal" | "total";

/** A computed schedule: display text plus numeric values in the displayed units (for spreadsheets). */
export interface ScheduleTable {
  title: string;
  headings: string[];
  rows: { kind: TableRowKind; cells: string[]; values: CellValue[]; ids: string[] }[];
}

/** CSV (RFC 4180) of the displayed text, with a title line like Revit's export. */
export function tableCsv(t: ScheduleTable): string {
  const esc = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [[t.title], t.headings, ...t.rows.map((r) => r.cells)];
  return lines.map((l) => l.map(esc).join(",")).join("\r\n") + "\r\n";
}

/** Minimal Office Open XML spreadsheet (one sheet, inline strings, numbers as numbers). */
export function tableXlsx(t: ScheduleTable): Uint8Array {
  const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const col = (i: number) => {
    let s = "";
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };
  const cell = (r: number, c: number, v: CellValue, text: string, bold: boolean) => {
    const ref = `${col(c)}${r}`;
    const style = bold ? ' s="1"' : "";
    if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
    return text ? `<c r="${ref}" t="inlineStr"${style}><is><t>${xml(text)}</t></is></c>` : "";
  };
  const rows: string[] = [];
  rows.push(`<row r="1">${cell(1, 0, null, t.title, true)}</row>`);
  rows.push(`<row r="2">${t.headings.map((h, c) => cell(2, c, null, h, true)).join("")}</row>`);
  t.rows.forEach((row, i) => {
    const r = i + 3;
    const bold = row.kind !== "row";
    rows.push(`<row r="${r}">${row.cells.map((text, c) => cell(r, c, row.values[c] ?? null, text, bold)).join("")}</row>`);
  });
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join("")}</sheetData></worksheet>`;
  const name = xml(t.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " ") || "Schedule");
  const files: [string, string][] = [
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    [
      "xl/styles.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`,
    ],
    ["xl/worksheets/sheet1.xml", sheet],
  ];
  return zipStore(files.map(([n, s]) => [n, new TextEncoder().encode(s)]));
}

// ---- zip (stored, no compression) -----------------------------------------------------------

let crcTable: Uint32Array | null = null;
function crc32(b: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(files: [string, Uint8Array][]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const le = (n: number, bytes: number) => {
    const a = new Uint8Array(bytes);
    for (let i = 0; i < bytes; i++) a[i] = (n >>> (8 * i)) & 0xff;
    return a;
  };
  const cat = (arrs: Uint8Array[]) => {
    const out = new Uint8Array(arrs.reduce((s, a) => s + a.length, 0));
    let o = 0;
    for (const a of arrs) {
      out.set(a, o);
      o += a.length;
    }
    return out;
  };
  for (const [name, data] of files) {
    const n = new TextEncoder().encode(name);
    const crc = crc32(data);
    // Version 2.0, no flags, stored, DOS time/date 1980-01-01.
    const common = [le(20, 2), le(0, 2), le(0, 2), le(0, 2), le(0x21, 2), le(crc, 4), le(data.length, 4), le(data.length, 4), le(n.length, 2), le(0, 2)];
    const local = cat([le(0x04034b50, 4), ...common, n, data]);
    central.push(cat([le(0x02014b50, 4), le(20, 2), ...common, le(0, 2), le(0, 2), le(0, 2), le(0, 4), le(offset, 4), n]));
    parts.push(local);
    offset += local.length;
  }
  const cd = cat(central);
  const end = cat([le(0x06054b50, 4), le(0, 2), le(0, 2), le(files.length, 2), le(files.length, 2), le(cd.length, 4), le(offset, 4), le(0, 2)]);
  return cat([...parts, cd, end]);
}
