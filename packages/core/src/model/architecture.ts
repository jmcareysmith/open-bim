import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { relatedWalls } from "./joins.ts";
import { validateRegion } from "./sketch.ts";
import type { PatternName } from "./materials.ts";
import type { WallSweep } from "./sweeps.ts";

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
  SpotElevation: "SpotElevation",
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
  Connector: "Connector",
  MEPSystem: "MEPSystem",
  DuctType: "DuctType",
  Duct: "Duct",
  DuctFitting: "DuctFitting",
  PipeType: "PipeType",
  Pipe: "Pipe",
  PipeFitting: "PipeFitting",
  MassFloor: "MassFloor",
  BuildingPad: "BuildingPad",
  SiteSubregion: "SiteSubregion",
  PropertyLine: "PropertyLine",
  CableTrayType: "CableTrayType",
  CableTray: "CableTray",
  CableTrayFitting: "CableTrayFitting",
  ConduitType: "ConduitType",
  Conduit: "Conduit",
  ConduitFitting: "ConduitFitting",
  ObjectStyles: "ObjectStyles",
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
  /**
   * Coarse Scale Fill Pattern (Revit): how cuts of this type fill at Coarse detail. Unset, they
   * draw hollow (outline only), as Revit's types do by default.
   */
  coarseFill?: CoarseFill | null;
  /** Wall types only: sweeps and reveals on every wall of the type (Edit Assembly). */
  sweeps?: WallSweep[] | null;
};

/** A type's fill for its cuts at Coarse: a pattern (or solid) and an optional colour. */
export type CoarseFill = { pattern: PatternName; color?: number | null };

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
  /** Mullion type: rectangular (width × depth) or circular (width = diameter). Default rectangular. */
  mullionShape?: "rectangular" | "circular" | null;
  /** Mullions round the edge of the wall (default true). */
  borderMullions?: boolean | null;
  /** Mullion profiles (MULLION_PROFILES) for interior grid lines and the border; unset = width × depth (or round). */
  interiorMullion?: string | null;
  borderMullion?: string | null;
};

/**
 * Mullion profiles (Revit: Curtain Wall Mullion types): cross-sections in mm, x across the mullion
 * (along the wall for vertical mullions, up it for horizontal ones), y through the wall (+ exterior),
 * centred on the grid line.
 */
export const MULLION_PROFILES: Record<string, Vec2[]> = {
  "Rectangular 50 x 150": rectProfile(50, 150),
  "Rectangular 50 x 100": rectProfile(50, 100),
  "Rectangular 30 x 150": rectProfile(30, 150),
  "Rectangular 100 x 100": rectProfile(100, 100),
  "Circular 50": circleProfile(25),
  "Circular 100": circleProfile(50),
  "Trapezoid 80 x 150": [
    { x: -40, y: -75 },
    { x: 40, y: -75 },
    { x: 20, y: 75 },
    { x: -20, y: 75 },
  ],
  "Capped 60 x 150": [
    { x: -15, y: -75 },
    { x: 15, y: -75 },
    { x: 15, y: 55 },
    { x: 30, y: 55 },
    { x: 30, y: 75 },
    { x: -30, y: 75 },
    { x: -30, y: 55 },
    { x: -15, y: 55 },
  ],
};

function rectProfile(w: number, d: number): Vec2[] {
  return [
    { x: -w / 2, y: -d / 2 },
    { x: w / 2, y: -d / 2 },
    { x: w / 2, y: d / 2 },
    { x: -w / 2, y: d / 2 },
  ];
}

function circleProfile(r: number): Vec2[] {
  return Array.from({ length: 16 }, (_, i) => ({ x: r * Math.cos((2 * Math.PI * i) / 16), y: r * Math.sin((2 * Math.PI * i) / 16) }));
}

/** The section of one mullion: its own profile, else the type's interior/border one, else width × depth. */
export function mullionProfile(grid: CurtainGrid, border: boolean, own?: string | null): Vec2[] {
  const name = own ?? (border ? grid.borderMullion : grid.interiorMullion) ?? null;
  if (name && MULLION_PROFILES[name]) return MULLION_PROFILES[name]!;
  return grid.mullionShape === "circular" ? circleProfile(grid.mullionWidth / 2) : rectProfile(grid.mullionWidth, grid.mullionDepth);
}

/** A curtain panel: glazed (default), solid, empty (no panel) or a glazed door. */
export type CurtainPanelKind = "glass" | "solid" | "empty" | "door";

/**
 * One curtain wall's own grid and panels (Revit: add/remove grid line segments, swap panels).
 * Cells are numbered from the wall's start (i) and its base (j).
 */
export type CurtainEdits = {
  /** Interior vertical grid lines, mm along from the start; the type's equal spacing when unset. */
  uLines?: number[] | null;
  /** Interior horizontal grid lines, mm above the wall's base. */
  zLines?: number[] | null;
  /** Panel swaps by cell, "i,j". */
  panels?: Record<string, CurtainPanelKind> | null;
  /** Removed mullion segments: "v:k:j" (vertical line k in row j) or "h:k:i" (horizontal line k in bay i). */
  removed?: string[] | null;
  /** Mullion profile swaps by segment key (as `removed`). */
  mullions?: Record<string, string> | null;
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

/** Set a curtain wall's own grid and panels (validated: lines inside the wall, panels known). */
export function setCurtainEdits(tx: Transaction, doc: Document, id: ElementId, edits: CurtainEdits | null): void {
  const wall = doc.require<WallParams>(id) as Wall;
  if (wall.category !== Cat.Wall || !curtainOf(doc, wall)) throw new Error("Only curtain walls have grid lines and panels");
  if (edits) {
    const len = wallLength(wall);
    const { bottom, top } = wallExtent(doc, wall);
    const check = (xs: number[] | null | undefined, max: number, what: string) => {
      for (const x of xs ?? []) if (!(x > 0 && x < max)) throw new Error(`${what} grid lines must be inside the wall`);
    };
    check(edits.uLines, len, "Vertical");
    check(edits.zLines, top - bottom, "Horizontal");
    for (const k of Object.values(edits.panels ?? {})) if (!["glass", "solid", "empty", "door"].includes(k)) throw new Error(`Unknown panel ${k}`);
    for (const m of Object.values(edits.mullions ?? {})) if (!MULLION_PROFILES[m]) throw new Error(`Unknown mullion profile ${m}`);
  }
  const sorted = (xs: number[] | null | undefined) => (xs ? [...new Set(xs.map((x) => Math.round(x * 10) / 10))].sort((a, b) => a - b) : xs);
  tx.update<WallParams>(id, { curtainEdits: edits ? { ...edits, uLines: sorted(edits.uLines), zLines: sorted(edits.zLines) } : null });
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
  /** Disallow Join (Revit): these ends stay square and don't join other walls. */
  disallowJoin?: { start?: boolean; end?: boolean } | null;
  /** This wall's own sweeps and reveals (the type's come first; see model/sweeps.ts). */
  sweeps?: WallSweep[] | null;
  /** Curtain walls: this wall's grid lines, mullion segments and panel swaps. */
  curtainEdits?: CurtainEdits | null;
  /** Edit Profile: the wall's elevation outline (x along from its start, y up from its base, mm); a rectangle when unset. */
  profile?: Vec2[] | null;
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
  /** Slope arrow (Revit): the top tilts as a plane from the tail to the head. */
  slope?: SlopeArrow | null;
};
export type Floor = Element<FloorParams>;

/**
 * A slope arrow: heights at its tail and head, as offsets from the floor's top (mm). The top is
 * the plane through both that is level across the arrow.
 */
export type SlopeArrow = { tail: Vec2; head: Vec2; tailOffset: number; headOffset: number };

/** The top surface as z = c + gx·x + gy·y, offsets included (flat floors: gx = gy = 0). */
export function floorTopPlane(doc: Document, floor: Floor): { c: number; gx: number; gy: number } {
  const level = doc.require<LevelParams>(floor.params.levelId).params.elevation;
  const base = level + floor.params.offset;
  const s = floor.params.slope;
  if (!s) return { c: base, gx: 0, gy: 0 };
  const dx = s.head.x - s.tail.x;
  const dy = s.head.y - s.tail.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1) return { c: base + s.tailOffset, gx: 0, gy: 0 };
  const k = (s.headOffset - s.tailOffset) / len2;
  const gx = dx * k;
  const gy = dy * k;
  return { c: base + s.tailOffset - gx * s.tail.x - gy * s.tail.y, gx, gy };
}

/** Height of the floor's top at plan point `p`, mm. */
export function floorTopAt(doc: Document, floor: Floor, p: Vec2): number {
  const t = floorTopPlane(doc, floor);
  return t.c + t.gx * p.x + t.gy * p.y;
}

/** Slope as rise over run (e.g. 0.02 = 1:50), from the arrow; 0 when flat. */
export function floorSlope(floor: Floor): number {
  const s = floor.params.slope;
  if (!s) return 0;
  const len = Math.hypot(s.head.x - s.tail.x, s.head.y - s.tail.y);
  return len < 1 ? 0 : Math.abs(s.headOffset - s.tailOffset) / len;
}

export function floorThickness(doc: Document, floor: Floor): number {
  if (!floor.typeId) throw new Error("Floor has no type");
  return totalThickness(doc.require<LayeredTypeParams>(floor.typeId));
}

/** Absolute Z of floor top and bottom, mm. */
export function floorExtent(doc: Document, floor: Floor): { bottom: number; top: number } {
  if (floor.params.slope) {
    // Sloped: the highest and lowest points of the top over the boundary.
    const zs = floor.params.boundary.map((p) => floorTopAt(doc, floor, p));
    return { top: Math.max(...zs), bottom: Math.min(...zs) - floorThickness(doc, floor) };
  }
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
