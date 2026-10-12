import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat, levels, type LevelParams } from "./architecture.ts";
import { PLAN_CUT_HEIGHT, type ViewRange } from "./views.ts";
import type { AppliedFilter, GraphicOverride } from "./graphics.ts";

// Views are elements, as in Revit: saved with the project, listed in the browser, each with its
// own range, scale, detail level and visibility. Sections, elevations and sheets build on this.

export type ViewKind = "floorPlan" | "3d" | "section" | "elevation" | "callout" | "areaPlan" | "legend";
export type DetailLevel = "coarse" | "medium" | "fine";
/** Revit's visual styles (3D views). "rendered" shows the path-traced render. */
export type VisualStyle = "wireframe" | "hiddenLine" | "shaded" | "consistent" | "realistic" | "rendered";
export const VISUAL_STYLES: { value: VisualStyle; label: string }[] = [
  { value: "wireframe", label: "Wireframe" },
  { value: "hiddenLine", label: "Hidden Line" },
  { value: "shaded", label: "Shaded" },
  { value: "consistent", label: "Consistent Colours" },
  { value: "realistic", label: "Realistic" },
  { value: "rendered", label: "Rendered" },
];

/** Revit view range, as offsets from the view's level, mm. */
export type ViewRangeOffsets = {
  /** Primary range top (things above are not shown). */
  top: number;
  /** Cut plane: elements crossing it are drawn cut. */
  cut: number;
  /** Primary range bottom. */
  bottom: number;
  /** View depth: elements down to here are drawn beyond. Must be ≤ bottom. */
  depth: number;
};

export type ViewParams = {
  kind: ViewKind;
  /** Associated level (floor plans and callouts); null otherwise. */
  levelId: ElementId | null;
  /** Plans only. */
  range: ViewRangeOffsets | null;
  /** Drawing scale denominator: 100 means 1:100. */
  scale: number;
  detailLevel: DetailLevel;
  /** Categories hidden in this view (Visibility/Graphics). */
  hiddenCategories: string[];
  /**
   * Sections and elevations: the view plane's trace in plan. The view looks to the left of
   * start -> end (Revit's section head direction); its width is the line's length.
   */
  line?: { start: Vec2; end: Vec2 } | null;
  /** Elevations: where the marker sits in plan (default: the line's midpoint). */
  marker?: Vec2 | null;
  /** Sections/elevations: how far beyond the line the view sees, mm. */
  farClip?: number | null;
  /** Sections/elevations: absolute Z crop, mm. */
  zRange?: { bottom: number; top: number } | null;
  /** Callouts: the view they're drawn from, and the plan region they show. */
  parentId?: ElementId | null;
  crop?: { min: Vec2; max: Vec2 } | null;
  /** Visibility/Graphics overrides per category. */
  categoryOverrides?: Record<string, GraphicOverride> | null;
  /** Filters applied in this view, highest priority first. */
  filters?: AppliedFilter[] | null;
  /**
   * View template controlling this view's graphics. Not a dependency: deleting a template leaves
   * its views with their own settings rather than deleting them.
   */
  templateId?: ElementId | null;
  /** Phasing: the phase this view shows and its phase filter (default: last phase, Show All). */
  phase?: string | null;
  /** 3D views: how the model is drawn (default shaded). */
  visualStyle?: VisualStyle | null;
  phaseFilter?: "all" | "complete" | "new" | "previous" | "none" | null;
  /** Design options: which option this view shows per option set (default primary). */
  designOptions?: Record<string, string> | null;
  /** Area plans: their area scheme. */
  areaScheme?: "gross" | "rentable" | null;
};
export type View = Element<ViewParams>;

/** Revit's default floor plan view range. */
export const DEFAULT_VIEW_RANGE: ViewRangeOffsets = { top: 2300, cut: PLAN_CUT_HEIGHT, bottom: 0, depth: 0 };
export const SCALES = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000] as const;

registerCategory({
  name: Cat.View,
  dependencies: (el) => {
    const p = el.params as ViewParams;
    return [...(p.levelId ? [p.levelId] : []), ...(p.parentId ? [p.parentId] : [])];
  },
  // Deleting a level deletes its plans (Revit does the same).
  cascadeDelete: true,
  isType: false,
});

export function views(doc: Document): View[] {
  return doc.byCategory<ViewParams>(Cat.View);
}

/** View names are unique per kind ("Ground Floor" plan and "Ground Floor" ceiling plan may coexist). */
function nameInUse(doc: Document, kind: ViewKind, name: string, exceptId?: ElementId): boolean {
  return views(doc).some((v) => v.params.kind === kind && v.name === name && v.id !== exceptId);
}

function uniqueName(doc: Document, kind: ViewKind, base: string): string {
  let name = base;
  for (let i = 2; nameInUse(doc, kind, name); i++) name = `${base} (${i})`;
  return name;
}

export function validateViewRange(r: ViewRangeOffsets): void {
  if (!(r.bottom <= r.cut && r.cut <= r.top)) throw new Error("View range must satisfy bottom ≤ cut plane ≤ top");
  if (r.depth > r.bottom) throw new Error("View depth can't be above the bottom of the view range");
}

export function createFloorPlan(
  tx: Transaction,
  doc: Document,
  levelId: ElementId,
  opts: { name?: string; range?: ViewRangeOffsets; scale?: number } = {},
): View {
  const level = doc.require<LevelParams>(levelId);
  if (level.category !== Cat.Level) throw new Error("Floor plans belong to a level");
  const range = opts.range ?? DEFAULT_VIEW_RANGE;
  validateViewRange(range);
  const name = opts.name ?? uniqueName(doc, "floorPlan", level.name ?? "Level");
  if (nameInUse(doc, "floorPlan", name)) throw new Error(`A floor plan called "${name}" already exists`);
  return tx.create<ViewParams>(
    Cat.View,
    { kind: "floorPlan", levelId, range, scale: opts.scale ?? 100, detailLevel: "coarse", hiddenCategories: [] },
    { name },
  );
}

export function create3DView(tx: Transaction, doc: Document, name = "{3D}"): View {
  if (nameInUse(doc, "3d", name)) throw new Error(`A 3D view called "${name}" already exists`);
  return tx.create<ViewParams>(
    Cat.View,
    { kind: "3d", levelId: null, range: null, scale: 100, detailLevel: "medium", hiddenCategories: [] },
    { name },
  );
}

export function renameView(tx: Transaction, doc: Document, id: ElementId, name: string): void {
  const v = doc.require<ViewParams>(id);
  if (!name) throw new Error("Views need a name");
  if (nameInUse(doc, v.params.kind, name, id)) throw new Error(`Another view is already called "${name}"`);
  tx.setName(id, name);
}

/** Absolute Z range a plan view shows: from its view depth up to its cut plane. */
export function viewRange(doc: Document, view: View): ViewRange {
  const p = view.params;
  if (!isPlanView(view) || !p.levelId || !p.range) throw new Error("Only plan views have a view range");
  const elevation = doc.require<LevelParams>(p.levelId).params.elevation;
  return { bottom: elevation + Math.min(p.range.bottom, p.range.depth), cut: elevation + p.range.cut };
}

export function floorPlanFor(doc: Document, levelId: ElementId): View | undefined {
  return views(doc).find((v) => v.params.kind === "floorPlan" && v.params.levelId === levelId);
}

/** Give every level a floor plan and the project a 3D view (for files saved before views existed). */
export function ensureDefaultViews(tx: Transaction, doc: Document): View[] {
  const created: View[] = [];
  for (const l of levels(doc)) if (!floorPlanFor(doc, l.id)) created.push(createFloorPlan(tx, doc, l.id));
  if (!views(doc).some((v) => v.params.kind === "3d")) created.push(create3DView(tx, doc));
  return created;
}

export function isViewVisible(view: View, category: string): boolean {
  return !view.params.hiddenCategories.includes(category);
}

// ---- sections, elevations, callouts -------------------------------------------

type LineViewOpts = { name?: string; farClip?: number; zRange?: { bottom: number; top: number }; scale?: number };

/** Default vertical crop for a new section/elevation: lowest level - 1 m to highest level + 3 m. */
function defaultZRange(doc: Document): { bottom: number; top: number } {
  const ls = levels(doc);
  const lo = ls[0]?.params.elevation ?? 0;
  const hi = ls.at(-1)?.params.elevation ?? 3000;
  return { bottom: lo - 1000, top: hi + 3000 };
}

function uniqueNumbered(doc: Document, kind: ViewKind, base: string): string {
  let i = 1;
  while (nameInUse(doc, kind, `${base} ${i}`)) i++;
  return `${base} ${i}`;
}

function createLineView(tx: Transaction, doc: Document, kind: "section" | "elevation", start: Vec2, end: Vec2, opts: LineViewOpts): View {
  if (Math.hypot(end.x - start.x, end.y - start.y) < 100) throw new Error(`A ${kind} line must be at least 100 mm long`);
  const farClip = opts.farClip ?? 10_000;
  if (!(farClip > 0)) throw new Error("Far clip must be positive");
  const zRange = opts.zRange ?? defaultZRange(doc);
  if (!(zRange.top > zRange.bottom)) throw new Error("Crop top must be above crop bottom");
  const name = opts.name ?? uniqueNumbered(doc, kind, kind === "section" ? "Section" : "Elevation");
  if (nameInUse(doc, kind, name)) throw new Error(`Another ${kind} is already called "${name}"`);
  return tx.create<ViewParams>(
    Cat.View,
    {
      kind,
      levelId: null,
      range: null,
      scale: opts.scale ?? 100,
      detailLevel: "medium",
      hiddenCategories: [],
      line: { start, end },
      farClip,
      zRange,
      parentId: null,
      crop: null,
    },
    { name },
  );
}

/** Section looking to the left of start -> end. */
export function createSection(tx: Transaction, doc: Document, start: Vec2, end: Vec2, opts: LineViewOpts = {}): View {
  return createLineView(tx, doc, "section", start, end, opts);
}

export function createElevation(tx: Transaction, doc: Document, start: Vec2, end: Vec2, opts: LineViewOpts = {}): View {
  return createLineView(tx, doc, "elevation", start, end, opts);
}

/**
 * South, East, North and West elevations around a plan rectangle (usually the model extents),
 * each `offset` outside it and looking back at it. Existing names are skipped.
 */
export function createBuildingElevations(tx: Transaction, doc: Document, min: Vec2, max: Vec2, offset = 3000): View[] {
  const depth = Math.max(max.x - min.x, max.y - min.y) + 2 * offset;
  const m = 1000; // views extend a little past the building
  const specs: [string, Vec2, Vec2][] = [
    // Each line runs so the building is on its left.
    ["South", { x: min.x - m, y: min.y - offset }, { x: max.x + m, y: min.y - offset }],
    ["East", { x: max.x + offset, y: min.y - m }, { x: max.x + offset, y: max.y + m }],
    ["North", { x: max.x + m, y: max.y + offset }, { x: min.x - m, y: max.y + offset }],
    ["West", { x: min.x - offset, y: max.y + m }, { x: min.x - offset, y: min.y - m }],
  ];
  return specs
    .filter(([name]) => !nameInUse(doc, "elevation", name))
    .map(([name, a, b]) => createElevation(tx, doc, a, b, { name, farClip: depth }));
}

/**
 * One elevation placed at `at` (Revit's Elevation tool): it looks squarely at the nearest wall and
 * spans the whole model across its view, seeing a little past the far side.
 */
export function createElevationAt(tx: Transaction, doc: Document, at: Vec2, opts: { name?: string } = {}): View {
  const walls = doc.byCategory<{ start: Vec2; end: Vec2 }>(Cat.Wall);
  if (!walls.length) throw new Error("Draw some walls first: an elevation looks at the nearest one");
  let best: { d: number; look: Vec2 } | null = null;
  for (const w of walls) {
    const { start: a, end: b } = w.params;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1) continue;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const t = Math.max(0, Math.min(len, (at.x - a.x) * u.x + (at.y - a.y) * u.y));
    const q = { x: a.x + u.x * t, y: a.y + u.y * t };
    const d = Math.hypot(q.x - at.x, q.y - at.y);
    if (best && d >= best.d) continue;
    // Look square to the wall, towards it.
    const n = { x: -u.y, y: u.x };
    const side = (q.x - at.x) * n.x + (q.y - at.y) * n.y;
    best = { d, look: side >= 0 ? n : { x: -n.x, y: -n.y } };
  }
  if (!best) throw new Error("Draw some walls first: an elevation looks at the nearest one");
  const look = best.look;
  // The view looks to the left of its line, so the line runs with `look` on its left.
  const dir = { x: look.y, y: -look.x };
  const pts = walls.flatMap((w) => [w.params.start, w.params.end]);
  const across = pts.map((p) => (p.x - at.x) * dir.x + (p.y - at.y) * dir.y);
  const deep = pts.map((p) => (p.x - at.x) * look.x + (p.y - at.y) * look.y);
  const m = 1000;
  const lo = Math.min(...across) - m;
  const hi = Math.max(...across) + m;
  let name = opts.name;
  for (let i = 1; !name || nameInUse(doc, "elevation", name); i++) name = `Elevation ${i}`;
  const v = createElevation(tx, doc, { x: at.x + dir.x * lo, y: at.y + dir.y * lo }, { x: at.x + dir.x * hi, y: at.y + dir.y * hi }, {
    name,
    farClip: Math.max(1000, Math.max(...deep) + 3000),
  });
  tx.update<ViewParams>(v.id, { marker: { ...at } });
  return doc.require<ViewParams>(v.id) as View;
}

/** Callout: a cropped plan region of a floor plan, usually at a larger scale. */
export function createCallout(
  tx: Transaction,
  doc: Document,
  parentId: ElementId,
  a: Vec2,
  b: Vec2,
  opts: { name?: string; scale?: number } = {},
): View {
  const parent = doc.require<ViewParams>(parentId);
  if (parent.category !== Cat.View || parent.params.kind !== "floorPlan") throw new Error("Callouts are drawn on floor plans");
  const min = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) };
  const max = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) };
  if (max.x - min.x < 100 || max.y - min.y < 100) throw new Error("Callout must be at least 100 mm each way");
  const name = opts.name ?? uniqueNumbered(doc, "callout", `Callout of ${parent.name ?? "plan"}`);
  if (nameInUse(doc, "callout", name)) throw new Error(`Another callout is already called "${name}"`);
  return tx.create<ViewParams>(
    Cat.View,
    {
      kind: "callout",
      levelId: parent.params.levelId,
      range: parent.params.range,
      scale: opts.scale ?? 20,
      detailLevel: "fine",
      hiddenCategories: [...parent.params.hiddenCategories],
      line: null,
      farClip: null,
      zRange: null,
      parentId,
      crop: { min, max },
    },
    { name },
  );
}

type V3 = [number, number, number];

/** Orthonormal view frame: drawing x = right, drawing y = up, `dir` points into the view. */
export interface ViewFrame {
  origin: V3;
  right: V3;
  up: V3;
  dir: V3;
}

/** Frame of a section/elevation: origin at the line start, right along it, looking to its left. */
export function viewFrame(view: View): ViewFrame {
  const line = view.params.line;
  if (!line) throw new Error("Only sections and elevations have a view frame");
  const dx = line.end.x - line.start.x;
  const dy = line.end.y - line.start.y;
  const l = Math.hypot(dx, dy);
  return { origin: [line.start.x, line.start.y, 0], right: [dx / l, dy / l, 0], up: [0, 0, 1], dir: [-dy / l, dx / l, 0] };
}

/** World point -> view coordinates: [x along the view, y up, depth towards the viewer (<= 0 is beyond the cut)]. */
export function toViewCoords(f: ViewFrame, p: V3): V3 {
  const d = [p[0] - f.origin[0], p[1] - f.origin[1], p[2] - f.origin[2]];
  const dot = (v: V3) => d[0]! * v[0] + d[1]! * v[1] + d[2]! * v[2];
  return [dot(f.right), dot(f.up), -dot(f.dir)];
}

/** Drawing-space crop of a section/elevation: x across the line, y = absolute Z. */
export function viewCrop(view: View): { min: Vec2; max: Vec2 } {
  const { line, zRange } = view.params;
  if (!line || !zRange) throw new Error("Only sections and elevations have a drawing crop");
  const w = Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y);
  return { min: { x: 0, y: zRange.bottom }, max: { x: w, y: zRange.top } };
}

/** Views drawn in their own 2D space rather than plan XY: sections, elevations and legends. */
export function is2DView(view: View): boolean {
  return isDrawingView(view) || view.params.kind === "legend";
}

/** Views drawn in their own 2D space (sections and elevations). */
export function isDrawingView(view: View): boolean {
  return view.params.kind === "section" || view.params.kind === "elevation";
}

/** Views drawn as plans (floor plans, callouts and area plans). */
export function isPlanView(view: View): boolean {
  return view.params.kind === "floorPlan" || view.params.kind === "callout" || view.params.kind === "areaPlan";
}
