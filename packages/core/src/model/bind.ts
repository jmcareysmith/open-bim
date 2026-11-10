import { getCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import { newId, type Element, type ElementId, type Params, type Vec2 } from "../element.ts";
import { Cat, type LevelParams } from "./architecture.ts";
import { linkDocument, linkTransform, type Link } from "./links.ts";
import { applyAffine, transformParams, type Affine } from "./modify.ts";

// Bind Link (Revit: Bind Link): the linked model's elements become the project's own. Model
// elements, their types and materials and loaded families are copied in; types, materials and
// families of the same name already in the project are used instead of copies. Levels match the
// project's at the same (moved) elevation, else are added. Views, sheets, schedules and annotation
// stay behind, as in Revit. The link goes.

/** Categories that don't come across (views and what lives in them, project-wide settings). */
const LEFT_BEHIND = new Set<string>([
  Cat.View, Cat.Sheet, Cat.Viewport, Cat.Schedule, Cat.KeySchedule, Cat.ProjectSettings, Cat.Link, Cat.ObjectStyles,
  Cat.ViewFilter, Cat.ViewTemplate, Cat.Revision, Cat.RevisionCloud, Cat.ColorScheme, Cat.ColorFillLegend, Cat.Graph,
  Cat.Tag, Cat.Dimension, Cat.AngularDimension, Cat.RadialDimension, Cat.SpotElevation, Cat.ProjectParameter,
  Cat.GlobalParameter, Cat.ScopeBox, Cat.CadImport, Cat.ImageUnderlay, Cat.FamilyInfo, Cat.FamilyParameter,
]);

/** Shared by name with the project rather than copied. */
const BY_NAME = new Set<string>([Cat.Material, Cat.FamilyDef, Cat.GroupType]);

/** Replace every string equal to a mapped id, deep (not inside a family's embedded document). */
function remapDeep(v: unknown, map: Map<ElementId, ElementId>): unknown {
  if (typeof v === "string") return map.get(v) ?? v;
  if (Array.isArray(v)) return v.map((x) => remapDeep(x, map));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = k === "json" ? x : remapDeep(x, map);
    return out;
  }
  return v;
}

const isPt = (v: unknown): v is Vec2 =>
  !!v && typeof v === "object" && typeof (v as Vec2).x === "number" && typeof (v as Vec2).y === "number";

/** Plan points of categories the modify tools don't move (MEP runs, site, property lines, shafts). */
function genericMove(params: Params, t: Affine): Record<string, unknown> {
  const p = structuredClone(params) as Record<string, unknown>;
  const map = (q: Vec2) => ({ ...q, ...applyAffine(t, q) });
  for (const k of ["start", "end", "position", "at"]) if (isPt(p[k])) p[k] = map(p[k] as Vec2);
  for (const k of ["points", "boundary", "path"]) if (Array.isArray(p[k]) && (p[k] as unknown[]).every(isPt)) p[k] = (p[k] as Vec2[]).map(map);
  if (typeof p.rotation === "number") p.rotation = (p.rotation as number) + Math.atan2(t.yx, t.xx);
  return p;
}

/** Bind a link: copy its model into the project and delete the link. Returns the new element ids. */
export function bindLink(tx: Transaction, doc: Document, link: Link): ElementId[] {
  const src = linkDocument(link);
  const T = linkTransform(doc, link);
  const o = T([0, 0, 0]);
  const ex = T([1000, 0, 0]);
  const a = Math.atan2(ex[1] - o[1], ex[0] - o[0]);
  const t: Affine = { xx: Math.cos(a), xy: -Math.sin(a), yx: Math.sin(a), yy: Math.cos(a), tx: o[0], ty: o[1] };
  const dz = o[2];
  const map = new Map<ElementId, ElementId>();

  // Levels: the project's at the same elevation, else a new one.
  const hostLevels = doc.byCategory<LevelParams>(Cat.Level);
  for (const l of src.byCategory<LevelParams>(Cat.Level)) {
    const z = l.params.elevation + dz;
    const same = hostLevels.find((h) => Math.abs(h.params.elevation - z) < 1);
    if (same) map.set(l.id, same.id);
    else {
      const taken = new Set(doc.byCategory(Cat.Level).map((h) => h.name));
      let name = l.name ?? "Level";
      while (taken.has(name)) name += " (bound)";
      map.set(l.id, tx.create<LevelParams>(Cat.Level, { ...l.params, elevation: z }, { name }).id);
    }
  }

  // What comes across, and what the project already has by name.
  const copy: Element[] = [];
  for (const el of src.all()) {
    if (el.category === Cat.Level || LEFT_BEHIND.has(el.category)) continue;
    if (typeof (el.params as { viewId?: unknown }).viewId === "string") continue;
    const shareByName = BY_NAME.has(el.category) || getCategory(el.category).isType;
    const have = shareByName && el.name ? doc.byCategory(el.category).find((h) => h.name === el.name) : undefined;
    if (have) map.set(el.id, have.id);
    else {
      map.set(el.id, newId());
      copy.push(el);
    }
  }

  const all = new Set(copy.map((e) => e.id));
  const out: ElementId[] = [];
  for (const el of copy) {
    let p: Record<string, unknown>;
    if (getCategory(el.category).isType || BY_NAME.has(el.category)) p = structuredClone(el.params) as Record<string, unknown>;
    else {
      try {
        p = transformParams(src, el, t, all) ?? (structuredClone(el.params) as Record<string, unknown>);
      } catch {
        p = genericMove(el.params, t);
      }
    }
    const id = map.get(el.id)!;
    tx.create(el.category, remapDeep(p, map) as Params, {
      id,
      ...(el.name !== undefined ? { name: el.name } : {}),
      ...(el.typeId ? { typeId: map.get(el.typeId) ?? el.typeId } : {}),
    });
    out.push(id);
  }
  tx.delete(link.id);
  return out;
}
