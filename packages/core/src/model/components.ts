import { registerCategory } from "../categories.ts";
import { Document, type DocumentJSON, type Transaction } from "../document.ts";
import type { Element, ElementId, ParamValue, Vec2 } from "../element.ts";
import { evaluate, type Values } from "../expr.ts";
import { Cat, type LevelParams, type WallParams } from "./architecture.ts";
import { familyInfo, familyValues, type FamilyCategory, type FamilyHosting } from "./family.ts";
import { registerWallCutter, validateHosted, type HostedParams } from "./openings.ts";

// Loadable families in a project: a FamilyDef embeds the family document (as Revit stores loaded
// families in the .rvt); FamilyInstances place it by type, free-standing on a level or hosted in a wall.

export type FamilyDefParams = {
  category: FamilyCategory;
  hosting: FamilyHosting;
  /** The family document (a DocumentJSON), serialised. Reloading replaces it and regenerates every instance. */
  json: { [key: string]: ParamValue };
};
export type FamilyDef = Element<FamilyDefParams>;

export type FamilyInstanceParams = {
  familyId: ElementId;
  typeName: string;
  /** Instance parameter values (override the type's). */
  overrides: Values;
  /** Free-standing: level, plan position and rotation (radians, about Z). */
  levelId: ElementId;
  offset: number;
  position: Vec2;
  rotation: number;
  /** Wall-hosted: host, distance along it, sill height; the family's X runs along the wall. */
  hostId: ElementId | null;
  along: number;
  sillHeight: number;
  /** Hosted only: flip to the wall's other face. */
  flipped: boolean;
  /**
   * Nested in a family: formulas over the host family's parameters driving this instance's
   * parameters (Revit's "associate family parameter"), e.g. { Height: "Height - 30" }.
   */
  associations?: Record<string, string> | null;
};
export type FamilyInstance = Element<FamilyInstanceParams>;

registerCategory({ name: Cat.FamilyDef, dependencies: () => [], cascadeDelete: false, isType: true });
registerCategory({
  name: Cat.FamilyInstance,
  dependencies: (el) => {
    const p = el.params as FamilyInstanceParams;
    return [p.familyId, p.levelId, ...(p.hostId ? [p.hostId] : [])];
  },
  // A hosted instance changes its host's cut.
  related: (_doc, el) => {
    const p = el.params as FamilyInstanceParams;
    return p.hostId ? [p.hostId] : [];
  },
  // Deleting the family, level or host deletes the instance (Revit asks; we follow its result).
  cascadeDelete: true,
  isType: false,
});

const docCache = new WeakMap<object, Document>();

/** The family document inside a FamilyDef (parsed once per version). */
export function familyDocument(def: FamilyDef): Document {
  let d = docCache.get(def.params.json);
  if (!d) {
    d = Document.fromJSON(def.params.json as unknown as DocumentJSON);
    docCache.set(def.params.json, d);
  }
  return d;
}

export function familyTypeNames(def: FamilyDef): string[] {
  return familyInfo(familyDocument(def))?.params.types.map((t) => t.name) ?? [];
}

export function familyDefs(doc: Document): FamilyDef[] {
  return doc.byCategory<FamilyDefParams>(Cat.FamilyDef);
}

/** Load a family document into a project, or reload it if a family of that name is already loaded. */
export function loadFamily(tx: Transaction, project: Document, family: Document, name: string): FamilyDef {
  const info = familyInfo(family);
  if (!info) throw new Error("That document isn't a family");
  if (!name.trim()) throw new Error("Families need a name");
  const params: FamilyDefParams = {
    category: info.params.category,
    hosting: info.params.hosting,
    json: family.toJSON() as unknown as FamilyDefParams["json"],
  };
  const existing = familyDefs(project).find((f) => f.name === name);
  if (existing) {
    // Instances of types that no longer exist fall back to the first type.
    const types = info.params.types.map((t) => t.name);
    tx.update<FamilyDefParams>(existing.id, params);
    for (const inst of project.byCategory<FamilyInstanceParams>(Cat.FamilyInstance)) {
      if (inst.params.familyId === existing.id && !types.includes(inst.params.typeName)) {
        tx.update<FamilyInstanceParams>(inst.id, { typeName: types[0] ?? "Default" });
      }
    }
    return project.require<FamilyDefParams>(existing.id) as FamilyDef;
  }
  return tx.create<FamilyDefParams>(Cat.FamilyDef, params, { name });
}

/**
 * Parameter values of an instance: its type's, then its overrides, then (nested in a family) its
 * associations evaluated against the host's values — `hostValues`, or the host family's current type.
 */
export function instanceValues(doc: Document, inst: FamilyInstance, hostValues?: Values): Values {
  const def = doc.require<FamilyDefParams>(inst.params.familyId) as FamilyDef;
  const overrides = { ...inst.params.overrides };
  const assoc = inst.params.associations;
  if (assoc && Object.keys(assoc).length) {
    const host = hostValues ?? (familyInfo(doc) ? familyValues(doc) : {});
    for (const [name, formula] of Object.entries(assoc)) {
      try {
        overrides[name] = evaluate(formula, host);
      } catch (err) {
        throw new Error(`Nested ${def.name} ${name}: ${(err as Error).message}`);
      }
    }
  }
  return familyValues(familyDocument(def), inst.params.typeName, overrides);
}

/** Copy a loaded family from one document into another (e.g. a project family into a family, to nest it). */
export function copyFamilyDef(tx: Transaction, target: Document, def: FamilyDef): FamilyDef {
  return loadFamily(tx, target, familyDocument(def), def.name ?? "Family");
}

/** Cut a hosted family makes in its wall: Width × Height from its parameters. */
function familyPlacement(doc: Document, el: Element): HostedParams {
  const inst = el as FamilyInstance;
  const v = instanceValues(doc, inst);
  return {
    hostId: inst.params.hostId ?? "",
    position: inst.params.along,
    sillHeight: inst.params.sillHeight,
    width: v["Width"] ?? 0,
    height: v["Height"] ?? 0,
  };
}
registerWallCutter(Cat.FamilyInstance, (doc, el) => {
  const p = el.params as FamilyInstanceParams;
  // Free-standing instances don't cut anything.
  return p.hostId ? familyPlacement(doc, el) : { hostId: "", position: 0, sillHeight: 0, width: 0, height: 0 };
});

export function placeFamilyInstance(
  tx: Transaction,
  doc: Document,
  familyId: ElementId,
  typeName: string,
  opts: {
    levelId?: ElementId;
    position?: Vec2;
    rotation?: number;
    offset?: number;
    hostId?: ElementId;
    along?: number;
    sillHeight?: number;
    overrides?: Values;
  },
): FamilyInstance {
  const def = doc.require<FamilyDefParams>(familyId) as FamilyDef;
  if (def.category !== Cat.FamilyDef) throw new Error("Not a loaded family");
  if (!familyTypeNames(def).includes(typeName)) throw new Error(`${def.name} has no type "${typeName}"`);
  let levelId = opts.levelId;
  if (def.params.hosting === "wall") {
    if (!opts.hostId) throw new Error(`${def.name} must be placed in a wall`);
    const wall = doc.require<WallParams>(opts.hostId);
    if (wall.category !== Cat.Wall) throw new Error(`${def.name} must be placed in a wall`);
    levelId = wall.params.baseLevelId;
  }
  if (!levelId || doc.get<LevelParams>(levelId)?.category !== Cat.Level) throw new Error("Choose a level to place on");
  const params: FamilyInstanceParams = {
    familyId,
    typeName,
    overrides: opts.overrides ?? {},
    levelId,
    offset: opts.offset ?? 0,
    position: opts.position ?? { x: 0, y: 0 },
    rotation: opts.rotation ?? 0,
    hostId: def.params.hosting === "wall" ? opts.hostId! : null,
    along: opts.along ?? 0,
    // Hosted families may define a "Default Sill" (window families do).
    sillHeight: opts.sillHeight ?? familyValues(familyDocument(def), typeName)["Default Sill"] ?? 0,
    flipped: false,
  };
  if (params.hostId) validateHosted(doc, familyPlacement(doc, { id: "", category: Cat.FamilyInstance, params }));
  return tx.create<FamilyInstanceParams>(Cat.FamilyInstance, params);
}
