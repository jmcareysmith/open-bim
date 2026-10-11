import type { Document, Transaction } from "../document.ts";
import { familyInfo, familyParameters, type FamilyInfoParams, type ParameterKind } from "./family.ts";

// Revit type catalogs: a CSV beside a family listing its types. Header cells are
// "Name##kind##units" (e.g. "Width##length##millimeters"); the first column is the type name.

const KIND_OUT: Record<ParameterKind, [string, string]> = {
  length: ["length", "millimeters"],
  angle: ["angle", "degrees"],
  number: ["other", ""],
  boolean: ["other", ""],
};

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/** The family's types as a Revit-style type catalog (formula parameters are left out). */
export function typeCatalogCsv(doc: Document): string {
  const info = familyInfo(doc);
  if (!info) throw new Error("Not a family document");
  const params = familyParameters(doc).filter((p) => !p.params.formula && !p.params.instance);
  const header = ["", ...params.map((p) => {
    const [kind, units] = KIND_OUT[p.params.kind];
    return `${p.name}##${kind}##${units}`;
  })];
  const lines = [header.map(csvCell).join(",")];
  for (const t of info.params.types) lines.push([t.name, ...params.map((p) => String(t.values[p.name ?? ""] ?? 0))].map(csvCell).join(","));
  return lines.join("\n") + "\n";
}

/**
 * Add or update family types from a type catalog. Columns must name existing parameters; units are
 * read from the header (millimeters, meters, centimeters; degrees). Returns the type names loaded.
 */
export function importTypeCatalog(tx: Transaction, doc: Document, csv: string): string[] {
  const info = familyInfo(doc);
  if (!info) throw new Error("Not a family document");
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new Error("The catalog needs a header row and at least one type");
  const known = new Set(familyParameters(doc).map((p) => p.name));
  const cols = rows[0]!.slice(1).map((h, i) => {
    const [name, , units = ""] = h.split("##").map((s) => s.trim());
    if (!name || !known.has(name)) throw new Error(`Catalog column ${i + 2} ("${h}") isn't a parameter of this family`);
    const u = units.toLowerCase();
    const factor = u.startsWith("meter") ? 1000 : u.startsWith("centimeter") ? 10 : 1;
    return { name, factor };
  });
  const types = info.params.types.map((t) => ({ ...t, values: { ...t.values } }));
  const loaded: string[] = [];
  for (const r of rows.slice(1)) {
    const name = r[0]!.trim();
    if (!name) continue;
    const values: Record<string, number> = {};
    cols.forEach((c, i) => {
      const raw = (r[i + 1] ?? "").trim();
      if (raw === "") return;
      const v = Number(raw);
      if (!Number.isFinite(v)) throw new Error(`Type "${name}": "${raw}" isn't a number`);
      values[c.name] = v * c.factor;
    });
    const existing = types.find((t) => t.name === name);
    if (existing) Object.assign(existing.values, values);
    else {
      const base = types.find((t) => t.name === info.params.currentType) ?? types[0];
      types.push({ name, values: { ...(base?.values ?? {}), ...values } });
    }
    loaded.push(name);
  }
  tx.update<FamilyInfoParams>(info.id, { types });
  return loaded;
}
