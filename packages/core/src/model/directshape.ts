import { registerCategory } from "../categories.ts";
import type { Transaction } from "../document.ts";
import type { Element, ElementId } from "../element.ts";
import { Cat } from "./architecture.ts";

// Direct shapes (Revit: DirectShape) — fixed geometry with no parametric behaviour, as brought in
// from IFC. The mesh is stored on the element (model mm, Z up), with the source class, GlobalId
// and flattened properties ("Pset_WallCommon.FireRating" → value) so it can be scheduled.

export type DirectShapeParams = {
  levelId: ElementId;
  /** Source IFC entity, e.g. "IfcWall". */
  ifcClass: string;
  globalId: string;
  /** Triangle mesh in model coordinates: xyz per vertex, three indices per triangle. */
  positions: number[];
  indices: number[];
  /** 0xRRGGBB. */
  color: number;
  properties: Record<string, string>;
};
export type DirectShape = Element<DirectShapeParams>;

registerCategory({
  name: Cat.DirectShape,
  dependencies: (el) => [(el.params as DirectShapeParams).levelId],
  cascadeDelete: true,
  isType: false,
});

export function createDirectShape(tx: Transaction, p: DirectShapeParams, name?: string): DirectShape {
  if (p.indices.length % 3 || p.positions.length % 3) throw new Error("Direct shape mesh must be triangles");
  return tx.create<DirectShapeParams>(Cat.DirectShape, p, name ? { name } : {}) as DirectShape;
}

/** Imported IFC shapes (DirectShapes) show and style as the category their IFC class means. */
const IFC_CLASS_CATEGORY: Record<string, string> = {
  IfcWall: Cat.Wall,
  IfcWallStandardCase: Cat.Wall,
  IfcCurtainWall: Cat.Wall,
  IfcSlab: Cat.Floor,
  IfcRoof: Cat.Roof,
  IfcCovering: Cat.Ceiling,
  IfcDoor: Cat.Door,
  IfcWindow: Cat.Window,
  IfcColumn: Cat.Column,
  IfcBeam: Cat.Beam,
  IfcMember: Cat.Beam,
  IfcFooting: Cat.PadFooting,
  IfcStair: Cat.Stair,
  IfcStairFlight: Cat.Stair,
  IfcRailing: Cat.Railing,
  IfcRamp: Cat.Ramp,
  IfcRampFlight: Cat.Ramp,
  IfcFurniture: "Furniture",
  IfcFurnishingElement: "Furniture",
  IfcBuildingElementProxy: "GenericModel",
};

export function ifcClassCategory(ifcClass: string): string | undefined {
  return IFC_CLASS_CATEGORY[ifcClass];
}
