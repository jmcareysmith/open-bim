import { getCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Params } from "../element.ts";

// Transfer Project Standards (Revit: Manage → Transfer Project Standards): copy types, materials,
// view filters and templates from another project by name. Duplicates are skipped or overwritten.
// References inside what comes across (a template's filters, a type's material) point at the copies.

/** The standards a project can pass on, as categories, in the order they must come across. */
export function standardCategories(src: Document): string[] {
  const order = (c: string) => (c === "Material" ? 0 : c === "ViewFilter" ? 1 : c === "ViewTemplate" ? 3 : 2);
  const cats = new Set<string>();
  for (const el of src.all()) if (getCategory(el.category).isType || ["Material", "ViewFilter", "ViewTemplate"].includes(el.category)) cats.add(el.category);
  return [...cats].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
}

/** Copy the chosen categories' elements from `src`. Returns how many were added and overwritten. */
export function transferStandards(tx: Transaction, doc: Document, src: Document, categories: string[], mode: "skip" | "overwrite"): { added: number; overwritten: number; skipped: number } {
  const order = standardCategories(src).filter((c) => categories.includes(c));
  const map = new Map<ElementId, ElementId>();
  const remap = (v: unknown): unknown => {
    if (typeof v === "string") return map.get(v) ?? v;
    if (Array.isArray(v)) return v.map(remap);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remap(x)]));
    return v;
  };
  let added = 0;
  let overwritten = 0;
  let skipped = 0;
  // Everything with the same category and name is the same thing here (materials a type names, …).
  for (const cat of standardCategories(src)) {
    const mine = new Map(doc.byCategory(cat).filter((e) => e.name).map((e) => [e.name!, e.id] as [string, ElementId]));
    for (const el of src.byCategory(cat)) if (el.name && mine.has(el.name)) map.set(el.id, mine.get(el.name)!);
  }
  // What a copied element needs that isn't here yet (a material, a filter) comes along.
  const bring = (id: ElementId): boolean => {
    if (map.has(id) || doc.has(id)) return true;
    const dep = src.get(id);
    if (!dep || !["Material", "ViewFilter"].includes(dep.category)) return false;
    const made = tx.create(dep.category, remap(structuredClone(dep.params)) as Params, dep.name ? { name: dep.name } : {});
    map.set(id, made.id);
    added++;
    return true;
  };
  for (const cat of order) {
    const mine = new Map(doc.byCategory(cat).filter((e) => e.name).map((e) => [e.name!, e] as [string, Element]));
    for (const el of src.byCategory(cat)) {
      const same = el.name ? mine.get(el.name) : undefined;
      if (same) {
        map.set(el.id, same.id);
        if (mode === "skip") {
          skipped++;
          continue;
        }
        // Theirs replaces ours whole (keys only ours had go), with what it needs brought along.
        if (getCategory(el.category).dependencies(el).some((d) => !bring(d))) {
          skipped++;
          continue;
        }
        const next = remap(structuredClone(el.params)) as Record<string, unknown>;
        for (const k of Object.keys(same.params as object)) if (!(k in next)) next[k] = undefined;
        tx.update(same.id, next as Params);
        overwritten++;
        continue;
      }
      // Types that depend on something we don't have (a family not in this project) stay behind.
      const deps = getCategory(el.category).dependencies(el).filter((d) => !bring(d));
      if (deps.length) {
        skipped++;
        continue;
      }
      const made = tx.create(el.category, remap(structuredClone(el.params)) as Params, { ...(el.name ? { name: el.name } : {}), ...(el.typeId && map.get(el.typeId) ? { typeId: map.get(el.typeId)! } : {}) });
      map.set(el.id, made.id);
      added++;
    }
  }
  return { added, overwritten, skipped };
}
