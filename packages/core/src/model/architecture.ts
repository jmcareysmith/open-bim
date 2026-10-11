import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { relatedWalls } from "./joins.ts";

// ---- categories ----------------------------------------------------------

export const Cat = {
  Level: "Level",
  Wall: "Wall",
  WallType: "WallType",
  Floor: "Floor",
  FloorType: "FloorType",
  Grid: "Grid",
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
  material: string;
  /** mm */
  thickness: number;
};

export type LayeredTypeParams = {
  /** Exterior → interior (walls) or top → bottom (floors). */
  layers: Layer[];
};

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

/** Absolute bottom and top Z of the wall, mm. */
export function wallExtent(doc: Document, wall: Wall): { bottom: number; top: number } {
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

// ---- registration --------------------------------------------------------

const typeDeps = (el: Element): ElementId[] => (el.typeId ? [el.typeId] : []);

registerCategory({ name: Cat.Level, dependencies: () => [], cascadeDelete: false, isType: false });
registerCategory({ name: Cat.WallType, dependencies: () => [], cascadeDelete: false, isType: true });
registerCategory({ name: Cat.FloorType, dependencies: () => [], cascadeDelete: false, isType: true });

registerCategory({
  name: Cat.Wall,
  dependencies: (el) => {
    const p = el.params as WallParams;
    return [p.baseLevelId, ...(p.topLevelId ? [p.topLevelId] : []), ...typeDeps(el)];
  },
  related: (doc, el) => relatedWalls(doc, el as Wall),
  cascadeDelete: true,
  isType: false,
});

registerCategory({
  name: Cat.Floor,
  dependencies: (el) => [(el.params as FloorParams).levelId, ...typeDeps(el)],
  cascadeDelete: true,
  isType: false,
});

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
  return tx.create<FloorParams>(
    Cat.Floor,
    { levelId, boundary, offset: opts.offset ?? 0, holes: opts.holes ?? [] },
    { typeId },
  );
}

/** Sorted by elevation, lowest first. */
export function levels(doc: Document): Level[] {
  return doc.byCategory<LevelParams>(Cat.Level).sort((a, b) => a.params.elevation - b.params.elevation);
}
