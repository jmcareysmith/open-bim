import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { relatedWalls } from "./joins.ts";
import { validateRegion } from "./sketch.ts";

// ---- categories ----------------------------------------------------------

export const Cat = {
  Level: "Level",
  Wall: "Wall",
  WallType: "WallType",
  Floor: "Floor",
  FloorType: "FloorType",
  Grid: "Grid",
  ReferencePlane: "ReferencePlane",
  Ceiling: "Ceiling",
  CeilingType: "CeilingType",
  Roof: "Roof",
  RoofType: "RoofType",
  WallOpening: "WallOpening",
  Door: "Door",
  DoorType: "DoorType",
  Window: "Window",
  WindowType: "WindowType",
  ProjectSettings: "ProjectSettings",
  View: "View",
  DetailLine: "DetailLine",
  FilledRegion: "FilledRegion",
  TextNote: "TextNote",
  Dimension: "Dimension",
  Material: "Material",
  ViewFilter: "ViewFilter",
  ViewTemplate: "ViewTemplate",
  Sheet: "Sheet",
  Viewport: "Viewport",
  FamilyInfo: "FamilyInfo",
  FamilyParameter: "FamilyParameter",
  Extrusion: "Extrusion",
  Blend: "Blend",
  Revolution: "Revolution",
  Sweep: "Sweep",
  FamilyDef: "FamilyDef",
  FamilyInstance: "FamilyInstance",
  ProjectParameter: "ProjectParameter",
  GlobalParameter: "GlobalParameter",
  Room: "Room",
  RoomSeparator: "RoomSeparator",
  Area: "Area",
  AreaBoundary: "AreaBoundary",
  Tag: "Tag",
  LegendComponent: "LegendComponent",
  KeynoteLegend: "KeynoteLegend",
  Schedule: "Schedule",
  Revision: "Revision",
  RevisionCloud: "RevisionCloud",
  Symbol: "Symbol",
  DetailComponent: "DetailComponent",
  GroupType: "GroupType",
  Group: "Group",
  DirectShape: "DirectShape",
  CadImport: "CadImport",
  Link: "Link",
  Stair: "Stair",
  StairType: "StairType",
  Railing: "Railing",
  RailingType: "RailingType",
  Ramp: "Ramp",
  RampType: "RampType",
  Toposolid: "Toposolid",
  StructuralType: "StructuralType",
  Column: "Column",
  Beam: "Beam",
  PadFooting: "PadFooting",
  StripFooting: "StripFooting",
} as const;

// ---- Level ---------------------------------------------------------------

export type LevelParams = {
  /** Elevation above project base point, mm. */
  elevation: number;
};
export type Level = Element<LevelParams>;

// ---- Layered types (walls, floors) ---------------------------------------

export type LayerFunction = "structure" | "substrate" | "thermal" | "membrane" | "finish1" | "finish2";

export type Layer = {
  function: LayerFunction;
  /** Material name (kept for display and for files from before materials were elements). */
  material: string;
  /** Material element, when assigned. */
  materialId?: ElementId;
  /** mm */
  thickness: number;
};

/** Layered types depend on their layers' materials (so material edits regenerate instances). */
export const layerMaterialDeps = (el: Element): ElementId[] =>
  ((el.params as LayeredTypeParams).layers ?? []).flatMap((l) => (l.materialId ? [l.materialId] : []));

export type LayeredTypeParams = {
  /** Exterior → interior (walls) or top → bottom (floors). */
  layers: Layer[];
  /** Wall types only: a curtain wall (glazed panels on a mullion grid) instead of solid layers. */
  curtain?: CurtainGrid | null;
  /** Wall types only: a stacked wall — other wall types bottom to top (Revit: Stacked Wall). */
  stack?: StackSegment[] | null;
};

/** One wall type in a stack; `height` 0 marks the single variable-height segment. */
export type StackSegment = { typeId: ElementId; height: number };

/**
 * Curtain wall grid (Revit: Curtain Wall type). Grid lines divide the wall equally at no more than
 * the given spacings; mullions run on every grid line and around the edge, panels fill the cells.
 */
export type CurtainGrid = {
  /** Maximum spacing of vertical grid lines along the wall, mm. */
  uSpacing: number;
  /** Maximum spacing of horizontal grid lines, mm. */
  vSpacing: number;
  mullionWidth: number;
  mullionDepth: number;
  panelThickness: number;
  panelMaterialId?: ElementId | null;
  mullionMaterialId?: ElementId | null;
};

/**
 * A stacked wall type: member types bottom to top, exactly one with height 0 (it takes the rest).
 * The stack's own layers copy its thickest member's, so joins and footprints use that thickness.
 */
export function createStackedWallType(tx: Transaction, doc: Document, name: string, stack: StackSegment[]): Element<LayeredTypeParams> {
  if (stack.length < 2) throw new Error("A stacked wall needs at least two wall types");
  if (stack.filter((s) => s.height === 0).length !== 1) throw new Error("Exactly one segment must have variable height (0)");
  let thickest: Element<LayeredTypeParams> | undefined;
  for (const s of stack) {
    const t = doc.get<LayeredTypeParams>(s.typeId);
    if (!t || t.category !== Cat.WallType) throw new Error("Stacked walls are made of wall types");
    if (t.params.stack || t.params.curtain) throw new Error("Stacks can't contain stacked or curtain walls");
    if (s.height < 0) throw new Error("Segment heights can't be negative");
    if (!thickest || totalThickness(t) > totalThickness(thickest)) thickest = t;
  }
  return tx.create<LayeredTypeParams>(Cat.WallType, { layers: thickest!.params.layers.map((l) => ({ ...l })), stack: stack.map((s) => ({ ...s })) }, { name });
}

/** A stacked wall's segments with absolute heights (the variable one fills what's left). */
export function stackSegments(doc: Document, wall: Wall): { typeId: ElementId; bottom: number; top: number; thickness: number }[] {
  const t = wall.typeId ? doc.get<LayeredTypeParams>(wall.typeId) : undefined;
  const stack = t?.params.stack;
  if (!stack) return [];
  const { bottom, top } = wallExtent(doc, wall);
  const fixed = stack.reduce((s, x) => s + x.height, 0);
  const variable = Math.max(0, top - bottom - fixed);
  const out: { typeId: ElementId; bottom: number; top: number; thickness: number }[] = [];
  let z = bottom;
  for (const s of stack) {
    const h = s.height === 0 ? variable : s.height;
    const z1 = Math.min(top, z + h);
    const mt = doc.get<LayeredTypeParams>(s.typeId);
    if (z1 > z && mt) out.push({ typeId: s.typeId, bottom: z, top: z1, thickness: totalThickness(mt) });
    z = z1;
  }
  return out;
}

/** The curtain grid of a wall's type, if it is a curtain wall. */
export function curtainOf(doc: Document, wall: Element): CurtainGrid | undefined {
  const t = wall.typeId ? doc.get<LayeredTypeParams>(wall.typeId) : undefined;
  return t?.params.curtain ?? undefined;
}

export function totalThickness(t: Element<LayeredTypeParams>): number {
  return t.params.layers.reduce((sum, l) => sum + l.thickness, 0);
}

// ---- Wall ----------------------------------------------------------------

export type WallParams = {
  /** Location line (wall centreline) start, plan mm. */
  start: Vec2;
  end: Vec2;
  baseLevelId: ElementId;
  /** mm above base level. */
  baseOffset: number;
  /** If set, wall top follows this level (+ topOffset). Otherwise uses `height`. */
  topLevelId: ElementId | null;
  topOffset: number;
  /** Unconnected height, mm. Used when topLevelId is null. */
  height: number;
  /** Bounds rooms (default true). */
  roomBounding?: boolean;
  /** Attach Top: a roof, floor or ceiling the top follows (its underside). See model/wallattach.ts. */
  topAttachId?: ElementId | null;
  /** Attach Base: a floor the base sits on (its top). */
  baseAttachId?: ElementId | null;
};
export type Wall = Element<WallParams>;

export function wallThickness(doc: Document, wall: Wall): number {
  if (!wall.typeId) throw new Error("Wall has no type");
  return totalThickness(doc.require<LayeredTypeParams>(wall.typeId));
}

export function wallLength(wall: Wall): number {
  const { start, end } = wall.params;
  return Math.hypot(end.x - start.x, end.y - start.y);
}

type WallAttachHook = (doc: Document, wall: Wall, ext: { bottom: number; top: number }) => { bottom: number; top: number };
let attachHook: WallAttachHook | null = null;
/** Set by model/wallattach.ts so wall heights everywhere respect top/base attachments. */
export function setWallAttachHook(hook: WallAttachHook): void {
  attachHook = hook;
}

/** Absolute bottom and top Z of the wall, mm (after any top/base attachment; a sloped top's highest point). */
export function wallExtent(doc: Document, wall: Wall): { bottom: number; top: number } {
  const ext = wallExtentRaw(doc, wall);
  return attachHook && (wall.params.topAttachId || wall.params.baseAttachId) ? attachHook(doc, wall, ext) : ext;
}

/** Bottom and top from the wall's own levels, offsets and height, ignoring attachments. */
export function wallExtentRaw(doc: Document, wall: Wall): { bottom: number; top: number } {
  const p = wall.params;
  const base = doc.require<LevelParams>(p.baseLevelId).params.elevation;
  const bottom = base + p.baseOffset;
  const top = p.topLevelId
    ? doc.require<LevelParams>(p.topLevelId).params.elevation + p.topOffset
    : bottom + p.height;
  return { bottom, top };
}

// ---- Floor ---------------------------------------------------------------

export type FloorParams = {
  levelId: ElementId;
  /** Offset of top of floor from level, mm. */
  offset: number;
  /** Closed outer boundary, counter-clockwise, plan mm. */
  boundary: Vec2[];
  /** Optional holes (shafts, stair voids). */
  holes: Vec2[][];
};
export type Floor = Element<FloorParams>;

export function floorThickness(doc: Document, floor: Floor): number {
  if (!floor.typeId) throw new Error("Floor has no type");
  return totalThickness(doc.require<LayeredTypeParams>(floor.typeId));
}

/** Absolute Z of floor top and bottom, mm. */
export function floorExtent(doc: Document, floor: Floor): { bottom: number; top: number } {
  const level = doc.require<LevelParams>(floor.params.levelId).params.elevation;
  const top = level + floor.params.offset;
  return { top, bottom: top - floorThickness(doc, floor) };
}

// ---- Ceiling -------------------------------------------------------------

export type CeilingParams = {
  levelId: ElementId;
  /** Height of the ceiling underside above its level, mm (Revit "Height Offset From Level"). */
  offset: number;
  /** Closed outer boundary, counter-clockwise, plan mm. */
  boundary: Vec2[];
  holes: Vec2[][];
};
export type Ceiling = Element<CeilingParams>;

/** Absolute Z of ceiling underside and top, mm. Layers build upwards from the underside. */
export function ceilingExtent(doc: Document, ceiling: Ceiling): { bottom: number; top: number } {
  if (!ceiling.typeId) throw new Error("Ceiling has no type");
  const level = doc.require<LevelParams>(ceiling.params.levelId).params.elevation;
  const bottom = level + ceiling.params.offset;
  return { bottom, top: bottom + totalThickness(doc.require<LayeredTypeParams>(ceiling.typeId)) };
}

// ---- registration --------------------------------------------------------

const typeDeps = (el: Element): ElementId[] => (el.typeId ? [el.typeId] : []);

registerCategory({ name: Cat.Level, dependencies: () => [], cascadeDelete: false, isType: false });
registerCategory({
  name: Cat.WallType,
  // Stacked types depend on their member types (deleting one is blocked while it's stacked).
  dependencies: (el) => [...layerMaterialDeps(el), ...((el.params as LayeredTypeParams).stack ?? []).map((s) => s.typeId)],
  cascadeDelete: false,
  isType: true,
});
registerCategory({ name: Cat.FloorType, dependencies: layerMaterialDeps, cascadeDelete: false, isType: true });
registerCategory({ name: Cat.CeilingType, dependencies: layerMaterialDeps, cascadeDelete: false, isType: true });

registerCategory({
  name: Cat.Wall,
  dependencies: (el) => {
    const p = el.params as WallParams;
    return [p.baseLevelId, ...(p.topLevelId ? [p.topLevelId] : []), ...typeDeps(el)];
  },
  // Joined walls, and rooms (their boundaries follow walls; extra regeneration is cheap).
  related: (doc, el) => [...relatedWalls(doc, el as Wall), ...doc.byCategory(Cat.Room).map((r) => r.id)],
  cascadeDelete: true,
  isType: false,
});

registerCategory({
  name: Cat.Floor,
  dependencies: (el) => [(el.params as FloorParams).levelId, ...typeDeps(el)],
  related: (doc, el) => attachedWalls(doc, el.id),
  cascadeDelete: true,
  isType: false,
});

registerCategory({
  name: Cat.Ceiling,
  dependencies: (el) => [(el.params as CeilingParams).levelId, ...typeDeps(el)],
  related: (doc, el) => attachedWalls(doc, el.id),
  cascadeDelete: true,
  isType: false,
});

/** Walls attached (top or base) to an element: they regenerate when it changes. */
export function attachedWalls(doc: Document, id: ElementId): ElementId[] {
  return doc
    .byCategory<WallParams>(Cat.Wall)
    .filter((w) => w.params.topAttachId === id || w.params.baseAttachId === id)
    .map((w) => w.id);
}

// ---- creation helpers ----------------------------------------------------

export function createLevel(tx: Transaction, name: string, elevation: number): Level {
  return tx.create<LevelParams>(Cat.Level, { elevation }, { name });
}

export function createWall(
  tx: Transaction,
  typeId: ElementId,
  start: Vec2,
  end: Vec2,
  baseLevelId: ElementId,
  opts: Partial<Omit<WallParams, "start" | "end" | "baseLevelId">> = {},
): Wall {
  if (start.x === end.x && start.y === end.y) throw new Error("Wall must have non-zero length");
  return tx.create<WallParams>(
    Cat.Wall,
    {
      start,
      end,
      baseLevelId,
      baseOffset: opts.baseOffset ?? 0,
      topLevelId: opts.topLevelId ?? null,
      topOffset: opts.topOffset ?? 0,
      height: opts.height ?? 2400,
    },
    { typeId },
  );
}

export function createFloor(
  tx: Transaction,
  typeId: ElementId,
  levelId: ElementId,
  boundary: Vec2[],
  opts: { offset?: number; holes?: Vec2[][] } = {},
): Floor {
  if (boundary.length < 3) throw new Error("Floor boundary needs at least 3 points");
  const region = validateRegion({ boundary, holes: opts.holes ?? [] });
  return tx.create<FloorParams>(Cat.Floor, { levelId, offset: opts.offset ?? 0, ...region }, { typeId });
}

/** Ceiling from a sketched region. Default height 2400 mm above the level. */
export function createCeiling(
  tx: Transaction,
  typeId: ElementId,
  levelId: ElementId,
  boundary: Vec2[],
  opts: { offset?: number; holes?: Vec2[][] } = {},
): Ceiling {
  const region = validateRegion({ boundary, holes: opts.holes ?? [] });
  return tx.create<CeilingParams>(Cat.Ceiling, { levelId, offset: opts.offset ?? 2400, ...region }, { typeId });
}

/** Sorted by elevation, lowest first. */
export function levels(doc: Document): Level[] {
  return doc.byCategory<LevelParams>(Cat.Level).sort((a, b) => a.params.elevation - b.params.elevation);
}
