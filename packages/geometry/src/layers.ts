import polygonClipping from "polygon-clipping";
import {
  Cat,
  ceilingExtent,
  floorExtent,
  floorTopPlane,
  layerMaterial,
  wallDirection,
  wallThickness,
  type Ceiling,
  type Document,
  type Element,
  type ElementId,
  type Floor,
  type LayeredTypeParams,
  type LayerFunction,
  type Vec2,
  type ViewFrame,
  type Wall,
  arcInfo,
} from "@open-bim/core";

// Split an element's cut regions into its type's layers, so each layer can be drawn with its
// material's cut pattern. Layer boundaries are planes in the model; mapped into a view they become
// lines in the drawing, so the same code serves plans and sections.

export interface LayerRegion {
  loop: Vec2[];
  materialId: ElementId | undefined;
  /** The layer's function (sets which layer wins where joined walls overlap). */
  function?: LayerFunction;
}

/** Plan view frame: drawing = model XY, cut at height `cut`. */
export function planFrame(cut: number): ViewFrame {
  return { origin: [0, 0, cut], right: [1, 0, 0], up: [0, 1, 0], dir: [0, 0, -1] };
}

/** A plane n·X = c in the model and the material on its positive side, per layer boundary. */
interface Slab {
  n: [number, number, number];
  /** Boundary positions along n, from the first layer's outer face inwards. */
  bounds: number[];
  materials: (ElementId | undefined)[];
  functions: LayerFunction[];
}

function slabs(doc: Document, el: Element): Slab | null {
  if (!el.typeId) return null;
  const type = doc.get<LayeredTypeParams>(el.typeId);
  const layers = type?.params.layers;
  if (!layers?.length) return null;
  const materials = layers.map((l) => layerMaterial(doc, l)?.id);
  const functions = layers.map((l) => l.function);
  const cum = (start: number, sign: number) => {
    const b = [start];
    for (const l of layers) b.push(b.at(-1)! + sign * l.thickness);
    return b;
  };
  switch (el.category) {
    case Cat.Wall: {
      // Exterior (first layer) is on the wall's left, as in Revit when walls are drawn clockwise.
      const w = el as Wall;
      const d = wallDirection(w);
      const n: [number, number, number] = [-d.y, d.x, 0];
      const c0 = n[0] * w.params.start.x + n[1] * w.params.start.y + wallThickness(doc, w) / 2;
      return { n, bounds: cum(c0, -1), materials, functions };
    }
    case Cat.Floor: {
      if ((el as Floor).params.slope) {
        // Sloped top z = c + gx·x + gy·y: layer planes tilt with it (thicknesses are vertical).
        const t = floorTopPlane(doc, el as Floor);
        const k = Math.hypot(t.gx, t.gy, 1);
        const ls = layers.map((l) => ({ ...l, thickness: l.thickness / k }));
        const b = [t.c / k];
        for (const l of ls) b.push(b.at(-1)! - l.thickness);
        return { n: [-t.gx / k, -t.gy / k, 1 / k], bounds: b, materials, functions };
      }
      const { top } = floorExtent(doc, el as Floor);
      return { n: [0, 0, 1], bounds: cum(top, -1), materials, functions };
    }
    case Cat.Ceiling: {
      // Ceiling layers build upwards from the underside.
      const { bottom } = ceilingExtent(doc, el as Ceiling);
      return { n: [0, 0, 1], bounds: cum(bottom, 1), materials, functions };
    }
    default:
      return null;
  }
}

/**
 * Cut loops (in drawing coords of `frame`) split into layer regions. Elements without layers, or
 * whose layer planes are parallel to the drawing, come back as one region with the first material.
 */
export function layerRegions(doc: Document, el: Element, loops: Vec2[][], frame: ViewFrame): LayerRegion[] {
  const s = slabs(doc, el);
  const firstMaterial = el.typeId
    ? (() => {
        const l = doc.get<LayeredTypeParams>(el.typeId!)?.params.layers?.[0];
        return l ? layerMaterial(doc, l)?.id : undefined;
      })()
    : undefined;
  if (!s) return loops.map((loop) => ({ loop, materialId: firstMaterial }));
  // A model point on the cut plane is origin + right·x + up·y, so n·X = n·origin + (n·right) x + (n·up) y.
  const dotv = (a: [number, number, number], b: [number, number, number]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const a = dotv(s.n, frame.right);
  const b = dotv(s.n, frame.up);
  const c = dotv(s.n, frame.origin);
  if (Math.hypot(a, b) < 1e-6) return loops.map((loop) => ({ loop, materialId: firstMaterial }));
  const value = (p: Vec2) => c + a * p.x + b * p.y;
  // Curved walls in plan: layers are bands round the arc, so measure each point's offset to the
  // wall's left (exterior) radially rather than across the chord.
  const w = el as Wall;
  const arc = el.category === Cat.Wall && w.params.curve && frame.up[1] === 1 && frame.dir[2] === -1 ? arcInfo(w.params.start, w.params.end, w.params.curve) : null;
  const out: LayerRegion[] = [];
  if (arc) {
    // Each layer is an annular sector between its two offsets (a straight-line clip would cut the
    // curved boundaries as chords), intersected with the cut loop (which carries the joined ends).
    const sign = arc.sweep > 0 ? 1 : -1; // turning left (anticlockwise): the left is towards the centre
    const c0 = s.n[0] * w.params.start.x + s.n[1] * w.params.start.y; // the location line on the bounds' scale
    const radiusAt = (b2: number) => arc.radius - sign * (b2 - c0);
    const margin = 2000 / arc.radius;
    const a0 = arc.a0 - Math.sign(arc.sweep) * margin;
    const a1 = arc.a0 + arc.sweep + Math.sign(arc.sweep) * margin;
    const n = Math.max(8, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 90)));
    const ring = (pts: Vec2[]): [number, number][] => [...pts.map((q): [number, number] => [q.x, q.y]), [pts[0]!.x, pts[0]!.y]];
    const at = (r: number, t: number): Vec2 => ({ x: arc.center.x + r * Math.cos(t), y: arc.center.y + r * Math.sin(t) });
    for (const loop of loops) {
      for (let i = 0; i < s.materials.length; i++) {
        const r0 = radiusAt(s.bounds[i]!);
        const r1 = radiusAt(s.bounds[i + 1]!);
        const band: Vec2[] = [];
        for (let k = 0; k <= n; k++) band.push(at(r0, a0 + ((a1 - a0) * k) / n));
        for (let k = n; k >= 0; k--) band.push(at(r1, a0 + ((a1 - a0) * k) / n));
        for (const poly of polygonClipping.intersection([ring(loop)], [ring(band)])) {
          const pts = poly[0]!.slice(0, -1).map(([x, y]) => ({ x, y }));
          if (pts.length >= 3 && Math.abs(area(pts)) > 1e-3) out.push({ loop: pts, materialId: s.materials[i], function: s.functions[i] });
        }
      }
    }
    return out;
  }
  for (const loop of loops) {
    for (let i = 0; i < s.materials.length; i++) {
      const hi = Math.max(s.bounds[i]!, s.bounds[i + 1]!);
      const lo = Math.min(s.bounds[i]!, s.bounds[i + 1]!);
      let poly = clipHalf(loop, (p) => hi - value(p));
      poly = clipHalf(poly, (p) => value(p) - lo);
      if (poly.length >= 3 && Math.abs(area(poly)) > 1e-3) out.push({ loop: poly, materialId: s.materials[i], function: s.functions[i] });
    }
  }
  return out;
}

function clipHalf(poly: Vec2[], f: (p: Vec2) => number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const fp = f(p);
    const fq = f(q);
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) {
      const t = fp / (fp - fq);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  }
  return out;
}

const area = (l: Vec2[]) => l.reduce((s, p, i) => s + p.x * l[(i + 1) % l.length]!.y - l[(i + 1) % l.length]!.x * p.y, 0) / 2;
