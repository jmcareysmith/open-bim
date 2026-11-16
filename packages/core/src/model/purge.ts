import { getCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId } from "../element.ts";

// Purge Unused (Revit: Manage → Purge Unused): types without instances, and materials, loaded
// families, view templates and view filters that nothing refers to. The last type of each kind is
// kept (tools need one). Purging can free more (a type's material): run it again.

const OTHERS = new Set(["Material", "ViewTemplate", "ViewFilter"]);
/** Type-like categories no tool needs one of (all can go when unused). */
const NO_KEEP = new Set(["FamilyDef", "GroupType"]);

/** Every element id that appears anywhere in another element's params, type or host. */
function referencedIds(doc: Document): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string") out.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const el of doc.all()) {
    if (el.typeId) out.add(el.typeId);
    walk(el.params);
  }
  return out;
}

/** What Purge Unused would remove. */
export function unusedElements(doc: Document): Element[] {
  const used = referencedIds(doc);
  const out: Element[] = [];
  const byCat = new Map<string, Element[]>();
  for (const el of doc.all()) {
    const isType = getCategory(el.category).isType;
    if (!isType && !OTHERS.has(el.category)) continue;
    if (used.has(el.id) || doc.dependents(el.id).length) continue;
    // Layers and families name their materials (and families can be loaded by name).
    if ((el.category === "Material" || el.category === "FamilyDef") && el.name && used.has(el.name)) continue;
    if (isType && !NO_KEEP.has(el.category)) byCat.set(el.category, [...(byCat.get(el.category) ?? []), el]);
    else out.push(el);
  }
  // Types: keep at least one of each kind.
  for (const [cat, list] of byCat) {
    const total = doc.byCategory(cat).length;
    out.push(...(list.length >= total ? list.slice(1) : list));
  }
  return out;
}

/** Delete the given unused elements (checked again); returns how many went. */
export function purgeUnused(tx: Transaction, doc: Document, ids?: ElementId[]): number {
  const unused = new Set(unusedElements(doc).map((e) => e.id));
  let n = 0;
  for (const id of ids ?? [...unused]) {
    if (!unused.has(id) || !doc.has(id)) continue;
    tx.delete(id);
    n++;
  }
  return n;
}
