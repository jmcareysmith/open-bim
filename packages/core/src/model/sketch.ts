import type { Vec2 } from "../element.ts";

// Plan sketches (floor, ceiling and later roof boundaries): closed loops that form one
// region — an outer boundary with optional holes. Revit rejects sketches with crossing
// lines or overlapping loops; so do we, with messages fit for the status bar.

export interface Region {
  /** Outer boundary, counter-clockwise. */
  boundary: Vec2[];
  /** Holes (shafts, voids), clockwise. */
  holes: Vec2[][];
}

/** Signed area, mm²; positive = counter-clockwise. */
export function polygonArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Net area of a region (boundary minus holes), mm². */
export function regionArea(r: Region): number {
  return Math.abs(polygonArea(r.boundary)) - r.holes.reduce((s, h) => s + Math.abs(polygonArea(h)), 0);
}

/** Even-odd ray cast. Points exactly on an edge may go either way. */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function onSegment(p: Vec2, a: Vec2, b: Vec2): boolean {
  return Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y);
}

/** True if segments ab and cd touch or cross. */
export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (
    (d1 === 0 && onSegment(a, c, d)) ||
    (d2 === 0 && onSegment(b, c, d)) ||
    (d3 === 0 && onSegment(c, a, b)) ||
    (d4 === 0 && onSegment(d, a, b))
  );
}

/** No two non-adjacent edges touch, and adjacent edges don't fold back over each other. */
export function isSimplePolygon(poly: Vec2[]): boolean {
  const n = poly.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    if (a.x === b.x && a.y === b.y) return false;
    for (let j = i + 1; j < n; j++) {
      const c = poly[j]!;
      const d = poly[(j + 1) % n]!;
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (!adjacent) {
        if (segmentsIntersect(a, b, c, d)) return false;
      } else {
        // Shared vertex is fine; collinear overlap (a spike) is not.
        const shared = j === i + 1 ? b : a;
        const other1 = j === i + 1 ? a : b;
        const other2 = j === i + 1 ? d : c;
        if (cross(shared, other1, other2) === 0 && (other1.x - shared.x) * (other2.x - shared.x) + (other1.y - shared.y) * (other2.y - shared.y) > 0) {
          return false;
        }
      }
    }
  }
  return true;
}

function loopsTouch(p: Vec2[], q: Vec2[]): boolean {
  for (let i = 0; i < p.length; i++) {
    for (let j = 0; j < q.length; j++) {
      if (segmentsIntersect(p[i]!, p[(i + 1) % p.length]!, q[j]!, q[(j + 1) % q.length]!)) return true;
    }
  }
  return false;
}

const ccw = (poly: Vec2[]) => (polygonArea(poly) >= 0 ? poly : [...poly].reverse());
const cw = (poly: Vec2[]) => (polygonArea(poly) < 0 ? poly : [...poly].reverse());

/** Drop a repeated closing point (last == first). */
function open(loop: Vec2[]): Vec2[] {
  const a = loop[0];
  const b = loop.at(-1);
  return loop.length > 1 && a && b && a.x === b.x && a.y === b.y ? loop.slice(0, -1) : loop;
}

/**
 * Check a region and normalise winding (boundary CCW, holes CW).
 * Throws if any loop crosses itself or another, or a hole isn't inside the boundary.
 */
export function validateRegion(region: Region): Region {
  const boundary = open(region.boundary);
  const holes = region.holes.map(open);
  for (const [i, loop] of [boundary, ...holes].entries()) {
    const what = i === 0 ? "Boundary" : `Hole ${i}`;
    if (loop.length < 3) throw new Error(`${what} needs at least 3 points`);
    if (!isSimplePolygon(loop)) throw new Error(`${what} crosses itself`);
    if (Math.abs(polygonArea(loop)) < 1) throw new Error(`${what} has no area`);
  }
  holes.forEach((h, i) => {
    if (loopsTouch(h, boundary) || !pointInPolygon(h[0]!, boundary)) throw new Error(`Hole ${i + 1} must be inside the boundary`);
    holes.forEach((k, j) => {
      if (j <= i) return;
      if (loopsTouch(h, k) || pointInPolygon(h[0]!, k) || pointInPolygon(k[0]!, h)) {
        throw new Error(`Holes ${i + 1} and ${j + 1} overlap`);
      }
    });
  });
  return { boundary: ccw(boundary), holes: holes.map(cw) };
}

/** Turn sketched loops into a region: the largest loop is the boundary, the rest are holes. */
export function regionFromLoops(loops: Vec2[][]): Region {
  if (loops.length === 0) throw new Error("Sketch has no closed loops");
  const sorted = [...loops].map(open).sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)));
  return validateRegion({ boundary: sorted[0]!, holes: sorted.slice(1) });
}
