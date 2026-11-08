import { tangentLine,
  doorPlacement,
  wallExtent,
  wallThickness,
  windowPlacement,
  type DoorParams,
  type DoorTypeParams,
  type Document,
  type Element,
  type Wall,
  type WindowTypeParams,
} from "@open-bim/core";
import type { LineData } from "./datums.ts";
import { extrudePolygon, type MeshData } from "./mesh.ts";

/** Door leaf thickness, mm. */
const LEAF = 40;
/** Window frame depth and glass thickness, mm. */
const WINDOW_DEPTH = 100;
const GLASS = 10;
const SWING_SEGMENTS = 16;

/** Wall-local frame: u along the location line from the start, v across (left = +), z absolute. */
interface WallFrame {
  at(u: number, v: number): { x: number; y: number };
  half: number;
  bottom: number;
}

/** The wall's frame around `along` (curved walls: the tangent line there). */
function wallFrame(doc: Document, wall: Wall, along = 0): WallFrame {
  const { start, dir: d } = tangentLine(wall, along);
  return {
    at: (u, v) => ({ x: start.x + d.x * u - d.y * v, y: start.y + d.y * u + d.x * v }),
    half: wallThickness(doc, wall) / 2,
    bottom: wallExtent(doc, wall).bottom,
  };
}

/** Box in wall coordinates. */
function box(f: WallFrame, u0: number, u1: number, v0: number, v1: number, z0: number, z1: number): MeshData {
  return extrudePolygon([f.at(u0, v0), f.at(u1, v0), f.at(u1, v1), f.at(u0, v1)], [], z0, z1);
}

export function mergeMeshes(meshes: MeshData[]): MeshData {
  const n = meshes.reduce((s, m) => s + m.positions.length, 0);
  const k = meshes.reduce((s, m) => s + m.indices.length, 0);
  const positions = new Float32Array(n);
  const normals = new Float32Array(n);
  const indices = new Uint32Array(k);
  // Vertex colours survive the merge (white where a part has none).
  const colored = meshes.some((m) => m.colors);
  const colors = colored ? new Float32Array(n).fill(1) : null;
  let po = 0;
  let io = 0;
  for (const m of meshes) {
    positions.set(m.positions, po);
    normals.set(m.normals, po);
    if (colors && m.colors) colors.set(m.colors, po);
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i]! + po / 3;
    po += m.positions.length;
    io += m.indices.length;
  }
  return colors ? { positions, normals, indices, colors } : { positions, normals, indices };
}

function host(doc: Document, el: Element): Wall {
  return doc.require((el.params as { hostId: string }).hostId) as Wall;
}

/** Painted trim, timber leaf, satin chrome hardware (Revit's default door look). */
const TRIM: RGB = [0.93, 0.92, 0.89];
const TIMBER: RGB = [0.56, 0.39, 0.25];
const METAL: RGB = [0.66, 0.68, 0.7];
const ARCHITRAVE = 70;
const ARCHITRAVE_T = 18;
type RGB = [number, number, number];

function paint(m: MeshData, c: RGB): MeshData {
  const colors = new Float32Array(m.positions.length);
  for (let i = 0; i < colors.length; i += 3) colors.set(c, i);
  return { ...m, colors };
}

/**
 * Door: jambs and head through the wall, architraves round the opening on both faces, the leaf
 * in the middle and a lever handle each side on the latch edge.
 */
export function buildDoor(doc: Document, el: Element): MeshData {
  const p = doorPlacement(doc, el);
  const f = wallFrame(doc, host(doc, el), p.position);
  const t = doc.require<DoorTypeParams>(el.typeId!).params;
  const u0 = p.position - p.width / 2;
  const u1 = p.position + p.width / 2;
  const z0 = f.bottom + p.sillHeight;
  const z1 = z0 + p.height;
  const fw = t.frameWidth;
  const parts: MeshData[] = [
    paint(box(f, u0, u0 + fw, -f.half, f.half, z0, z1), TRIM),
    paint(box(f, u1 - fw, u1, -f.half, f.half, z0, z1), TRIM),
    paint(box(f, u0 + fw, u1 - fw, -f.half, f.half, z1 - fw, z1), TRIM),
    paint(box(f, u0 + fw, u1 - fw, -LEAF / 2, LEAF / 2, z0, z0 + t.leafHeight), TIMBER),
  ];
  const A = ARCHITRAVE;
  for (const s of [1, -1]) {
    const va = s > 0 ? f.half : -f.half - ARCHITRAVE_T;
    const vb = va + ARCHITRAVE_T;
    parts.push(
      paint(box(f, u0 - A, u0, va, vb, z0, z1 + A), TRIM),
      paint(box(f, u1, u1 + A, va, vb, z0, z1 + A), TRIM),
      paint(box(f, u0, u1, va, vb, z1, z1 + A), TRIM),
    );
  }
  // Lever handles at 1000, 60 in from the latch edge, pointing back towards the hinge.
  const handFlipped = !!(el.params as DoorParams).handFlipped;
  const latch = p.position + (handFlipped ? -1 : 1) * (t.leafWidth / 2 - 60);
  const toHinge = handFlipped ? 1 : -1;
  const zh = z0 + 1000;
  for (const s of [1, -1]) {
    const v0 = s > 0 ? LEAF / 2 : -LEAF / 2 - 50;
    parts.push(paint(box(f, latch - 10, latch + 10, v0, v0 + 50, zh - 10, zh + 10), METAL));
    const vl = s > 0 ? LEAF / 2 + 40 : -LEAF / 2 - 60;
    const ua = Math.min(latch, latch + toHinge * 130);
    parts.push(paint(box(f, ua, ua + 130, vl, vl + 20, zh - 9, zh + 9), METAL));
  }
  return mergeMeshes(parts);
}

/** Plan symbol: the leaf drawn open at 90° and its swing arc, just above the door's sill. */
export function buildDoorLines(doc: Document, el: Element): LineData {
  const p = el.params as DoorParams;
  const f = wallFrame(doc, host(doc, el), p.position);
  const t = doc.require<DoorTypeParams>(el.typeId!).params;
  const side = p.facingFlipped ? -1 : 1;
  const hinge = p.position + (p.handFlipped ? 1 : -1) * (t.leafWidth / 2);
  const away = p.handFlipped ? -1 : 1; // from the hinge towards the latch
  const z = f.bottom + p.sillHeight + 10;
  const r = t.leafWidth;
  const v0 = side * f.half;
  const seg: number[] = [];
  const push = (a: { x: number; y: number }, b: { x: number; y: number }) => seg.push(a.x, a.y, z, b.x, b.y, z);
  push(f.at(hinge, v0), f.at(hinge, v0 + side * r)); // open leaf
  for (let i = 0; i < SWING_SEGMENTS; i++) {
    const a0 = (i / SWING_SEGMENTS) * (Math.PI / 2);
    const a1 = ((i + 1) / SWING_SEGMENTS) * (Math.PI / 2);
    const pt = (a: number) => f.at(hinge + away * r * Math.sin(a), v0 + side * r * Math.cos(a));
    push(pt(a0), pt(a1));
  }
  return { segments: new Float32Array(seg), labels: [], placement: "model", planOnly: true };
}

/** Window: four frame members centred in the wall, glass in the middle. */
export function buildWindow(doc: Document, el: Element): MeshData {
  const p = windowPlacement(doc, el);
  const f = wallFrame(doc, host(doc, el), p.position);
  const t = doc.require<WindowTypeParams>(el.typeId!).params;
  const u0 = p.position - p.width / 2;
  const u1 = p.position + p.width / 2;
  const z0 = f.bottom + p.sillHeight;
  const z1 = z0 + p.height;
  const fw = t.frameWidth;
  const d = Math.min(WINDOW_DEPTH, f.half * 2) / 2;
  const parts: MeshData[] = [
    box(f, u0, u0 + fw, -d, d, z0, z1),
    box(f, u1 - fw, u1, -d, d, z0, z1),
    box(f, u0 + fw, u1 - fw, -d, d, z0, z0 + fw),
    box(f, u0 + fw, u1 - fw, -d, d, z1 - fw, z1),
    // A sill standing out from the exterior face (left of the wall's direction).
    box(f, u0 - 30, u1 + 30, d, f.half + 40, z0 - 25, z0 + 5),
  ];
  // Wide windows split into two sashes with a mullion; each sash a slim frame round its glass.
  const panes: [number, number][] = p.width > 1000 ? [[u0 + fw, p.position - fw / 2], [p.position + fw / 2, u1 - fw]] : [[u0 + fw, u1 - fw]];
  if (panes.length > 1) parts.push(box(f, p.position - fw / 2, p.position + fw / 2, -d, d, z0 + fw, z1 - fw));
  const S = 35;
  for (const [a, b] of panes) {
    parts.push(
      box(f, a, a + S, -20, 20, z0 + fw, z1 - fw),
      box(f, b - S, b, -20, 20, z0 + fw, z1 - fw),
      box(f, a + S, b - S, -20, 20, z0 + fw, z0 + fw + S),
      box(f, a + S, b - S, -20, 20, z1 - fw - S, z1 - fw),
    );
  }
  const frame = mergeMeshes(parts);
  const glass = mergeMeshes(panes.map(([a, b]) => box(f, a + S, b - S, -GLASS / 2, GLASS / 2, z0 + fw + S, z1 - fw - S)));
  return { ...mergeMeshes([frame, glass]), glass: { start: frame.indices.length, count: glass.indices.length } };
}

/** Plan symbol: frame outline through the wall and the glass line, drawn just above the floor. */
export function buildWindowLines(doc: Document, el: Element): LineData {
  const wall = host(doc, el);
  const p = windowPlacement(doc, el);
  const f = wallFrame(doc, wall, p.position);
  const u0 = p.position - p.width / 2;
  const u1 = p.position + p.width / 2;
  const d = Math.min(WINDOW_DEPTH, f.half * 2) / 2;
  const z = f.bottom + 10;
  const seg: number[] = [];
  const line = (ua: number, va: number, ub: number, vb: number) => {
    const a = f.at(ua, va);
    const b = f.at(ub, vb);
    seg.push(a.x, a.y, z, b.x, b.y, z);
  };
  line(u0, -f.half, u0, f.half); // jambs: where the wall stops
  line(u1, -f.half, u1, f.half);
  line(u0, -d, u1, -d); // frame faces
  line(u0, d, u1, d);
  line(u0, 0, u1, 0); // glass
  return { segments: new Float32Array(seg), labels: [], placement: "model", planOnly: true };
}
