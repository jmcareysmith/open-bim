import { buildMassFloorLines } from "./massfloors.ts";
import { buildDuct, buildDuctFitting, buildDuctFittingLines, buildDuctLines } from "./ducts.ts";
import { slopedTopWallMesh } from "./wallattach.ts";
import {
  Cat,
  ceilingExtent,
  isFormCategory,
  type Values,
  floorExtent,
  floorSlope,
  floorThickness,
  floorTopPlane,
  wallExtent,
  type Document,
  type Ceiling,
  type Element,
  type Floor,
  type Vec2,
  type Wall,
  curtainOf,
  stackSegments,
  hasSlopedTop,
} from "@open-bim/core";
import { buildConnectorLines, buildGridLines, buildOpeningLines, buildReferencePlaneLines, type LineData } from "./datums.ts";
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
import { buildToposolid, buildToposolidLines, buildBuildingPad, buildSubregion, buildSubregionLines, buildPropertyLines } from "./site.ts";
import { buildBeam,
  buildBeamLines, buildColumn, buildPadFooting, buildStripFooting } from "./structure.ts";
import { buildCadImportLines } from "./dxf.ts";
import { buildRevisionCloudLines } from "./revisions.ts";
import { buildSymbolLines } from "./symbols.ts";
import { buildDetailComponentLines } from "./detailcomponents.ts";
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
  /** Plan line work; `scale` (the view's 1:n) sizes annotation-like parts such as grid bubbles. */
  buildLines(doc: Document, el: Element, scale?: number): LineData | null;
  /** A family document's geometry (solids minus voids where supported) for given parameter values. */
  familyMesh(familyDoc: Document, values: Values): MeshData | null;
}

type Builder = (doc: Document, el: Element) => MeshData | null;
type LineBuilder = (doc: Document, el: Element, scale: number) => LineData | null;

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
  // Attached under a sloped roof: the top follows it.
  if (hasSlopedTop(doc, wall)) return slopedTopWallMesh(doc, wall);
  return extrudePolygon(joinedWallFootprint(doc, wall), [], bottom, top);
}

export function buildFloor(doc: Document, el: Element): MeshData | null {
  const floor = el as Floor;
  if (floor.params.slope) {
    // Sloped (slope arrow): a flat slab sheared onto the top plane, so it keeps its thickness vertically.
    const plane = floorTopPlane(doc, floor);
    const thick = floorThickness(doc, floor);
    const mesh = extrudePolygon(floor.params.boundary, floor.params.holes, -thick, 0);
    const { positions: pos, normals: nor } = mesh;
    const k = Math.hypot(plane.gx, plane.gy, 1);
    for (let i = 0; i < pos.length; i += 3) {
      pos[i + 2] = pos[i + 2]! + plane.c + plane.gx * pos[i]! + plane.gy * pos[i + 1]!;
      // Top and bottom faces tilt with the plane; the sides stay vertical.
      const nz = nor[i + 2]!;
      if (Math.abs(nz) > 0.5) {
        const sg = Math.sign(nz);
        nor[i] = (-plane.gx / k) * sg;
        nor[i + 1] = (-plane.gy / k) * sg;
        nor[i + 2] = (1 / k) * sg;
      }
    }
    return mesh;
  }
  const { bottom, top } = floorExtent(doc, floor);
  return extrudePolygon(floor.params.boundary, floor.params.holes, bottom, top);
}

/** Plan symbol for a sloped floor: its slope arrow, tail to head, with the fall as 1:n. */
export function buildFloorLines(doc: Document, el: Element): LineData | null {
  const floor = el as Floor;
  const s = floor.params.slope;
  if (!s) return null;
  const dx = s.head.x - s.tail.x;
  const dy = s.head.y - s.tail.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  const d = { x: dx / len, y: dy / len };
  const n = { x: -d.y, y: d.x };
  const h = Math.min(300, len / 4);
  const b = s.head;
  const seg = [s.tail.x, s.tail.y, 0, b.x, b.y, 0];
  seg.push(b.x, b.y, 0, b.x - d.x * h + n.x * h * 0.5, b.y - d.y * h + n.y * h * 0.5, 0);
  seg.push(b.x, b.y, 0, b.x - d.x * h - n.x * h * 0.5, b.y - d.y * h - n.y * h * 0.5, 0);
  const slope = floorSlope(floor);
  const mid = { x: (s.tail.x + b.x) / 2 + n.x * 200, y: (s.tail.y + b.y) / 2 + n.y * 200 };
  const labels: LineData["labels"] = slope > 0 ? [{ text: `1:${Math.round(1 / slope)}`, position: [mid.x, mid.y, 0], size: 200 }] : [];
  return { segments: new Float32Array(seg), labels, planOnly: true };
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
    [Cat.BuildingPad, buildBuildingPad],
    [Cat.SiteSubregion, buildSubregion],
    [Cat.Column, buildColumn],
    [Cat.Beam, buildBeam],
    [Cat.PadFooting, buildPadFooting],
    [Cat.StripFooting, buildStripFooting],
    [Cat.Link, (doc, el) => buildLink(doc, el, this)],
    [Cat.Floor, buildFloor],
    [Cat.Duct, buildDuct],
    [Cat.DuctFitting, buildDuctFitting],
    [Cat.Pipe, buildDuct],
    [Cat.PipeFitting, buildDuctFitting],
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
    [Cat.DetailComponent, buildDetailComponentLines],
    [Cat.CadImport, buildCadImportLines],
    [Cat.Stair, buildStairLines],
    [Cat.Railing, buildRailingLines],
    [Cat.Ramp, buildRampLines],
    [Cat.Toposolid, buildToposolidLines],
    [Cat.SiteSubregion, buildSubregionLines],
    [Cat.PropertyLine, buildPropertyLines],
    [Cat.Floor, buildFloorLines],
    [Cat.Beam, buildBeamLines],
    [Cat.Duct, buildDuctLines],
    [Cat.DuctFitting, buildDuctFittingLines],
    [Cat.Pipe, buildDuctLines],
    [Cat.PipeFitting, buildDuctFittingLines],
    [Cat.Connector, buildConnectorLines],
    [Cat.MassFloor, buildMassFloorLines],
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

  buildLines(doc: Document, el: Element, scale = 100): LineData | null {
    return this.lineBuilders.get(el.category)?.(doc, el, scale) ?? null;
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
