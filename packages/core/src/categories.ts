import type { Element, ElementId } from "./element.ts";

/**
 * Behaviour attached to an element category.
 * Kept small on purpose: categories add hooks here as features need them.
 */
export interface CategoryDef {
  readonly name: string;
  /** Elements this element depends on. If any of them change, this element regenerates. */
  dependencies(el: Element): ElementId[];
  /**
   * If true, deleting a dependency deletes this element too
   * (Revit: deleting a level deletes walls on it).
   */
  readonly cascadeDelete: boolean;
  /** True for type elements (WallType, FloorType…). */
  readonly isType: boolean;
}

const registry = new Map<string, CategoryDef>();

export function registerCategory(def: CategoryDef): void {
  registry.set(def.name, def);
}

export function getCategory(name: string): CategoryDef {
  const def = registry.get(name);
  if (!def) throw new Error(`Unknown category: ${name}`);
  return def;
}

export function hasCategory(name: string): boolean {
  return registry.has(name);
}

export function categoryNames(): string[] {
  return [...registry.keys()];
}
