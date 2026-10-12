import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId } from "../element.ts";
import { Cat, type Layer, type LayeredTypeParams } from "./architecture.ts";

// Materials (Revit "Materials" — graphics part): shading colour for 3D, a cut pattern for where
// elements are cut in plans/sections, and a surface pattern drawn on faces seen in a view.
// Thermal properties for H1 come later.

/** Built-in fill patterns. Drafting patterns are sized on paper; model patterns at real size. */
export const PATTERNS = [
  "none",
  "solid",
  "diagonal",
  "crosshatch",
  "concrete",
  "insulation",
  "timber",
  "weatherboard",
  "brick",
  "tile300",
] as const;
export type PatternName = (typeof PATTERNS)[number];

export type MaterialParams = {
  /** Shading colour, 0xRRGGBB. */
  color: number;
  cutPattern: PatternName;
  surfacePattern: PatternName;
};
export type Material = Element<MaterialParams>;

registerCategory({ name: Cat.Material, dependencies: () => [], cascadeDelete: false, isType: false });

export function materials(doc: Document): Material[] {
  return doc.byCategory<MaterialParams>(Cat.Material);
}

export function materialByName(doc: Document, name: string): Material | undefined {
  return materials(doc).find((m) => m.name === name);
}

export function createMaterial(tx: Transaction, doc: Document, name: string, params: Partial<MaterialParams> = {}): Material {
  if (!name.trim()) throw new Error("Materials need a name");
  if (materialByName(doc, name)) throw new Error(`A material called "${name}" already exists`);
  return tx.create<MaterialParams>(
    Cat.Material,
    { color: params.color ?? 0xb0b0b0, cutPattern: params.cutPattern ?? "diagonal", surfacePattern: params.surfacePattern ?? "none" },
    { name },
  );
}

/** A layer's material: by id when set, else by its (legacy) material name. */
export function layerMaterial(doc: Document, layer: Layer): Material | undefined {
  if (layer.materialId) {
    const m = doc.get<MaterialParams>(layer.materialId);
    if (m?.category === Cat.Material) return m;
  }
  return materialByName(doc, layer.material);
}

/**
 * The material that represents an element as a whole (3D colour, surface pattern): the first layer
 * of its type — the exterior finish for walls, the top for floors and roofs.
 */
export function elementMaterial(doc: Document, el: Element): Material | undefined {
  // Elements without types (toposolids) may name their material directly.
  const own = (el.params as { materialId?: unknown }).materialId;
  if (typeof own === "string") return doc.get<MaterialParams>(own) as Material | undefined;
  if (!el.typeId) return undefined;
  const t = doc.get<LayeredTypeParams>(el.typeId);
  // Section types (structure) name one material.
  const typeMat = (t?.params as { materialId?: unknown } | undefined)?.materialId;
  if (typeof typeMat === "string") return doc.get<MaterialParams>(typeMat) as Material | undefined;
  const first = t?.params.layers?.[0];
  return first ? layerMaterial(doc, first) : undefined;
}

/** Materials referenced by an element's type, so material edits regenerate the element. */
export function typeMaterialIds(doc: Document, typeId: ElementId | undefined): ElementId[] {
  if (!typeId) return [];
  const t = doc.get<LayeredTypeParams>(typeId);
  return (t?.params.layers ?? []).flatMap((l) => {
    const m = layerMaterial(doc, l);
    return m ? [m.id] : [];
  });
}
