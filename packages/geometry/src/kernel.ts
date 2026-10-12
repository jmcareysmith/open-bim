import {
  Cat,
  ceilingExtent,
  isFormCategory,
  type Values,
  floorExtent,
  wallExtent,
  type Document,
  type Ceiling,
  type Element,
  type Floor,
  type Vec2,
  type Wall,
  curtainOf,
  stackSegments,
} from "@open-bim/core";
import { buildGridLines, buildOpeningLines, buildReferencePlaneLines, type LineData } from "./datums.ts";
import { buildDoor, buildDoorLines, buildWindow, buildWindowLines } from "./doors.ts";
import { joinedWallFootprint } from "./joins.ts";
import { buildRoof } from "./roof.ts";
import { buildForm, formMesh } from "./forms.ts";
import { mergeMeshes } from "./doors.ts";
import { buildFamilyInstance, nestedMeshes } from "./components.ts";
import { buildViewMarker } from "./sections.ts";
import { buildAnnotationLines } from "./annotations.ts";
import { buildLegendLines } from "./legends.ts";
import { buildCurtainWall } from "./curtain.ts";
import { buildStackedWall } from "./stacked.ts";
import { buildDirectShape } from "./directshape.ts";
import { buildLink } from "./links.ts";
import { buildStair, buildStairLines } from "./stairs.ts";
import { buildRailing, buildRailingLines } from "./railings.ts";
import { buildRamp, buildRampLines } from "./ramps.ts";
import { buildToposolid, buildToposolidLines } from "./site.ts";
import { buildBeam, buildColumn, buildPadFooting, buildStripFooting } from "./structure.ts";
import { buildCadImportLines } from "./dxf.ts";
import { buildRevisionCloudLines } from "./revisions.ts";
import { buildSymbolLines } from "./symbols.ts";
import { buildAreaBoundaryLines, buildAreaLines, buildRoomLines, buildRoomSeparatorLines } from "./rooms.ts";
import { extrudePolygon, type MeshData } from "./mesh.ts";

/**
 * Converts elements into renderable geometry.
 * `SimpleKernel` handles extrusions; an OpenCascade kernel will implement the same interface
 * for booleans (openings), sweeps and hidden-line drawings.
 */
export interface GeometryKernel {
  /** Returns null for elements without 3D geometry (levels, types…). */
  build(doc: Document, el: Element): MeshData | null;
  /** Line work: datums (grids…), opening outlines, plan symbols (door swings). May accompany a mesh. */
  buildLines(doc: Document, el: Element): LineData | null;
  /** A family document's geometry (solids minus voids where supported) for given parameter values. */
  familyMesh(familyDoc: Document, values: Values): MeshData | null;
}

type Builder = (doc: Document, el: Element) => MeshData | null;
type LineBuilder = (doc: Document, el: Element) => LineData | null;

/** Plan footprint of a straight, unjoined wall: rectangle around its location line. */
export function wallFootprint(start: Vec2, end: Vec2, thickness: number): Vec2[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) throw new Error("Zero-length wall");
  const h = thickness / 2;
  const nx = (-dy / len) * h;
  const ny = (dx / len) * h;
  return [
    { x: start.x - nx, y: start.y - ny },
    { x: end.x - nx, y: end.y - ny },
    { x: end.x + nx, y: end.y + ny },
    { x: start.x + nx, y: start.y + ny },
  ];
}

export function buildWall(doc: Document, el: Element): MeshData | null {
  const wall = el as Wall;
  const { bottom, top } = wallExtent(doc, wall);
  if (top <= bottom) return null;
  const grid = curtainOf(doc, wall);
  if (grid) return buildCurtainWall(doc, wall, grid);
  const segments = stackSegments(doc, wall);
  if (segments.length) return buildStackedWall(doc, wall, segments);
  return extrudePolygon(joinedWallFootprint(doc, wall), [], bottom, top);
}

export function buildFloor(doc: Document, el: Element): MeshData | null {
  const floor = el as Floor;
  const { bottom, top } = floorExtent(doc, floor);
  return extrudePolygon(floor.params.boundary, floor.params.holes, bottom, top);
}

export function buildCeiling(doc: Document, el: Element): MeshData | null {
  const ceiling = el as Ceiling;
  const { bottom, top } = ceilingExtent(doc, ceiling);
  return extrudePolygon(ceiling.params.boundary, ceiling.params.holes, bottom, top);
}

export class SimpleKernel implements GeometryKernel {
  /** Stable family mesher (the family mesh cache is keyed by it). */
  private mesher = (fd: Document, v: Values) => this.familyMesh(fd, v);
  private builders = new Map<string, Builder>([
    [Cat.Wall, buildWall],
    [Cat.DirectShape, buildDirectShape],
    [Cat.Stair, buildStair],
    [Cat.Railing, buildRailing],
    [Cat.Ramp, buildRamp],
    [Cat.Toposolid, buildToposolid],
    [Cat.Column, buildColumn],
    [Cat.Beam, buildBeam],
    [Cat.PadFooting, buildPadFooting],
    [Cat.StripFooting, buildStripFooting],
    [Cat.Link, (doc, el) => buildLink(doc, el, this)],
    [Cat.Floor, buildFloor],
    [Cat.Ceiling, buildCeiling],
    [Cat.Roof, buildRoof],
    [Cat.Door, buildDoor],
    [Cat.Window, buildWindow],
    [Cat.Extrusion, buildForm],
    [Cat.Blend, buildForm],
    [Cat.Revolution, buildForm],
    [Cat.Sweep, buildForm],
    [Cat.FamilyInstance, (doc, el) => buildFamilyInstance(doc, el, this.mesher)],
  ]);

  private lineBuilders = new Map<string, LineBuilder>([
    [Cat.Grid, buildGridLines],
    [Cat.ReferencePlane, buildReferencePlaneLines],
    [Cat.WallOpening, buildOpeningLines],
    [Cat.Door, buildDoorLines],
    [Cat.Window, buildWindowLines],
    [Cat.View, buildViewMarker],
    [Cat.DetailLine, buildAnnotationLines],
    [Cat.FilledRegion, buildAnnotationLines],
    [Cat.TextNote, buildAnnotationLines],
    [Cat.Dimension, buildAnnotationLines],
    [Cat.Room, buildRoomLines],
    [Cat.RoomSeparator, buildRoomSeparatorLines],
    [Cat.Area, buildAreaLines],
    [Cat.AreaBoundary, buildAreaBoundaryLines],
    [Cat.Tag, buildAnnotationLines],
    [Cat.LegendComponent, buildLegendLines],
    [Cat.KeynoteLegend, buildLegendLines],
    [Cat.RevisionCloud, buildRevisionCloudLines],
    [Cat.Symbol, buildSymbolLines],
    [Cat.CadImport, buildCadImportLines],
    [Cat.Stair, buildStairLines],
    [Cat.Railing, buildRailingLines],
    [Cat.Ramp, buildRampLines],
    [Cat.Toposolid, buildToposolidLines],
  ]);

  register(category: string, builder: Builder): void {
    this.builders.set(category, builder);
  }

  registerLines(category: string, builder: LineBuilder): void {
    this.lineBuilders.set(category, builder);
  }

  build(doc: Document, el: Element): MeshData | null {
    return this.builders.get(el.category)?.(doc, el) ?? null;
  }

  buildLines(doc: Document, el: Element): LineData | null {
    return this.lineBuilders.get(el.category)?.(doc, el) ?? null;
  }

  /** All solid forms of a family document as one mesh. Voids need the OCCT kernel and are skipped. */
  familyMesh(familyDoc: Document, values: Values): MeshData | null {
    const solids = familyDoc
      .all()
      .filter((e) => isFormCategory(e.category) && !(e.params as { isVoid?: boolean }).isVoid)
      .map((e) => formMesh(e, values));
    const parts = [...solids, ...nestedMeshes(familyDoc, values, this.mesher)];
    return parts.length ? mergeMeshes(parts) : null;
  }
}
