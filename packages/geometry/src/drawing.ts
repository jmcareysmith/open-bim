import {
  Cat,
  annotationView,
  effectiveGraphics,
  elementGraphics,
  elementMaterial,
  isDrawingView,
  isPlanView,
  viewCrop,
  viewFrame,
  viewRange,
  type Document,
  type Element,
  type ElementId,
  type MaterialParams,
  type Vec2,
  type View,
  type ViewFrame,
  type ViewParams,
  planLevelOf,
  type LinePattern,
  type PatternName,
  type ResolvedGraphics,
  type ResolvedLine,
  graphicsCategory,
  MASS_CATEGORY,
  penWidth,
} from "@open-bim/core";
import { GRID_BUBBLE_RADIUS, type LineData } from "./datums.ts";
import { planLinework, type PlanLinework } from "./hlr.ts";
import type { GeometryKernel } from "./kernel.ts";
import { planFrame } from "./layers.ts";
import { cleanCuts } from "./wallcleanup.ts";
import { ductPlanLevel, isRunCategory } from "./ducts.ts";
import { hatch, patternFamilies } from "./patterns.ts";
import { sectionAnnotations, sectionLinework, type Rect } from "./sections.ts";

// A view as 2D vector primitives (mm, in the view's own drawing coordinates). Used for sheets and
// PDF export; strokes carry a semantic `kind` so each output picks its own colours and line weights.

export type StrokeKind = "cut" | "beyond" | "hatch" | "surface" | "annotation" | "datum" | "symbol";

export interface Stroke {
  kind: StrokeKind;
  /** [x0, y0, x1, y1, …] */
  segments: number[];
  /** V/G colour override, 0xRRGGBB. */
  color?: number;
  halftone?: boolean;
  dashed?: boolean;
  /** Override Graphics: pen weight (1-16) and line pattern. */
  weight?: number;
  /** Paper width, mm (the pen at the view's scale, from Object Styles / overrides). */
  width?: number;
  pattern?: LinePattern;
  /** Element this came from, for picking. */
  id?: ElementId;
}

export interface Fill {
  kind: "poche" | "solid" | "region";
  loops: Vec2[][];
  color?: number;
  id?: ElementId;
}

export interface Text {
  text: string;
  x: number;
  y: number;
  /** Text height, mm. */
  size: number;
  align: "center" | "left";
}

export interface Drawing {
  strokes: Stroke[];
  fills: Fill[];
  texts: Text[];
  bounds: Rect;
}

/** Plan symbols drawn instead of cut/projection (like Revit door and window families). */
const SYMBOLIC = new Set<string>([Cat.Door, Cat.Window]);
/** Line work that only makes sense in 3D. */
const NOT_ON_DRAWINGS = new Set<string>([Cat.WallOpening]);

export function emptyDrawing(): Drawing {
  return { strokes: [], fills: [], texts: [], bounds: { min: { x: Infinity, y: Infinity }, max: { x: -Infinity, y: -Infinity } } };
}

/** 2D drawing of a plan, callout, section or elevation. */
export function viewDrawing(doc: Document, kernel: GeometryKernel, view: View): Drawing {
  const g = effectiveGraphics(doc, view);
  const shown = (el: Element) => {
    if (el.category === Cat.View && el.id === view.id) return false; // a view doesn't show its own marker
    if (graphicsCategory(doc, el) === MASS_CATEGORY) return false; // masses are a design aid, not drawn
    const owner = annotationView(el);
    if (owner && owner !== view.id) return false;
    // Rooms and separators: only in plans of their level.
    const lvl = planLevelOf(el);
    if (lvl && (!isPlanView(view) || view.params.kind === "areaPlan" || (view.params as ViewParams).levelId !== lvl)) return false;
    return elementGraphics(doc, g, el).visible;
  };
  const els = doc.all().filter(shown);
  const out = emptyDrawing();
  const section = isDrawingView(view);
  if (view.params.kind === "legend") {
    // Legends hold no model: only their own annotation and legend components.
    for (const el of els.filter((e) => annotationView(e) === view.id)) {
      const lines = kernel.buildLines(doc, el, g.scale, g.detailLevel);
      const r = elementGraphics(doc, g, el);
      if (lines) addLineData(out, lines, "annotation", { color: r.color ?? undefined, halftone: r.halftone, id: el.id });
    }
    out.bounds = contentBounds(out);
    return out;
  }
  if (!section && !isPlanView(view)) return out;

  // Solids: cut + hidden-line projection, with layers and patterns at medium/fine.
  const items = els
    .filter((el) => section || !SYMBOLIC.has(el.category))
    // Coarse plans draw ducts, pipes, trays and conduit single-line (their symbols, not their solids).
    .filter((el) => section || g.detailLevel !== "coarse" || !isRunCategory(el.category))
    .flatMap((el) => {
      const mesh = kernel.build(doc, el);
      if (!mesh) return [];
      const m = elementMaterial(doc, el);
      return [{ id: el.id, mesh, surface: m ? patternFamilies(m.params.surfacePattern, g.scale) : null }];
    });
  const range = section ? null : viewRange(doc, view);
  const linework: PlanLinework[] = section ? sectionLinework(items, view) : planLinework(items, range!);
  const frame = section ? viewFrame(view) : planFrame(range!.cut);
  const lw = lineworkDrawing(doc, (el) => elementGraphics(doc, g, el), linework, frame, { detailed: g.detailLevel !== "coarse", plan: !section, scale: g.scale });
  out.strokes.push(...lw.strokes);
  out.fills.push(...lw.fills);

  // Line work: datums, plan symbols, view markers, annotations.
  const lineEls = els.filter((el) => !NOT_ON_DRAWINGS.has(el.category));
  for (const el of lineEls) {
    const owner = annotationView(el);
    if (section && !owner) continue; // sections draw their own level/grid annotations below
    const lines = kernel.buildLines(doc, el, g.scale, g.detailLevel);
    if (!lines) continue;
    if (lines.planOnly && section) continue;
    // Beam symbols belong to plans of the beam's level.
    if (el.category === Cat.Beam && (view.params as ViewParams).levelId !== (el.params as { levelId?: string }).levelId) continue;
    // So do duct outlines.
    const ductLevel = ductPlanLevel(doc, el);
    if (ductLevel && (view.params as ViewParams).levelId !== ductLevel) continue;
    const r = elementGraphics(doc, g, el);
    addLineData(out, lines, owner ? "annotation" : el.category === Cat.Grid || el.category === Cat.ReferencePlane ? "datum" : "symbol", lineStyle(r, r.projection, el.id, g.scale));
  }
  if (section) addLineData(out, sectionAnnotations(doc, view), "datum", {});

  // Bounds: the view's crop when it has one, else everything drawn.
  const crop = section ? viewCrop(view) : (view.params as ViewParams).crop;
  out.bounds = crop ? { min: { ...crop.min }, max: { ...crop.max } } : contentBounds(out);
  if (section) {
    // Leave room for level heads to the right and grid bubbles above.
    out.bounds.max.x += 3000;
    out.bounds.max.y += 1000;
  }
  if (crop && !section) clipDrawing(out, crop);
  return out;
}

/**
 * Cut and projection line work as drawing primitives, each tagged with its element: wall joins
 * cleaned up (plans), cuts split into layers with their materials' cut patterns (medium/fine) or
 * pochéd (coarse), then projection, surface pattern and heavy cut outlines. Shared by sheets/PDF
 * (`viewDrawing`) and the interactive viewport, so both draw a view the same way.
 */
export function lineworkDrawing(
  doc: Document,
  graphics: (el: Element) => ResolvedGraphics,
  linework: PlanLinework[],
  frame: ViewFrame,
  opts: { detailed: boolean; plan: boolean; scale: number },
): Pick<Drawing, "strokes" | "fills"> {
  const out: Pick<Drawing, "strokes" | "fills"> = { strokes: [], fills: [] };
  const g = { scale: opts.scale };
  const detailed = opts.detailed;
  // Cuts with wall joins cleaned up (plans): layers run through by priority, joint lines drop.
  const cuts = cleanCuts(doc, linework, frame, detailed, opts.plan);
  for (const lw of linework) {
    const el = doc.get(lw.id);
    if (!el) continue;
    const cc = cuts.get(lw.id) ?? { loops: lw.cutLoops, lines: loopSegments(lw.cutLoops), regions: null };
    const r = graphics(el);
    const proj = lineStyle(r, r.projection, lw.id, g.scale);
    const cut = lineStyle(r, r.cut, lw.id, g.scale);
    // Layer boundaries inside a cut are fine lines (Revit's common edges), not the heavy cut pen.
    const layerLine = { ...cut, weight: proj.weight, width: proj.width };
    const fg = r.cutFill.foreground;
    const bg = r.cutFill.background;
    // Cut patterns: the background (a solid fill when set), then the foreground pattern.
    const cutFill = (loops: Vec2[][], materialPattern: string | null, kind: Fill["kind"]) => {
      if (bg.visible && bg.pattern === "solid") out.fills.push({ kind: "solid", loops, ...(bg.color !== null ? { color: bg.color } : {}), id: lw.id });
      if (!fg.visible) return;
      const pattern = fg.pattern ?? materialPattern;
      if (pattern === "solid" || (pattern === null && kind === "poche")) {
        out.fills.push({ kind: pattern === "solid" ? "solid" : "poche", loops, ...(fg.color !== null ? { color: fg.color } : {}), id: lw.id });
        return;
      }
      const fam = pattern ? patternFamilies(pattern as PatternName, g.scale) : null;
      if (fam) out.strokes.push({ kind: "hatch", segments: hatch(loops, fam), ...proj, width: penWidth(1, g.scale), ...(fg.color !== null ? { color: fg.color } : {}) });
    };
    if (detailed) {
      for (const reg of cc.regions ?? []) {
        const m = reg.materialId ? doc.get<MaterialParams>(reg.materialId) : undefined;
        cutFill([reg.loop], m?.params.cutPattern ?? "diagonal", "solid");
        if (reg.lines.length) out.strokes.push({ kind: "beyond", segments: reg.lines, ...layerLine });
      }
    } else if (cc.loops.length) {
      cutFill(cc.loops, null, "poche");
    }
    if (lw.projection.length) out.strokes.push({ kind: "beyond", segments: lw.projection, ...proj });
    const sf = r.surface.foreground;
    if (lw.surface.length && sf.visible) out.strokes.push({ kind: "surface", segments: lw.surface, ...proj, width: penWidth(1, g.scale), ...(sf.color !== null ? { color: sf.color } : {}) });
    if (cc.lines.length) out.strokes.push({ kind: "cut", segments: cc.lines, ...cut });
  }

  return out;
}

export function addLineData(out: Drawing, lines: LineData, kind: StrokeKind, style: Omit<Stroke, "kind" | "segments">): void {
  const seg: number[] = [];
  for (let i = 0; i < lines.segments.length; i += 6) seg.push(lines.segments[i]!, lines.segments[i + 1]!, lines.segments[i + 3]!, lines.segments[i + 4]!);
  if (seg.length) out.strokes.push({ kind, segments: seg, ...style, ...(lines.dashed ? { dashed: true } : {}) });
  if (lines.fill) out.fills.push({ kind: "region", loops: lines.fill.loops, color: lines.fill.color, ...(style.id ? { id: style.id } : {}) });
  for (const l of lines.labels) {
    out.texts.push({
      text: l.text,
      x: l.position[0],
      y: l.position[1],
      size: l.size ?? GRID_BUBBLE_RADIUS * 0.75,
      align: l.align ?? "center",
    });
  }
}

export function loopSegments(loops: Vec2[][]): number[] {
  const seg: number[] = [];
  for (const loop of loops) {
    loop.forEach((a, i) => {
      const b = loop[(i + 1) % loop.length]!;
      seg.push(a.x, a.y, b.x, b.y);
    });
  }
  return seg;
}

export function contentBounds(d: Drawing): Rect {
  const b = { min: { x: Infinity, y: Infinity }, max: { x: -Infinity, y: -Infinity } };
  const add = (x: number, y: number) => {
    b.min.x = Math.min(b.min.x, x);
    b.min.y = Math.min(b.min.y, y);
    b.max.x = Math.max(b.max.x, x);
    b.max.y = Math.max(b.max.y, y);
  };
  for (const s of d.strokes) for (let i = 0; i < s.segments.length; i += 2) add(s.segments[i]!, s.segments[i + 1]!);
  for (const f of d.fills) for (const l of f.loops) for (const p of l) add(p.x, p.y);
  for (const t of d.texts) add(t.x, t.y);
  if (!Number.isFinite(b.min.x)) return { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } };
  return b;
}

/** Keep only what lies inside a crop rectangle (strokes clipped; fills and texts by position). */
function clipDrawing(d: Drawing, r: Rect): void {
  for (const s of d.strokes) {
    const out: number[] = [];
    for (let i = 0; i < s.segments.length; i += 4) {
      const c = clipSeg(s.segments[i]!, s.segments[i + 1]!, s.segments[i + 2]!, s.segments[i + 3]!, r);
      if (c) out.push(...c);
    }
    s.segments = out;
  }
  d.fills = d.fills.filter((f) => f.loops.some((l) => l.some((p) => inside(p, r))));
  d.texts = d.texts.filter((t) => inside(t, r));
}

const inside = (p: { x: number; y: number }, r: Rect) => p.x >= r.min.x && p.x <= r.max.x && p.y >= r.min.y && p.y <= r.max.y;

function clipSeg(x0: number, y0: number, x1: number, y1: number, r: Rect): number[] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  for (const [p, q] of [
    [-dx, x0 - r.min.x],
    [dx, r.max.x - x0],
    [-dy, y0 - r.min.y],
    [dy, r.max.y - y0],
  ] as const) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1];
}

/** Map a drawing through x' = a·x + bx, y' = a·y + by (uniform scale + offset). */
export function transformDrawing(d: Drawing, a: number, bx: number, by: number): Drawing {
  const tx = (x: number) => a * x + bx;
  const ty = (y: number) => a * y + by;
  return {
    strokes: d.strokes.map((s) => ({ ...s, segments: s.segments.map((v, i) => (i % 2 ? ty(v) : tx(v))) })),
    fills: d.fills.map((f) => ({ ...f, loops: f.loops.map((l) => l.map((p) => ({ x: tx(p.x), y: ty(p.y) }))) })),
    texts: d.texts.map((t) => ({ ...t, x: tx(t.x), y: ty(t.y), size: t.size * a })),
    bounds: { min: { x: tx(d.bounds.min.x), y: ty(d.bounds.min.y) }, max: { x: tx(d.bounds.max.x), y: ty(d.bounds.max.y) } },
  };
}

/** Stroke style from resolved graphics and one of its line overrides (projection or cut). */
function lineStyle(r: ResolvedGraphics, l: ResolvedLine, id: ElementId, scale = 100): Omit<Stroke, "kind" | "segments"> {
  return {
    ...(l.weight !== null ? { width: penWidth(l.weight, scale) } : {}),
    halftone: r.halftone,
    id,
    ...(l.color !== null ? { color: l.color } : r.color !== null ? { color: r.color } : {}),
    ...(l.weight !== null ? { weight: l.weight } : {}),
    ...(l.pattern !== null && l.pattern !== "solid" ? { pattern: l.pattern } : {}),
  };
}
