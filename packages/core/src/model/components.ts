import { registerCategory } from "../categories.ts";
import { Document, type DocumentJSON, type Transaction } from "../document.ts";
import type { Element, ElementId, ParamValue, Vec2 } from "../element.ts";
import { evaluate, type Values } from "../expr.ts";
import { Cat, type LevelParams, type WallParams } from "./architecture.ts";
import { tangentLine } from "./arcs.ts";
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
  /**
   * A shared nested family's instance in the project, kept by `enableSharedNested`: the host
   * instance and the nested instance's id in the host's family. Drawn as part of the host.
   */
  nestedOf?: ElementId | null;
  nestedKey?: string | null;
};
export type FamilyInstance = Element<FamilyInstanceParams>;

registerCategory({
  name: Cat.FamilyDef,
  dependencies: () => [],
  // Views drawing their markers with this family redraw when it's reloaded or deleted.
  related: (doc, el) =>
    doc
      .byCategory(Cat.View)
      .filter((v) => {
        const p = v.params as { headFamilyId?: unknown; tailFamilyId?: unknown; markerFamilyId?: unknown };
        return p.headFamilyId === el.id || p.tailFamilyId === el.id || p.markerFamilyId === el.id;
      })
      .map((v) => v.id),
  cascadeDelete: false,
  isType: true,
});
registerCategory({
  name: Cat.FamilyInstance,
  dependencies: (el) => {
    const p = el.params as FamilyInstanceParams;
    return [p.familyId, p.levelId, ...(p.hostId ? [p.hostId] : []), ...(p.nestedOf ? [p.nestedOf] : [])];
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
  if (def.params.category === "DetailItem") throw new Error(`${def.name} is a detail item: place it with Annotate → Detail → Component`);
  if (def.params.category === "ViewMarker") throw new Error(`${def.name} is a view marker: pick it in a section's, elevation's or callout's Properties`);
  if (def.params.category === "TitleBlock") throw new Error(`${def.name} is a title block: pick it in a sheet's Properties`);
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

/** Where an instance's family origin sits: model point (z absolute) and the family's +X in plan. */
export function instanceOrigin(doc: Document, inst: FamilyInstance): { origin: [number, number, number]; x: Vec2 } {
  const p = inst.params;
  if (p.hostId) {
    const wall = doc.require<WallParams>(p.hostId);
    const { start, dir: d } = tangentLine(wall, p.along);
    const base = doc.require<LevelParams>(wall.params.baseLevelId).params.elevation + wall.params.baseOffset;
    const x = p.flipped ? { x: -d.x, y: -d.y } : d;
    return { origin: [start.x + d.x * p.along, start.y + d.y * p.along, base + p.sillHeight], x };
  }
  const z = doc.require<LevelParams>(p.levelId).params.elevation + p.offset;
  return { origin: [p.position.x, p.position.y, z], x: { x: Math.cos(p.rotation), y: Math.sin(p.rotation) } };
}

/** Is this loaded family shared (its nested instances show in projects)? */
export function isSharedFamily(def: FamilyDef): boolean {
  return familyInfo(familyDocument(def))?.params.shared === true;
}

/** The project's element standing for a shared nested instance (none for ordinary ones). */
export function isNestedChild(el: Element): boolean {
  return el.category === Cat.FamilyInstance && !!(el.params as FamilyInstanceParams).nestedOf;
}

/**
 * Keep the project's elements for shared nested families (Revit: Shared): for each placed instance
 * whose family nests shared families, one free-standing instance per nested one, at the nested
 * instance's place under the host, with its values (associations evaluated for the host). The
 * nested family is loaded into the project by its name. Children are drawn by the host's mesh.
 */
export function syncSharedNested(tx: Transaction, doc: Document): void {
  // Projects only (a family document shows its nested families as they are).
  if (familyInfo(doc)) return;
  const insts = doc.byCategory<FamilyInstanceParams>(Cat.FamilyInstance) as FamilyInstance[];
  const children = new Map<string, FamilyInstance>();
  for (const c of insts) if (c.params.nestedOf) children.set(`${c.params.nestedOf}|${c.params.nestedKey}`, c);
  const keep = new Set<string>();
  const loaded = new Map<object, FamilyDef>();
  for (const host of insts) {
    if (host.params.nestedOf) continue;
    const def = doc.get<FamilyDefParams>(host.params.familyId) as FamilyDef | undefined;
    if (def?.category !== Cat.FamilyDef) continue;
    const fdoc = familyDocument(def);
    const nested = fdoc.byCategory<FamilyInstanceParams>(Cat.FamilyInstance) as FamilyInstance[];
    if (!nested.length) continue;
    let hostValues: Values | null = null;
    let at: ReturnType<typeof instanceOrigin> | null = null;
    for (const n of nested) {
      const ndef = fdoc.get<FamilyDefParams>(n.params.familyId) as FamilyDef | undefined;
      if (ndef?.category !== Cat.FamilyDef || !isSharedFamily(ndef)) continue;
      try {
        hostValues ??= instanceValues(doc, host);
        at ??= instanceOrigin(doc, host);
      } catch {
        break;
      }
      // The nested family in the project (loaded or reloaded when its definition differs).
      let pdef = loaded.get(ndef.params.json);
      if (!pdef) {
        pdef = familyDefs(doc).find((f) => f.name === ndef.name);
        if (!pdef || (pdef.params.json !== ndef.params.json && JSON.stringify(pdef.params.json) !== JSON.stringify(ndef.params.json)))
          pdef = loadFamily(tx, doc, familyDocument(ndef), ndef.name ?? "Family");
        loaded.set(ndef.params.json, pdef);
      }
      const overrides: Values = { ...n.params.overrides };
      for (const [name, formula] of Object.entries(n.params.associations ?? {})) {
        try {
          overrides[name] = evaluate(formula, hostValues);
        } catch {
          // A broken association leaves the nested value as typed.
        }
      }
      // Place: the host's origin and axes applied to the nested instance's family coordinates.
      const lz = fdoc.get<LevelParams>(n.params.levelId)?.params.elevation ?? 0;
      const { origin, x } = at;
      const px = n.params.position.x;
      const py = n.params.position.y;
      const position = { x: origin[0] + x.x * px - x.y * py, y: origin[1] + x.y * px + x.x * py };
      const rotation = Math.atan2(x.y, x.x) + n.params.rotation;
      const levelId = host.params.hostId ? doc.require<WallParams>(host.params.hostId).params.baseLevelId : host.params.levelId;
      const offset = origin[2] + lz + n.params.offset - doc.require<LevelParams>(levelId).params.elevation;
      const params: FamilyInstanceParams = {
        familyId: pdef.id,
        typeName: n.params.typeName,
        overrides,
        levelId,
        offset,
        position,
        rotation,
        hostId: null,
        along: 0,
        sillHeight: 0,
        flipped: false,
        nestedOf: host.id,
        nestedKey: n.id,
      };
      const key = `${host.id}|${n.id}`;
      keep.add(key);
      const have = children.get(key);
      if (!have) tx.create<FamilyInstanceParams>(Cat.FamilyInstance, params);
      else {
        const changed = (Object.keys(params) as (keyof FamilyInstanceParams)[]).some((k) => JSON.stringify(params[k]) !== JSON.stringify(have.params[k] ?? null));
        if (changed) tx.update<FamilyInstanceParams>(have.id, params);
      }
    }
  }
  for (const [key, c] of children) if (!keep.has(key) && doc.get(c.id)) tx.delete(c.id);
}

/** Keep shared nested families' project elements up to date on every commit. */
export function enableSharedNested(doc: Document): () => void {
  return doc.addCommitHook((tx) => syncSharedNested(tx, doc));
}
