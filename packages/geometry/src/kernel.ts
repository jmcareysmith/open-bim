import {
  Cat,
  floorExtent,
  wallExtent,
  wallThickness,
  type Document,
  type Element,
  type Floor,
  type Vec2,
  type Wall,
} from "@open-bim/core";
import { extrudePolygon, type MeshData } from "./mesh.ts";

/**
 * Converts elements into renderable geometry.
 * `SimpleKernel` handles extrusions; an OpenCascade kernel will implement the same interface
 * for booleans (openings), sweeps and hidden-line drawings.
 */
export interface GeometryKernel {
  /** Returns null for elements without 3D geometry (levels, types…). */
  build(doc: Document, el: Element): MeshData | null;
}

type Builder = (doc: Document, el: Element) => MeshData | null;

/** Plan footprint of a straight wall: rectangle around its location line. */
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
  const fp = wallFootprint(wall.params.start, wall.params.end, wallThickness(doc, wall));
  return extrudePolygon(fp, [], bottom, top);
}

export function buildFloor(doc: Document, el: Element): MeshData | null {
  const floor = el as Floor;
  const { bottom, top } = floorExtent(doc, floor);
  return extrudePolygon(floor.params.boundary, floor.params.holes, bottom, top);
}

export class SimpleKernel implements GeometryKernel {
  private builders = new Map<string, Builder>([
    [Cat.Wall, buildWall],
    [Cat.Floor, buildFloor],
  ]);

  register(category: string, builder: Builder): void {
    this.builders.set(category, builder);
  }

  build(doc: Document, el: Element): MeshData | null {
    return this.builders.get(el.category)?.(doc, el) ?? null;
  }
}
