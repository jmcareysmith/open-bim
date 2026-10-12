import type { Element, ElementId } from "../element.ts";
import { Cat } from "./architecture.ts";
import type { FamilyDef, FamilyDefParams } from "./components.ts";
import { Document, type DocumentJSON } from "../document.ts";
import type { FamilyInfoParams, MarkerRole } from "./family.ts";
import { viewportsOn } from "./sheets.ts";
import type { View } from "./viewdefs.ts";

// View marker families (Revit: Elevation Mark, Section Head/Tail, Callout Head). A View Marker
// family is 2D line work, regions and text drawn at paper size about its origin, with the view's
// look direction along +Y. Its text can say {n} (the view's number), {name} and {sheet} (the sheet
// it's placed on). A view picks its families in Properties; with none it uses the built-in marks.

const roles = new WeakMap<object, MarkerRole | null>();

/** The marker a View Marker family draws, or null for other families. */
export function markerRole(def: Element): MarkerRole | null {
  if (def.category !== Cat.FamilyDef || (def.params as FamilyDefParams).category !== "ViewMarker") return null;
  const json = (def as FamilyDef).params.json as unknown as DocumentJSON;
  if (roles.has(json)) return roles.get(json)!;
  const info = Document.fromJSON(json).byCategory<FamilyInfoParams>(Cat.FamilyInfo)[0];
  const role = info?.params.markerRole ?? "elevation";
  roles.set(json, role);
  return role;
}

/** Loaded families that can draw `role`. */
export function markerFamilies(doc: Document, role: MarkerRole): FamilyDef[] {
  return doc.byCategory<FamilyDefParams>(Cat.FamilyDef).filter((d) => markerRole(d) === role) as FamilyDef[];
}

/** Which roles a view kind has, and the view param each one is stored in. */
export const MARKER_SLOTS: Record<string, { role: MarkerRole; key: "headFamilyId" | "tailFamilyId" | "markerFamilyId"; label: string }[]> = {
  section: [
    { role: "sectionHead", key: "headFamilyId", label: "Section head" },
    { role: "sectionTail", key: "tailFamilyId", label: "Section tail" },
  ],
  elevation: [{ role: "elevation", key: "markerFamilyId", label: "Elevation mark" }],
  callout: [{ role: "calloutHead", key: "markerFamilyId", label: "Callout head" }],
};

/** The family drawing a view's marker for a role, or undefined for the built-in one. */
export function viewMarkerFamily(doc: Document, view: View, role: MarkerRole): FamilyDef | undefined {
  const slot = MARKER_SLOTS[view.params.kind]?.find((s) => s.role === role);
  const id = slot ? (view.params[slot.key] as ElementId | null | undefined) : undefined;
  const def = id ? doc.get(id) : undefined;
  return def && markerRole(def) === role ? (def as FamilyDef) : undefined;
}

/** The view's number for {n}: its name's trailing digits, else its first few characters. */
export function viewNumber(name: string): string {
  const m = /(\d+)\s*$/.exec(name);
  return m ? m[1]! : name.slice(0, 3);
}

/** Fill a marker family's text: {n}, {name} and {sheet}. */
export function markerText(doc: Document, view: View, text: string): string {
  const sheet = doc.byCategory(Cat.Sheet).find((s) => viewportsOn(doc, s.id).some((vp) => (vp.params as { viewId: ElementId }).viewId === view.id));
  return text
    .replaceAll("{n}", viewNumber(view.name ?? ""))
    .replaceAll("{name}", view.name ?? "")
    .replaceAll("{sheet}", sheet ? String((sheet.params as { number?: string }).number ?? "") : "");
}

