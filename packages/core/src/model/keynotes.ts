import type { Document, Transaction } from "../document.ts";
import type { ElementId } from "../element.ts";
import { Cat } from "./architecture.ts";
import { ensureProjectSettings, projectSettings, type ProjectSettingsParams } from "./settings.ts";
import { elementKeynote, type TagParams } from "./tags.ts";

// Keynotes (Revit: Keynoting Settings). The project holds a keynote table — key, text, parent —
// read from and written to Revit's tab-delimited keynote file format. Types, materials and
// elements carry a `keynote` key; keynote tags show it, and a keynote legend lists those used.

export interface KeynoteEntry {
  key: string;
  text: string;
  /** Key of the group this entry sits under, or null for top level. */
  parent: string | null;
}

/** Parse a Revit keynote file: `key<TAB>text[<TAB>parent]` per line; blank and # lines ignored. */
export function parseKeynoteFile(text: string): KeynoteEntry[] {
  const out: KeynoteEntry[] = [];
  const seen = new Set<string>();
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const [key = "", desc = "", parent = ""] = raw.split("\t").map((s) => s.trim());
    if (!key) continue;
    if (seen.has(key)) throw new Error(`Keynote "${key}" appears twice`);
    seen.add(key);
    out.push({ key, text: desc, parent: parent || null });
  }
  for (const e of out) if (e.parent && !seen.has(e.parent)) throw new Error(`Keynote "${e.key}" has unknown parent "${e.parent}"`);
  return out;
}

export function writeKeynoteFile(entries: KeynoteEntry[]): string {
  return entries.map((e) => [e.key, e.text, ...(e.parent ? [e.parent] : [])].join("\t")).join("\r\n") + "\r\n";
}

export function keynoteTable(doc: Document): KeynoteEntry[] {
  return projectSettings(doc)?.params.keynotes ?? [];
}

export function setKeynoteTable(tx: Transaction, doc: Document, entries: KeynoteEntry[]): void {
  const s = ensureProjectSettings(tx, doc);
  tx.update<ProjectSettingsParams>(s.id, { keynotes: entries.map((e) => ({ ...e })) });
}

export function keynoteText(doc: Document, key: string): string | undefined {
  return keynoteTable(doc).find((e) => e.key === key)?.text;
}

/** Keynotes tagged in a view, in key order, with their text (Revit's keynote legend "by sheet/view"). */
export function keynotesInView(doc: Document, viewId: ElementId): KeynoteEntry[] {
  const keys = new Set<string>();
  for (const t of doc.byCategory<TagParams>(Cat.Tag)) {
    if (t.params.viewId !== viewId || t.params.kind !== "keynote") continue;
    const host = doc.get(t.params.hostId);
    const k = host && elementKeynote(doc, host);
    if (k) keys.add(k);
  }
  return [...keys]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((key) => ({ key, text: keynoteText(doc, key) ?? "", parent: keynoteTable(doc).find((e) => e.key === key)?.parent ?? null }));
}
