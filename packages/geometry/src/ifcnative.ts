import polygonClipping, { type Polygon } from "polygon-clipping";
import {
  Cat,
  createFloor,
  createWall,
  createWallOpening,
  type DirectShape,
  type DirectShapeParams,
  type Document,
  type ElementId,
  type LayeredTypeParams,
  type LevelParams,
  type Transaction,
  type Vec2,
} from "@open-bim/core";

// IFC import → native elements (Revit: imported IFC walls and slabs become real ones when their
// shapes allow). An imported IfcWall that's a straight box becomes a Wall (type matched by
// thickness, else a new single-layer type), an IfcSlab a Floor (outline from its top faces,
// type by thickness), and imported doors/windows sitting in a converted wall cut openings in it
// (the imported shapes stay, now visible through the opening).

const WALL_CLASSES = new Set(["IfcWall", "IfcWallStandardCase"]);
const SLAB_CLASSES = new Set(["IfcSlab"]);
const INSERT_CLASSES = new Set(["IfcDoor", "IfcWindow"]);

/** Can this imported shape become a native element? */
export function convertible(el: { category: string; params: unknown }): boolean {
  if (el.category !== Cat.DirectShape) return false;
  const c = (el.params as DirectShapeParams).ifcClass;
  return WALL_CLASSES.has(c) || SLAB_CLASSES.has(c);
}

function hull(pts: Vec2[]): Vec2[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Vec2[] = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

const polyArea = (l: Vec2[]) => Math.abs(l.reduce((s, q, i) => s + q.x * l[(i + 1) % l.length]!.y - l[(i + 1) % l.length]!.x * q.y, 0)) / 2;

/** Smallest rectangle round the points (on a hull edge): centre, long axis, length and width. */
function minRect(pts: Vec2[]): { c: Vec2; u: Vec2; len: number; wid: number; hullArea: number } | null {
  const h = hull(pts);
  if (h.length < 3) return null;
  let best: { c: Vec2; u: Vec2; len: number; wid: number } | null = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i]!;
    const b = h[(i + 1) % h.length]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l < 1e-6) continue;
    const u = { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const q of h) {
      const su = q.x * u.x + q.y * u.y;
      const sv = -q.x * u.y + q.y * u.x;
      u0 = Math.min(u0, su); u1 = Math.max(u1, su); v0 = Math.min(v0, sv); v1 = Math.max(v1, sv);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.len * best.wid) {
      const cu = (u0 + u1) / 2;
      const cv = (v0 + v1) / 2;
      const c = { x: u.x * cu - u.y * cv, y: u.y * cu + u.x * cv };
      // Long axis first.
      best = u1 - u0 >= v1 - v0 ? { c, u, len: u1 - u0, wid: v1 - v0 } : { c, u: { x: -u.y, y: u.x }, len: v1 - v0, wid: u1 - u0 };
    }
  }
  return best ? { ...best, hullArea: polyArea(h) } : null;
}

function bounds(p: DirectShapeParams) {
  const xy: Vec2[] = [];
  let z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < p.positions.length; i += 3) {
    xy.push({ x: p.positions[i]!, y: p.positions[i + 1]! });
    z0 = Math.min(z0, p.positions[i + 2]!);
    z1 = Math.max(z1, p.positions[i + 2]!);
  }
  return { xy, z0, z1 };
}

const typeThickness = (t: LayeredTypeParams) => t.layers.reduce((s, l) => s + l.thickness, 0);

/** A layered type of this category and total thickness, or a new single-layer one. */
function typeFor(tx: Transaction, doc: Document, category: string, label: string, t: number): ElementId {
  const have = doc.byCategory<LayeredTypeParams>(category).find((x) => !x.params.curtain && !x.params.stack?.length && Math.abs(typeThickness(x.params) - t) < 0.5);
  if (have) return have.id;
  const r = Math.round(t);
  return tx.create<LayeredTypeParams>(category, { layers: [{ function: "structure", material: "Imported", thickness: r }] }, { name: `${label} ${r}` }).id;
}

/** Convert imported IFC shapes to native walls and floors. Returns the new elements' ids and what was left as it was. */
export function convertDirectShapes(tx: Transaction, doc: Document, ids: ElementId[]): { created: ElementId[]; skipped: ElementId[] } {
  const created: ElementId[] = [];
  const skipped: ElementId[] = [];
  const walls: { id: ElementId; c: Vec2; u: Vec2; len: number; wid: number; base: number }[] = [];
  for (const id of ids) {
    const ds = doc.get<DirectShapeParams>(id) as DirectShape | undefined;
    if (!ds || !convertible(ds)) {
      skipped.push(id);
      continue;
    }
    const p = ds.params;
    const lvl = doc.get<LevelParams>(p.levelId)?.params.elevation ?? 0;
    const { xy, z0, z1 } = bounds(p);
    if (z1 - z0 < 1) {
      skipped.push(id);
      continue;
    }
    if (WALL_CLASSES.has(p.ifcClass)) {
      const r = minRect(xy);
      // A straight box: long and thin, and its plan fills the rectangle.
      if (!r || r.wid < 1 || r.len < r.wid || r.hullArea < 0.9 * r.len * r.wid) {
        skipped.push(id);
        continue;
      }
      const typeId = typeFor(tx, doc, Cat.WallType, "Imported Wall", r.wid);
      const start = { x: r.c.x - (r.u.x * r.len) / 2, y: r.c.y - (r.u.y * r.len) / 2 };
      const end = { x: r.c.x + (r.u.x * r.len) / 2, y: r.c.y + (r.u.y * r.len) / 2 };
      const w = createWall(tx, typeId, start, end, p.levelId, { baseOffset: z0 - lvl, height: z1 - z0 });
      walls.push({ id: w.id, c: r.c, u: r.u, len: r.len, wid: r.wid, base: z0 });
      created.push(w.id);
    } else {
      // Slab: its outline is the union of its upward faces seen in plan.
      const tris: Polygon[] = [];
      const P = p.positions;
      for (let i = 0; i < p.indices.length; i += 3) {
        const [a, b, c] = [p.indices[i]! * 3, p.indices[i + 1]! * 3, p.indices[i + 2]! * 3];
        const nz = (P[b]! - P[a]!) * (P[c + 1]! - P[a + 1]!) - (P[b + 1]! - P[a + 1]!) * (P[c]! - P[a]!);
        if (nz <= 1e-6) continue;
        tris.push([[[P[a]!, P[a + 1]!], [P[b]!, P[b + 1]!], [P[c]!, P[c + 1]!], [P[a]!, P[a + 1]!]]]);
      }
      let outline: Polygon[] = [];
      try {
        outline = tris.length ? polygonClipping.union(tris[0]!, ...tris.slice(1)) : [];
      } catch {
        outline = [];
      }
      const biggest = outline
        .map((poly) => poly.map((ring) => ring.slice(0, -1).map(([x, y]) => ({ x, y }))))
        .sort((a, b) => polyArea(b[0]!) - polyArea(a[0]!))[0];
      if (!biggest || biggest[0]!.length < 3) {
        skipped.push(id);
        continue;
      }
      const typeId = typeFor(tx, doc, Cat.FloorType, "Imported Floor", z1 - z0);
      const f = createFloor(tx, typeId, p.levelId, biggest[0]!, { offset: z1 - lvl, holes: biggest.slice(1) });
      created.push(f.id);
    }
    tx.delete(id);
  }
  // Imported doors and windows in a converted wall open it up.
  for (const ds of doc.byCategory<DirectShapeParams>(Cat.DirectShape)) {
    if (!INSERT_CLASSES.has(ds.params.ifcClass)) continue;
    const { xy, z0, z1 } = bounds(ds.params);
    for (const w of walls) {
      const us = xy.map((q) => (q.x - w.c.x) * w.u.x + (q.y - w.c.y) * w.u.y);
      const vs = xy.map((q) => -(q.x - w.c.x) * w.u.y + (q.y - w.c.y) * w.u.x);
      const mid = (Math.min(...vs) + Math.max(...vs)) / 2;
      if (Math.abs(mid) > w.wid / 2 + 100) continue;
      const u0 = Math.max(-w.len / 2, Math.min(...us));
      const u1 = Math.min(w.len / 2, Math.max(...us));
      if (u1 - u0 < 50) continue;
      try {
        created.push(createWallOpening(tx, doc, w.id, (u0 + u1) / 2 + w.len / 2, { width: u1 - u0, sillHeight: z0 - w.base, height: z1 - z0 }).id);
      } catch {
        // Doesn't fit the wall (runs past an end or over the top): leave it solid.
      }
      break;
    }
  }
  return { created, skipped };
}
