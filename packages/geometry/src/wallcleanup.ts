import polygonClipping, { type Polygon, type Ring } from "polygon-clipping";
import { wallCuts, type Layer,
  arcInfo,
  arcLength,
  arcPoints,
  tangentLine,
  Cat,
  wallDirection,
  wallEndPoint,
  wallJoins,
  wallThickness,
  WALL_ENDS,
  type Document,
  type ElementId,
  type LayerFunction,
  type LayeredTypeParams,
  type Vec2,
  type ViewFrame,
  type Wall,
} from "@open-bim/core";
import type { PlanLinework } from "./hlr.ts";
import { layerRegions } from "./layers.ts";

// Wall join cleanup in plan (Revit's per-layer join cleanup). Where joined walls meet, the higher
// priority layer runs through and the lower one stops against it: structure (core) beats
// substrate, thermal, membrane and finishes. At a tee the stem's core runs on through the through
// wall's finish to meet its core. Crossing walls clean the same way. Lines between joined walls
// are dropped where the material is the same on both sides, so joined cores read as one.

export interface CleanRegion {
  loop: Vec2[];
  materialId: ElementId | undefined;
  /** Its boundary, less the joints with the same material: [x0, y0, x1, y1, …]. */
  lines: number[];
}

export interface CleanCut {
  /** Cut outline loops (for coarse poche). */
  loops: Vec2[][];
  /** The heavy cut outline, less the joints with other walls: [x0, y0, x1, y1, …]. */
  lines: number[];
  /** Layer regions (medium/fine), or null at coarse. */
  regions: CleanRegion[] | null;
}

/** Revit's layer priorities: lower numbers run through higher ones. */
const PRIORITY: Record<LayerFunction, number> = { structure: 1, substrate: 2, thermal: 3, membrane: 4, finish1: 5, finish2: 6 };
/** Overlaps smaller than this (mm²) are touching, not overlapping. */
const MIN_AREA = 1;
/** Lines closer than this (mm) coincide. */
const TOL = 0.5;

interface Region {
  loop: Vec2[];
  materialId: ElementId | undefined;
  priority: number;
}

interface Item {
  wall: Wall;
  regions: Region[];
  thickness: number;
}

/**
 * Cut loops and layer regions for each element of a drawing, with walls cleaned up where they join
 * or cross. `plan` false (sections) leaves everything as cut.
 */
export function cleanCuts(doc: Document, linework: PlanLinework[], frame: ViewFrame, detailed: boolean, plan: boolean): Map<ElementId, CleanCut> {
  const out = new Map<ElementId, CleanCut>();
  const items = new Map<ElementId, Item>();
  for (const lw of linework) {
    const el = doc.get(lw.id);
    if (plan && el && cleanable(doc, el as Wall) && lw.cutLoops.length) {
      items.set(lw.id, { wall: el as Wall, regions: [], thickness: wallThickness(doc, el as Wall) });
    } else if (el) {
      const regions = detailed ? layerRegions(doc, el, lw.cutLoops, frame).map((r) => ({ loop: r.loop, materialId: r.materialId, lines: loopSegments([r.loop]) })) : null;
      out.set(lw.id, { loops: lw.cutLoops, lines: loopSegments(lw.cutLoops), regions });
    }
  }
  if (!items.size) return out;

  // Which walls join or cross which, and tee stems (stem → through wall).
  const related = new Map<ElementId, Set<ElementId>>([...items.keys()].map((id) => [id, new Set<ElementId>()]));
  const relate = (a: ElementId, b: ElementId) => {
    if (a === b || !items.has(a) || !items.has(b)) return;
    related.get(a)!.add(b);
    related.get(b)!.add(a);
  };
  const tees = new Map<ElementId, Set<ElementId>>();
  const extensions = new Map<ElementId, Vec2[][]>();
  for (const [id, it] of items) {
    const joins = wallJoins(doc, it.wall);
    for (const end of WALL_ENDS) {
      const j = joins[end];
      if (j?.kind === "corner") j.others.forEach((o) => relate(id, o.wallId));
      else if (j?.kind === "tee" && items.has(j.wallId)) {
        relate(id, j.wallId);
        if (!tees.has(id)) tees.set(id, new Set());
        tees.get(id)!.add(j.wallId);
        const q = detailed ? teeExtension(doc, it.wall, end, items.get(j.wallId)!.wall) : null;
        if (q) extensions.set(id, [...(extensions.get(id) ?? []), q]);
      }
    }
  }
  const ids = [...items.keys()];
  for (let i = 0; i < ids.length; i++) for (let k = i + 1; k < ids.length; k++) if (crossing(items.get(ids[i]!)!.wall, items.get(ids[k]!)!.wall)) relate(ids[i]!, ids[k]!);

  // Regions per wall: layers (medium/fine) or the whole cut (coarse).
  for (const lw of linework) {
    const it = items.get(lw.id);
    if (!it) continue;
    const ext = extensions.get(lw.id);
    const loops = ext ? unionLoops([...lw.cutLoops, ...ext]) : lw.cutLoops;
    it.regions = detailed
      ? layerRegions(doc, it.wall, loops, frame).map((r) => ({ loop: r.loop, materialId: r.materialId, priority: r.function ? PRIORITY[r.function] : 9 }))
      : loops.map((loop) => ({ loop, materialId: undefined, priority: 1 }));
    if (detailed && plan) it.regions = wrapLayers(doc, it.wall, it.regions, frame.origin[2]);
  }

  // Overlaps: the lower priority layer gives way. Ties go to the through wall of a tee, then the
  // thicker wall, then the wall drawn first.
  const order = new Map(ids.map((id, i) => [id, i]));
  const beats = (a: ElementId, b: ElementId) => {
    if (tees.get(b)?.has(a)) return true;
    if (tees.get(a)?.has(b)) return false;
    const ta = items.get(a)!.thickness;
    const tb = items.get(b)!.thickness;
    if (Math.abs(ta - tb) > 1e-6) return ta > tb;
    return order.get(a)! < order.get(b)!;
  };
  for (const a of ids) {
    for (const b of related.get(a)!) {
      if (order.get(b)! < order.get(a)!) continue;
      resolve(items.get(a)!, items.get(b)!, beats(a, b));
    }
  }

  // Outlines and lines, less the joints between related walls.
  const outlines = new Map<ElementId, Vec2[][]>();
  for (const [id, it] of items) outlines.set(id, it.regions.length ? unionLoops(it.regions.map((r) => r.loop)) : []);
  for (const [id, it] of items) {
    const others = [...related.get(id)!];
    const otherOutline = others.flatMap((o) => loopSegments(outlines.get(o)!));
    const loops = outlines.get(id)!;
    const regions = detailed
      ? it.regions.map((r) => {
          const same = others.flatMap((o) => items.get(o)!.regions.filter((q) => q.materialId === r.materialId).map((q) => q.loop));
          return { loop: r.loop, materialId: r.materialId, lines: subtractCoincident(loopSegments([r.loop]), loopSegments(same)) };
        })
      : null;
    out.set(id, { loops: detailed ? loops : it.regions.map((r) => r.loop), lines: subtractCoincident(loopSegments(loops), otherOutline), regions });
  }
  return out;
}

/**
 * Wrapping at Ends and Inserts: the wrapping side's finish layers — those outside the structure —
 * carry round free (unjoined) ends across the whole thickness, and into the jambs of hosted
 * doors/windows/openings that the plan cut (`cutZ`) passes through, across that side's half. Each
 * strip, as deep as those layers, takes the outermost one's material.
 */
function wrapLayers(doc: Document, wall: Wall, regions: Region[], cutZ: number): Region[] {
  const t = wall.typeId ? doc.get<LayeredTypeParams>(wall.typeId)?.params : undefined;
  if (!t || !t.layers.length) return regions;
  const ends = t.wrapEnds && t.wrapEnds !== "none" ? t.wrapEnds : null;
  const inserts = t.wrapInserts && t.wrapInserts !== "none" ? t.wrapInserts : null;
  if (!ends && !inserts) return regions;
  /** The finish layers on a side, outermost first, and their total depth. */
  const finish = (side: "exterior" | "interior") => {
    const layers = side === "exterior" ? t.layers : [...t.layers].reverse();
    const core = layers.findIndex((l) => l.function === "structure");
    const wrap = layers.slice(0, core < 0 ? 1 : core);
    return { outer: wrap[0], depth: wrap.reduce((s, l) => s + l.thickness, 0) };
  };
  const f = wallFrame(wall);
  const len = f.length;
  const h = wallThickness(doc, wall) / 2 + 1;
  const box = (u0: number, u1: number, v0: number, v1: number): Ring => f.box(u0, u1, v0, v1);
  const zones: { ring: Ring; layer: Layer }[] = [];
  if (ends) {
    const { outer, depth } = finish(ends);
    const joins = wallJoins(doc, wall);
    if (outer && depth > 0) {
      if (!joins.start) zones.push({ ring: box(-1, depth, -h, h), layer: outer });
      if (!joins.end) zones.push({ ring: box(len - depth, len + 1, -h, h), layer: outer });
    }
  }
  if (inserts) {
    // The exterior is on the left of the wall's direction (+v).
    const sides: ["exterior" | "interior", number, number][] = [];
    if (inserts === "exterior" || inserts === "both") sides.push(["exterior", 0, h]);
    if (inserts === "interior" || inserts === "both") sides.push(["interior", -h, 0]);
    for (const c of wallCuts(doc, wall)) {
      if (cutZ <= c.z0 || cutZ >= c.z1) continue;
      for (const [side, v0, v1] of sides) {
        const { outer, depth } = finish(side);
        if (!outer || depth <= 0) continue;
        zones.push({ ring: box(c.u0 - depth, c.u0 + 1, v0, v1), layer: outer });
        zones.push({ ring: box(c.u1 - 1, c.u1 + depth, v0, v1), layer: outer });
      }
    }
  }
  if (!zones.length) return regions;
  const ring = (l: Vec2[]): Ring => [...l.map((q): [number, number] => [q.x, q.y]), [l[0]!.x, l[0]!.y]];
  const toLoops = (mp: Polygon[]) => mp.flatMap((poly) => poly.slice(0, 1).map((r) => r.slice(0, -1).map(([x, y]) => ({ x, y }))));
  const out: Region[] = [];
  for (const r of regions) {
    out.push(...toLoops(polygonClipping.difference([ring(r.loop)], ...zones.map((z) => [z.ring]))).map((loop) => ({ ...r, loop })));
  }
  // The strips: whatever of the wall lies in them, in the wrapping material (earlier strips win
  // overlaps). Region by region rather than through their union, which arc bands' shared faces upset.
  let taken: Polygon[] = [];
  for (const z of zones) {
    const pieces: Vec2[][] = [];
    for (const r of regions) {
      let strip = polygonClipping.intersection([ring(r.loop)], [z.ring]);
      if (taken.length && strip.length) strip = polygonClipping.difference(strip, ...taken);
      pieces.push(...toLoops(strip));
    }
    // One strip, without lines between the layers it crossed (pieces if they won't merge).
    let merged = pieces;
    try {
      merged = pieces.length > 1 ? unionLoops(pieces) : pieces;
    } catch {
      merged = pieces;
    }
    for (const loop of merged) out.push({ loop, materialId: z.layer.materialId ?? undefined, priority: PRIORITY[z.layer.function] });
    taken = [...taken, [z.ring]];
  }
  return out;
}

/**
 * A wall's own coordinates: `u` along its location line (arc length on arcs) from the start, `v`
 * to its left (the exterior). `box` is the region between two u's and two v's (following the arc).
 */
export function wallFrame(wall: Wall): {
  length: number;
  at: (u: number, v: number) => [number, number];
  box: (u0: number, u1: number, v0: number, v1: number) => Ring;
} {
  const { start, end, curve } = wall.params;
  const a = curve ? arcInfo(start, end, curve) : null;
  const length = arcLength(start, end, curve);
  if (!a) {
    const d = wallDirection(wall);
    const at = (u: number, v: number): [number, number] => [start.x + d.x * u - d.y * v, start.y + d.y * u + d.x * v];
    return { length, at, box: (u0, u1, v0, v1) => [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1), at(u0, v0)] };
  }
  const s = Math.sign(a.sweep);
  // Left of travel is outwards on a clockwise arc, inwards on an anticlockwise one.
  const at = (u: number, v: number): [number, number] => {
    const t = a.a0 + (s * u) / a.radius;
    const r = a.radius - s * v;
    return [a.center.x + r * Math.cos(t), a.center.y + r * Math.sin(t)];
  };
  const box = (u0: number, u1: number, v0: number, v1: number): Ring => {
    const n = Math.max(1, Math.ceil(Math.abs(u1 - u0) / a.radius / (Math.PI / 90)));
    const us = Array.from({ length: n + 1 }, (_, i) => u0 + ((u1 - u0) * i) / n);
    const ring: Ring = [...us.map((u) => at(u, v0)), ...[...us].reverse().map((u) => at(u, v1))];
    return [...ring, ring[0]!];
  };
  return { length, at, box };
}

/** Walls that join and clean: plain layered walls (not curtain or stacked). */
function cleanable(doc: Document, wall: Wall): boolean {
  if (wall.category !== Cat.Wall || !wall.typeId) return false;
  const t = doc.get<LayeredTypeParams>(wall.typeId)?.params;
  return !!t && !t.curtain && !t.stack?.length && t.layers.length > 0;
}

/**
 * A tee stem's core runs through the through wall's finish layers to its core: the area between
 * the through wall's face and its core face, across the stem's width. Null if there's no finish.
 */
function teeExtension(doc: Document, stem: Wall, end: "start" | "end", through: Wall): Vec2[] | null {
  const type = doc.get<LayeredTypeParams>(through.typeId!)?.params;
  const layers = type?.layers ?? [];
  const first = layers.findIndex((l) => l.function === "structure");
  if (first < 0) return null;
  let last = first;
  for (let i = first; i < layers.length; i++) if (layers[i]!.function === "structure") last = i;
  const ht = wallThickness(doc, through) / 2;
  // Layer boundaries from the exterior (left) face inwards, as offsets from the location line.
  const bounds = [ht];
  for (const l of layers) bounds.push(bounds.at(-1)! - l.thickness);
  const p = wallEndPoint(stem, end);
  // The stem heads into the through wall along its end tangent (arcs too, over this short reach).
  const stemLen = arcLength(stem.params.start, stem.params.end, stem.params.curve);
  const d = tangentLine(stem, end === "start" ? 0 : stemLen).dir;
  const a = end === "start" ? d : { x: -d.x, y: -d.y };
  const arc = through.params.curve ? arcInfo(through.params.start, through.params.end, through.params.curve) : null;
  // The through wall's left normal where the stem meets it.
  let n: Vec2;
  if (arc) {
    const r = Math.hypot(p.x - arc.center.x, p.y - arc.center.y) || 1;
    const out = { x: (p.x - arc.center.x) / r, y: (p.y - arc.center.y) / r };
    n = arc.sweep > 0 ? { x: -out.x, y: -out.y } : out;
  } else {
    const u = wallDirection(through);
    n = { x: -u.y, y: u.x };
  }
  const s = n.x * a.x + n.y * a.y >= 0 ? 1 : -1;
  const faceOff = s * ht;
  const coreOff = s > 0 ? bounds[first]! : bounds[last + 1]!;
  if (Math.abs(faceOff - coreOff) < 1e-6) return null;
  const hs = wallThickness(doc, stem) / 2;
  const sn = { x: -a.y, y: a.x };
  const o = through.params.start;
  const hit = (side: number, off: number): Vec2 | null => {
    const q = { x: p.x + sn.x * hs * side, y: p.y + sn.y * hs * side };
    if (arc) {
      // Stem face q + a·t meets the circle at offset `off` (left = towards the centre when anticlockwise).
      const R = arc.radius - Math.sign(arc.sweep) * off;
      const w = { x: q.x - arc.center.x, y: q.y - arc.center.y };
      const B = w.x * a.x + w.y * a.y;
      const C = w.x * w.x + w.y * w.y - R * R;
      const disc = B * B - C;
      if (disc < 0) return null;
      const t1 = -B - Math.sqrt(disc);
      const t2 = -B + Math.sqrt(disc);
      const t = Math.abs(t1) < Math.abs(t2) ? t1 : t2;
      return { x: q.x + a.x * t, y: q.y + a.y * t };
    }
    // Stem face: p + sn·hs·side + a·t; through line: n·(X − o) = off.
    const den = n.x * a.x + n.y * a.y;
    if (Math.abs(den) < 1e-6) return null;
    const t = (off - (n.x * (q.x - o.x) + n.y * (q.y - o.y))) / den;
    return { x: q.x + a.x * t, y: q.y + a.y * t };
  };
  const pts = [hit(1, faceOff), hit(-1, faceOff), hit(-1, coreOff), hit(1, coreOff)];
  return pts.every(Boolean) ? (pts as Vec2[]) : null;
}

/** Location lines that cross inside both walls (an X crossing, not a join at an end). */
function crossing(a: Wall, b: Wall): boolean {
  if (a.params.curve || b.params.curve) {
    const pa = arcPoints(a.params.start, a.params.end, a.params.curve, Math.PI / 180);
    const pb = arcPoints(b.params.start, b.params.end, b.params.curve, Math.PI / 180);
    const near = (q: Vec2, w: Wall) => Math.hypot(q.x - w.params.start.x, q.y - w.params.start.y) <= 1 || Math.hypot(q.x - w.params.end.x, q.y - w.params.end.y) <= 1;
    for (let i = 0; i + 1 < pa.length; i++) {
      for (let k = 0; k + 1 < pb.length; k++) {
        const p = pa[i]!;
        const r = { x: pa[i + 1]!.x - p.x, y: pa[i + 1]!.y - p.y };
        const q = pb[k]!;
        const s = { x: pb[k + 1]!.x - q.x, y: pb[k + 1]!.y - q.y };
        const den = r.x * s.y - r.y * s.x;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((q.x - p.x) * s.y - (q.y - p.y) * s.x) / den;
        const v = ((q.x - p.x) * r.y - (q.y - p.y) * r.x) / den;
        if (t < 0 || t > 1 || v < 0 || v > 1) continue;
        const x = { x: p.x + r.x * t, y: p.y + r.y * t };
        if (!near(x, a) && !near(x, b)) return true;
      }
    }
    return false;
  }
  const p = a.params.start;
  const r = { x: a.params.end.x - p.x, y: a.params.end.y - p.y };
  const q = b.params.start;
  const s = { x: b.params.end.x - q.x, y: b.params.end.y - q.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((q.x - p.x) * s.y - (q.y - p.y) * s.x) / den;
  const v = ((q.x - p.x) * r.y - (q.y - p.y) * r.x) / den;
  const la = Math.hypot(r.x, r.y);
  const lb = Math.hypot(s.x, s.y);
  return t * la > 1 && (1 - t) * la > 1 && v * lb > 1 && (1 - v) * lb > 1;
}

/** Where regions of two walls overlap, the lower priority one is cut back. */
function resolve(a: Item, b: Item, aWinsTies: boolean): void {
  // Each cut can split a region, so start again until nothing overlaps.
  for (let guard = 0; guard < 500; guard++) {
    let changed = false;
    outer: for (let i = 0; i < a.regions.length; i++) {
      for (let k = 0; k < b.regions.length; k++) {
        const ra = a.regions[i]!;
        const rb = b.regions[k]!;
        if (!boxesOverlap(ra.loop, rb.loop)) continue;
        const inter = polygonClipping.intersection([ring(ra.loop)], [ring(rb.loop)]);
        if (inter.reduce((s, poly) => s + Math.abs(area(open(poly[0]!))), 0) <= MIN_AREA) continue;
        const aWins = ra.priority !== rb.priority ? ra.priority < rb.priority : aWinsTies;
        const [win, lose, list, idx] = aWins ? [ra, rb, b.regions, k] : [rb, ra, a.regions, i];
        const pieces = polygonClipping
          .difference([ring(lose.loop)], [ring(win.loop)])
          .map((poly) => open(poly[0]!))
          .filter((l) => l.length >= 3 && Math.abs(area(l)) > MIN_AREA)
          .map((loop) => ({ ...lose, loop }));
        list.splice(idx, 1, ...pieces);
        changed = true;
        break outer;
      }
    }
    if (!changed) return;
  }
}

/** Remove the parts of `segs` that lie along any of `others`. */
export function subtractCoincident(segs: number[], others: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < segs.length; i += 4) {
    const x0 = segs[i]!;
    const y0 = segs[i + 1]!;
    const dx = segs[i + 2]! - x0;
    const dy = segs[i + 3]! - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const ux = dx / len;
    const uy = dy / len;
    const cut: [number, number][] = [];
    for (let k = 0; k < others.length; k += 4) {
      const ax = others[k]! - x0;
      const ay = others[k + 1]! - y0;
      const bx = others[k + 2]! - x0;
      const by = others[k + 3]! - y0;
      if (Math.abs(ax * uy - ay * ux) > TOL || Math.abs(bx * uy - by * ux) > TOL) continue;
      const t0 = ax * ux + ay * uy;
      const t1 = bx * ux + by * uy;
      const lo = Math.max(0, Math.min(t0, t1));
      const hi = Math.min(len, Math.max(t0, t1));
      if (hi - lo > TOL) cut.push([lo, hi]);
    }
    cut.sort((p, q) => p[0] - q[0]);
    let t = 0;
    const keep = (lo: number, hi: number) => {
      if (hi - lo > TOL) out.push(x0 + ux * lo, y0 + uy * lo, x0 + ux * hi, y0 + uy * hi);
    };
    for (const [lo, hi] of cut) {
      keep(t, lo);
      t = Math.max(t, hi);
    }
    keep(t, len);
  }
  return out;
}

function loopSegments(loops: Vec2[][]): number[] {
  const seg: number[] = [];
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      seg.push(a.x, a.y, b.x, b.y);
    }
  }
  return seg;
}

function unionLoops(loops: Vec2[][]): Vec2[][] {
  const polys: Polygon[] = loops.filter((l) => l.length >= 3).map((l) => [ring(l)]);
  if (!polys.length) return [];
  return polygonClipping
    .union(polys[0]!, ...polys.slice(1))
    .flatMap((poly) => poly.map(open))
    .filter((l) => l.length >= 3);
}

function ring(l: Vec2[]): Ring {
  return [...l.map((p): [number, number] => [p.x, p.y]), [l[0]!.x, l[0]!.y]];
}

function open(r: Ring): Vec2[] {
  const pts = r.map(([x, y]) => ({ x, y }));
  const f = pts[0];
  const l = pts.at(-1);
  if (f && l && f.x === l.x && f.y === l.y) pts.pop();
  return pts;
}

function boxesOverlap(a: Vec2[], b: Vec2[]): boolean {
  const box = (l: Vec2[]): [number, number, number, number] => [
    Math.min(...l.map((p) => p.x)),
    Math.min(...l.map((p) => p.y)),
    Math.max(...l.map((p) => p.x)),
    Math.max(...l.map((p) => p.y)),
  ];
  const [a0, a1, a2, a3] = box(a);
  const [b0, b1, b2, b3] = box(b);
  return a0 < b2 && b0 < a2 && a1 < b3 && b1 < a3;
}

const area = (l: Vec2[]) => l.reduce((s, p, i) => s + p.x * l[(i + 1) % l.length]!.y - l[(i + 1) % l.length]!.x * p.y, 0) / 2;
