import {
  doorPlacement,
  wallDirection,
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

function wallFrame(doc: Document, wall: Wall): WallFrame {
  const d = wallDirection(wall);
  const { start } = wall.params;
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
  let po = 0;
  let io = 0;
  for (const m of meshes) {
    positions.set(m.positions, po);
    normals.set(m.normals, po);
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i]! + po / 3;
    po += m.positions.length;
    io += m.indices.length;
  }
  return { positions, normals, indices };
}

function host(doc: Document, el: Element): Wall {
  return doc.require((el.params as { hostId: string }).hostId) as Wall;
}

/** Door: two jambs and a head through the wall's thickness, with a closed leaf in the middle. */
export function buildDoor(doc: Document, el: Element): MeshData {
  const f = wallFrame(doc, host(doc, el));
  const p = doorPlacement(doc, el);
  const t = doc.require<DoorTypeParams>(el.typeId!).params;
  const u0 = p.position - p.width / 2;
  const u1 = p.position + p.width / 2;
  const z0 = f.bottom + p.sillHeight;
  const z1 = z0 + p.height;
  const fw = t.frameWidth;
  return mergeMeshes([
    box(f, u0, u0 + fw, -f.half, f.half, z0, z1),
    box(f, u1 - fw, u1, -f.half, f.half, z0, z1),
    box(f, u0 + fw, u1 - fw, -f.half, f.half, z1 - fw, z1),
    box(f, u0 + fw, u1 - fw, -LEAF / 2, LEAF / 2, z0, z0 + t.leafHeight),
  ]);
}

/** Plan symbol: the leaf drawn open at 90° and its swing arc, just above the door's sill. */
export function buildDoorLines(doc: Document, el: Element): LineData {
  const f = wallFrame(doc, host(doc, el));
  const p = el.params as DoorParams;
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
  const f = wallFrame(doc, host(doc, el));
  const p = windowPlacement(doc, el);
  const t = doc.require<WindowTypeParams>(el.typeId!).params;
  const u0 = p.position - p.width / 2;
  const u1 = p.position + p.width / 2;
  const z0 = f.bottom + p.sillHeight;
  const z1 = z0 + p.height;
  const fw = t.frameWidth;
  const d = Math.min(WINDOW_DEPTH, f.half * 2) / 2;
  return mergeMeshes([
    box(f, u0, u0 + fw, -d, d, z0, z1),
    box(f, u1 - fw, u1, -d, d, z0, z1),
    box(f, u0 + fw, u1 - fw, -d, d, z0, z0 + fw),
    box(f, u0 + fw, u1 - fw, -d, d, z1 - fw, z1),
    box(f, u0 + fw, u1 - fw, -GLASS / 2, GLASS / 2, z0 + fw, z1 - fw),
  ]);
}

/** Plan symbol: frame outline through the wall and the glass line, drawn just above the floor. */
export function buildWindowLines(doc: Document, el: Element): LineData {
  const wall = host(doc, el);
  const f = wallFrame(doc, wall);
  const p = windowPlacement(doc, el);
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
