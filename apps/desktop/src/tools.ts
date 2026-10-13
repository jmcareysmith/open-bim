import type { ToolOption } from "./modifytools.ts";
import {
  boundaryFromWalls,
  PICK_WALL_LINES,
  type PickWallLine,
  Cat,
  closestPointOnDatum,
  createGrid,
  createWall,
  createCeiling,
  createFloor,
  createReferencePlane,
  createRoof,
  createSection,
  createCallout,
  createDetailLine,
  createFilledRegion,
  createTextNote,
  createDimension,
  type DimRef,
  createBlend,
  createExtrusion,
  createRevolution,
  createSweep,
  placeFamilyInstance,
  familyDocument,
  familyValues,
  viewFrame,
  type FamilyDef,
  type NumPt,
  type View,
  type WorkPlane,
  createWallOpening,
  createDoor,
  createWindow,
  doorPlacement,
  windowPlacement,
  positionAlongWall,
  wallLength,
  DEFAULT_ROOF_SLOPE,
  normaliseFootprint,
  regionFromLoops,
  formatLength,
  projectUnits,
  datumIntersection,
  datumLines,
  levels,
  nextGridName,
  type Grid,
  type DatumLine,
  type Document,
  type Element,
  type Transaction,
  type ElementId,
  type LevelParams,
  type Vec2,
  type Wall,
  type WallParams,
  totalThickness,
  type LayeredTypeParams,
  createRoom,
  createRoomSeparator,
  nextRoomNumber,
  type Room,
  createArea,
  createAreaBoundary,
  demolish,
  phases,
  viewPhase,
  createBeam,
  createColumn,
  createPadFooting,
  createStripFooting,
  ensureStructuralTypes,
  createToposolid,
  createStair,
  createExtrusionRoof,
  resolveRef,
  curtainOf,
  createSpotElevation,
  SPOT_HOSTS,
  refPoint,
  ensureStairType,
  createRamp,
  ensureRampType,
  createRailing,
  createStairRailings,
  ensureRailingType,
  levelAbove,
  type StairRun,
  groupOf,
  transformElements,
  translation,
  placeGroup,
  createRevisionCloud,
  revisionNumber,
  revisions,
  createTag,
  anchorInView,
  TAGGABLE,
  type TagKind,
  type ViewParams,
  createBuildingPad,
  createSubregion,
  createPropertyLine,
} from "@open-bim/core";
import { curtainPart, partLabel, setCurtainPart } from "./curtainpart.ts";
import { areaBoundary, buildGridLines, buildReferencePlaneLines, buildRoomLines, extrudePolygon, roomBoundary, wallFootprint, type LineData } from "@open-bim/geometry";
import type { Viewport } from "./viewport.ts";

export interface ToolContext {
  doc: Document;
  viewport: Viewport;
  activeLevelId(): ElementId;
  /** Type the placing tools use for a type category (the toolbar type selector). */
  activeTypeId(typeCategory: string): ElementId | undefined;
  selection(): ElementId[];
  setSelection(ids: ElementId[]): void;
  status(text: string): void;
  /** The view shown in the viewport (callouts are drawn on it). */
  activeViewId(): ElementId | undefined;
  /** Family editor: make new forms voids. */
  formIsVoid(): boolean;
  /** Component tool: the family and type to place (from the type selector). */
  activeComponent(): { familyId: ElementId; typeName: string } | undefined;
  /** The options strip at the top left of the view (Revit's options bar). */
  setToolOptions?(options: ToolOption[] | null): void;
}

export interface Tool {
  readonly name: string;
  activate?(): void;
  deactivate?(): void;
  pointerDown?(ev: PointerEvent): void;
  pointerMove?(ev: PointerEvent): void;
  pointerUp?(ev: PointerEvent): void;
  click?(ev: PointerEvent): void;
  /** Return true if the key was handled. */
  key?(ev: KeyboardEvent): boolean;
  /** Press-drag-release places it like two clicks (sections, grids, callouts), when true now. */
  readonly dragPlace?: boolean;
}

// ---- Select ---------------------------------------------------------------

export class SelectTool implements Tool {
  readonly name = "select";
  private dragFrom: { x: number; y: number } | null = null;
  private band: HTMLDivElement | null = null;
  /** Drag to move: pressed on a selected element. */
  private moveFrom: Vec2 | null = null;
  private moveTo: Vec2 | null = null;

  constructor(private ctx: ToolContext) {}

  activate(): void {
    this.ctx.status(
      "Select: click, or drag a box (left\u2192right = inside, right\u2192left = crossing). Shift adds. Delete removes. H/I hide/isolate.",
    );
  }

  deactivate(): void {
    this.endBand();
  }

  pointerDown(ev: PointerEvent): void {
    if (ev.button !== 0) return;
    this.dragFrom = { x: ev.clientX, y: ev.clientY };
    // Pressing on something already selected drags the selection instead of starting a box.
    const id = ev.shiftKey ? null : this.ctx.viewport.pick(ev);
    const el = id ? this.ctx.doc.get(id) : undefined;
    const sel = new Set(this.ctx.selection());
    if (el && (sel.has(el.id) || sel.has(groupOf(el) ?? ""))) {
      this.moveFrom = viewPoint(this.ctx, ev, null);
      this.moveTo = null;
    }
  }

  pointerMove(ev: PointerEvent): void {
    this.lastPointer = { clientX: ev.clientX, clientY: ev.clientY };
    if (this.moveFrom && ev.buttons & 1) {
      const from = this.dragFrom!;
      if (!this.moveTo && Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < 5) return;
      const p = viewPoint(this.ctx, ev, this.moveFrom);
      if (!p) return;
      this.moveTo = p;
      const a = this.moveFrom;
      this.ctx.viewport.setPreviewLines({ segments: new Float32Array([a.x, a.y, 0, p.x, p.y, 0]), labels: [] });
      this.ctx.status(`Move: ${Math.round(Math.hypot(p.x - a.x, p.y - a.y))} mm (release to drop)`);
      return;
    }
    if (!this.dragFrom || !(ev.buttons & 1)) return;
    const { x, y } = this.dragFrom;
    if (!this.band && Math.hypot(ev.clientX - x, ev.clientY - y) < 5) return;
    if (!this.band) {
      this.band = document.createElement("div");
      this.band.className = "select-band";
      document.body.append(this.band);
    }
    const crossing = ev.clientX < x;
    Object.assign(this.band.style, {
      left: `${Math.min(x, ev.clientX)}px`,
      top: `${Math.min(y, ev.clientY)}px`,
      width: `${Math.abs(ev.clientX - x)}px`,
      height: `${Math.abs(ev.clientY - y)}px`,
    });
    this.band.classList.toggle("crossing", crossing);
  }

  pointerUp(ev: PointerEvent): void {
    const from = this.dragFrom;
    this.dragFrom = null;
    if (this.moveFrom) {
      const [a, b] = [this.moveFrom, this.moveTo];
      this.moveFrom = this.moveTo = null;
      if (!b) return;
      this.ctx.viewport.setPreviewLines(null);
      const { doc } = this.ctx;
      const ids = this.ctx.selection();
      try {
        doc.transact("Move", (tx) => transformElements(tx, doc, ids, translation({ x: b.x - a.x, y: b.y - a.y })));
        this.ctx.setSelection(ids);
        this.ctx.status("Moved. Ctrl+Z to undo.");
      } catch (e) {
        this.ctx.status(`⚠ ${(e as Error).message}`);
      }
      return;
    }
    if (!from || !this.band) return this.endBand();
    this.endBand();
    // Grouped elements select as their group.
    const ids = [
      ...new Set(
        this.ctx.viewport.elementsInRect({ x0: from.x, y0: from.y, x1: ev.clientX, y1: ev.clientY }, ev.clientX < from.x).map((id) => {
          const el = this.ctx.doc.get(id);
          const g = el && groupOf(el);
          return g && this.ctx.doc.has(g) ? g : id;
        }),
      ),
    ];
    this.ctx.setSelection(ev.shiftKey ? [...new Set([...this.ctx.selection(), ...ids])] : ids);
    this.ctx.status(`${ids.length} element(s) in box`);
  }

  private endBand(): void {
    this.band?.remove();
    this.band = null;
  }

  click(ev: PointerEvent): void {
    let id = this.ctx.viewport.pick(ev);
    // Clicking a group member selects the group; Alt+click selects the member itself.
    const el = id ? this.ctx.doc.get(id) : undefined;
    const g = el && groupOf(el);
    if (g && this.ctx.doc.has(g) && !ev.altKey) id = g;
    if (!id) {
      if (!ev.shiftKey) this.ctx.setSelection([]);
      return;
    }
    if (ev.shiftKey) {
      const cur = new Set(this.ctx.selection());
      if (cur.has(id)) cur.delete(id);
      else cur.add(id);
      this.ctx.setSelection([...cur]);
    } else {
      // A curtain wall that's already selected: the click picks its mullion or panel (Revit: Tab).
      const sel = this.ctx.selection();
      if (sel.length === 1 && sel[0] === id && this.pickCurtainPart(ev, id)) return;
      this.ctx.setSelection([id]);
    }
  }

  private lastPointer: { clientX: number; clientY: number } | null = null;

  /** Select the mullion or panel of curtain wall `id` under the cursor; false if there isn't one. */
  private pickCurtainPart(ev: { clientX: number; clientY: number }, id: ElementId): boolean {
    const el = this.ctx.doc.get(id);
    if (!el || el.category !== Cat.Wall || !curtainOf(this.ctx.doc, el)) return false;
    const key = this.ctx.viewport.pickPart(ev, id);
    if (!key) return false;
    if (this.ctx.selection().join() !== id) this.ctx.setSelection([id]);
    setCurtainPart({ id, key });
    this.ctx.status(`${partLabel(key)} selected: change it in Properties. Esc goes back to the wall.`);
    return true;
  }

  key(ev: KeyboardEvent): boolean {
    // Tab over a curtain wall picks the mullion or panel under the cursor.
    if (ev.key === "Tab" && this.lastPointer) {
      const id = this.ctx.viewport.pick(this.lastPointer);
      if (id && this.pickCurtainPart(this.lastPointer, id)) return true;
    }
    if (ev.key === "Escape" && curtainPart()) {
      setCurtainPart(null);
      return true;
    }
    if (ev.key === "Delete" || ev.key === "Backspace") {
      const ids = this.ctx.selection();
      if (!ids.length) return false;
      try {
        this.ctx.doc.transact(`Delete ${ids.length} element(s)`, (tx) => ids.forEach((id) => tx.delete(id)));
        this.ctx.setSelection([]);
      } catch (err) {
        this.ctx.status(String((err as Error).message));
      }
      return true;
    }
    return false;
  }
}

// ---- Snapping ---------------------------------------------------------------

const INCREMENT = 50; // mm snap increment
const POINT_SNAP = 300; // mm, wall/grid endpoints and grid intersections
const LINE_SNAP = 200; // mm, onto grid lines
const ORTHO_DEG = 4;

export interface Snapped {
  p: Vec2;
  /** What the point snapped to, for status feedback. */
  kind: "endpoint" | "intersection" | "grid" | "increment";
}

/**
 * Snap a plan point. Priority: wall endpoints on the active level and grid endpoints,
 * grid intersections, grid lines (staying ortho to `start` when ortho applies), then the
 * 50 mm increment. `free` (Shift) turns off ortho.
 */
export function snapPoint(ctx: ToolContext, p: Vec2, start: Vec2 | null, free: boolean, extra: Vec2[] = []): Snapped {
  const grids = datumLines(ctx.doc); // grids and reference planes
  const nearest = (pts: Vec2[]) => {
    let best: Vec2 | null = null;
    let bestD = POINT_SNAP;
    for (const q of pts) {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bestD) [best, bestD] = [q, d];
    }
    return best;
  };

  // 1. Endpoints
  const ends: Vec2[] = [...extra, ...grids.flatMap((g) => [g.params.start, g.params.end])];
  for (const w of ctx.doc.byCategory<WallParams>(Cat.Wall)) {
    if (w.params.baseLevelId === ctx.activeLevelId()) ends.push(w.params.start, w.params.end);
  }
  const end = nearest(ends);
  if (end) return { p: { ...end }, kind: "endpoint" };

  // 2. Grid intersections
  const crossings: Vec2[] = [];
  for (let i = 0; i < grids.length; i++) {
    for (let j = i + 1; j < grids.length; j++) {
      const x = datumIntersection(grids[i]!, grids[j]!);
      if (x) crossings.push(x);
    }
  }
  const cross = nearest(crossings);
  if (cross) return { p: cross, kind: "intersection" };

  // 3. Ortho to start point
  let q = { ...p };
  let locked: "x" | "y" | null = null; // coordinate held equal to the start point's
  if (start && !free) {
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    const ang = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI) % 90;
    if (ang < ORTHO_DEG || ang > 90 - ORTHO_DEG) {
      if (Math.abs(dx) > Math.abs(dy)) [q, locked] = [{ x: p.x, y: start.y }, "y"];
      else [q, locked] = [{ x: start.x, y: p.y }, "x"];
    }
  }

  // 4. Onto a grid line (along the ortho line when locked)
  for (const g of grids) {
    const c = closestPointOnDatum(g, q);
    if (Math.hypot(c.x - q.x, c.y - q.y) > LINE_SNAP) continue;
    if (!locked) return { p: c, kind: "grid" };
    const on = orthoOnGrid(g, start!, locked);
    if (on && Math.hypot(on.x - q.x, on.y - q.y) <= LINE_SNAP) return { p: on, kind: "grid" };
  }

  // 5. Increment
  const r = (v: number) => Math.round(v / INCREMENT) * INCREMENT;
  if (locked === "x") return { p: { x: q.x, y: r(q.y) }, kind: "increment" };
  if (locked === "y") return { p: { x: r(q.x), y: q.y }, kind: "increment" };
  return { p: { x: r(q.x), y: r(q.y) }, kind: "increment" };
}

/** Where the ortho line through `start` (with coordinate `locked` held) crosses grid `g`. */
function orthoOnGrid(g: DatumLine, start: Vec2, locked: "x" | "y"): Vec2 | null {
  const { start: a, end: b } = g.params;
  const free = locked === "x" ? "y" : "x";
  const d = b[locked] - a[locked];
  if (Math.abs(d) < 1e-9) return null; // grid parallel to the ortho line
  const t = (start[locked] - a[locked]) / d;
  if (t < 0 || t > 1) return null;
  const v = a[free] + (b[free] - a[free]) * t;
  return locked === "x" ? { x: start.x, y: v } : { x: v, y: start.y };
}

const SNAP_LABEL: Record<Snapped["kind"], string> = {
  endpoint: " · snap: endpoint",
  intersection: " · snap: grid intersection",
  grid: " · snap: grid / reference plane",
  increment: "",
};

// ---- Wall -----------------------------------------------------------------

export class WallTool implements Tool {
  readonly name = "wall";
  private start: Vec2 | null = null;

  constructor(private ctx: ToolContext) {}

  activate(): void {
    this.start = null;
    this.ctx.status("Wall: click start point, then end point. Walls chain; Esc to finish. Shift = free angle.");
  }

  deactivate(): void {
    this.start = null;
    this.ctx.viewport.setPreview(null);
    this.ctx.viewport.setPreviewLines(null);
  }

  private levelElevation(): number {
    return this.ctx.doc.require<LevelParams>(this.ctx.activeLevelId()).params.elevation;
  }

  /** Next level above the active one; walls are top-constrained to it. */
  private topLevelId(): ElementId | null {
    const all = levels(this.ctx.doc);
    const i = all.findIndex((l) => l.id === this.ctx.activeLevelId());
    return all[i + 1]?.id ?? null;
  }

  private snapped: Snapped | null = null;

  private point(ev: PointerEvent): Vec2 | null {
    const p = this.ctx.viewport.pickPlane(ev, this.levelElevation());
    this.snapped = p && snapPoint(this.ctx, p, this.start, ev.shiftKey);
    return this.snapped?.p ?? null;
  }

  pointerMove(ev: PointerEvent): void {
    const p = this.point(ev);
    if (!p || !this.start) {
      this.ctx.viewport.setPreview(null);
    this.ctx.viewport.setPreviewLines(null);
      return;
    }
    const len = Math.hypot(p.x - this.start.x, p.y - this.start.y);
    if (len < 1) {
      this.ctx.viewport.setPreview(null);
    this.ctx.viewport.setPreviewLines(null);
      return;
    }
    const typeId = this.ctx.activeTypeId(Cat.WallType);
    if (!typeId) return;
    const type = this.ctx.doc.require<LayeredTypeParams>(typeId);
    const z0 = this.levelElevation();
    const top = this.topLevelId();
    const z1 = top ? this.ctx.doc.require<LevelParams>(top).params.elevation : z0 + 2400;
    this.ctx.viewport.setPreview(extrudePolygon(wallFootprint(this.start, p, totalThickness(type)), [], z0, z1));
    this.ctx.viewport.setPreviewLines(tempDimension(this.ctx, this.start, p));
    this.ctx.status(`Wall length: ${formatLength(len, projectUnits(this.ctx.doc))}${SNAP_LABEL[this.snapped!.kind]}`);
  }

  click(ev: PointerEvent): void {
    const p = this.point(ev);
    if (!p) return;
    if (!this.start) {
      this.start = p;
      return;
    }
    if (Math.hypot(p.x - this.start.x, p.y - this.start.y) < 10) return;
    const start = this.start;
    let wall: Wall | undefined;
    this.ctx.doc.transact("Create wall", (tx) => {
      const typeId = this.ctx.activeTypeId(Cat.WallType);
      if (!typeId) throw new Error("No wall types in this project");
      wall = createWall(tx, typeId, start, p, this.ctx.activeLevelId(), {
        topLevelId: this.topLevelId(),
      });
    });
    this.start = p;
    if (wall) this.ctx.setSelection([wall.id]);
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key === "Escape" && this.start) {
      this.start = null;
      this.ctx.viewport.setPreview(null);
    this.ctx.viewport.setPreviewLines(null);
      this.ctx.status("Wall: click start point.");
      return true;
    }
    return false;
  }
}

// ---- Datum lines (grids, reference planes) -----------------------------------

interface DatumLineKind {
  readonly name: string;
  /** Label for status prompts, e.g. "Grid 4" or "Reference plane". */
  label(doc: Document): string;
  preview(doc: Document, start: Vec2, end: Vec2): LineData;
  create(tx: Transaction, doc: Document, start: Vec2, end: Vec2): Element;
  readonly txName: string;
}

/** Click a start point, then an end point. Snaps like the wall tool; no chaining. */
class DatumLineTool implements Tool {
  readonly name: string;
  private start: Vec2 | null = null;
  get dragPlace(): boolean {
    return !this.start;
  }

  constructor(
    private ctx: ToolContext,
    private kind: DatumLineKind,
  ) {
    this.name = kind.name;
  }

  activate(): void {
    this.start = null;
    this.prompt();
  }

  deactivate(): void {
    this.start = null;
    this.ctx.viewport.setPreviewLines(null);
  }

  private prompt(): void {
    this.ctx.status(`${this.kind.label(this.ctx.doc)}: click start point, then end point (or drag). Shift = free angle.`);
  }

  private point(ev: PointerEvent): Snapped | null {
    const elevation = this.ctx.doc.require<LevelParams>(this.ctx.activeLevelId()).params.elevation;
    const p = this.ctx.viewport.pickPlane(ev, elevation);
    return p && snapPoint(this.ctx, p, this.start, ev.shiftKey);
  }

  pointerMove(ev: PointerEvent): void {
    const s = this.point(ev);
    const len = s && this.start ? Math.hypot(s.p.x - this.start.x, s.p.y - this.start.y) : 0;
    if (!s || !this.start || len < 1) {
      this.ctx.viewport.setPreviewLines(null);
      return;
    }
    this.ctx.viewport.setPreviewLines(this.kind.preview(this.ctx.doc, this.start, s.p));
    this.ctx.status(`${this.kind.label(this.ctx.doc)} length: ${formatLength(len, projectUnits(this.ctx.doc))}${SNAP_LABEL[s.kind]}`);
  }

  click(ev: PointerEvent): void {
    const s = this.point(ev);
    if (!s) return;
    if (!this.start) {
      this.start = s.p;
      return;
    }
    if (Math.hypot(s.p.x - this.start.x, s.p.y - this.start.y) < 10) return;
    const start = this.start;
    const { doc } = this.ctx;
    const el = doc.transact(this.kind.txName, (tx) => this.kind.create(tx, doc, start, s.p));
    this.start = null;
    this.ctx.viewport.setPreviewLines(null);
    this.ctx.setSelection([el.id]);
    this.prompt();
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key === "Escape" && this.start) {
      this.start = null;
      this.ctx.viewport.setPreviewLines(null);
      this.prompt();
      return true;
    }
    return false;
  }
}

export class GridTool extends DatumLineTool {
  constructor(ctx: ToolContext) {
    super(ctx, {
      name: "grid",
      txName: "Create grid",
      label: (doc) => `Grid ${nextGridName(doc)}`,
      preview: (doc, start, end) =>
        buildGridLines(doc, { id: "preview", category: Cat.Grid, name: nextGridName(doc), params: { start, end } } as Grid),
      create: (tx, doc, start, end) => createGrid(tx, doc, start, end),
    });
  }
}

export class ReferencePlaneTool extends DatumLineTool {
  constructor(ctx: ToolContext) {
    super(ctx, {
      name: "refplane",
      txName: "Create reference plane",
      label: () => "Reference plane",
      preview: (doc, start, end) =>
        buildReferencePlaneLines(doc, { id: "preview", category: Cat.ReferencePlane, params: { start, end } }),
      create: (tx, doc, start, end) => createReferencePlane(tx, doc, start, end),
    });
  }
}

// ---- Sketch (floors, ceilings) --------------------------------------------

type SketchKind = "floor" | "ceiling" | "roof" | "region" | "cloud" | "toposolid" | "pad" | "subregion" | "property" | "extrusion" | "blend" | "revolution";

const SKETCH: Record<SketchKind, { category: string; typeCategory: string; label: string }> = {
  floor: { category: Cat.Floor, typeCategory: Cat.FloorType, label: "Floor" },
  ceiling: { category: Cat.Ceiling, typeCategory: Cat.CeilingType, label: "Ceiling" },
  roof: { category: Cat.Roof, typeCategory: Cat.RoofType, label: "Roof" },
  region: { category: Cat.FilledRegion, typeCategory: "", label: "Filled region" },
  cloud: { category: Cat.RevisionCloud, typeCategory: "", label: "Revision cloud" },
  toposolid: { category: Cat.Toposolid, typeCategory: "", label: "Toposolid" },
  pad: { category: Cat.BuildingPad, typeCategory: "", label: "Building pad" },
  subregion: { category: Cat.SiteSubregion, typeCategory: "", label: "Subregion" },
  property: { category: Cat.PropertyLine, typeCategory: "", label: "Property line" },
  extrusion: { category: Cat.Extrusion, typeCategory: "", label: "Extrusion" },
  blend: { category: Cat.Blend, typeCategory: "", label: "Blend (bottom loop, then top loop)" },
  revolution: { category: Cat.Revolution, typeCategory: "", label: "Revolve (profile right of the centre line)" },
};

/**
 * Revit-style boundary sketch: click corners, click the first point to close a loop.
 * Further loops become holes. Enter finishes, Backspace removes the last point, Esc cancels.
 * `edit(id)` re-sketches an existing element's boundary.
 */
export class SketchTool implements Tool {
  readonly name: SketchKind;
  private loops: Vec2[][] = [];
  private current: Vec2[] = [];
  private cursor: Vec2 | null = null;
  private editing: ElementId | null = null;
  /** Pick Walls (floors, ceilings, roofs): the boundary follows picked walls. */
  private picking = false;
  private picked: ElementId[] = [];
  private pickLine: PickWallLine = "interior";
  private pickOffset = 0;

  constructor(
    private ctx: ToolContext,
    kind: SketchKind,
  ) {
    this.name = kind;
    if (kind === "roof") {
      // Roofs by footprint: the exterior face plus an eave overhang.
      this.pickLine = "exterior";
      this.pickOffset = 600;
    }
  }

  private get canPick(): boolean {
    return this.name === "floor" || this.name === "ceiling" || this.name === "roof";
  }

  private showOptions(): void {
    if (!this.canPick) return;
    const opts: ToolOption[] = [
      { kind: "check", label: "Pick Walls", value: this.picking, set: (v) => ((this.picking = v), this.prompt(), this.showOptions(), this.redraw()) },
    ];
    if (this.picking) {
      opts.push(
        { kind: "select", label: "Line on", value: this.pickLine, options: PICK_WALL_LINES, set: (v) => ((this.pickLine = v as PickWallLine), this.redraw()) },
        { kind: "number", label: "Offset", value: this.pickOffset, min: -Infinity, set: (v) => ((this.pickOffset = v || 0), this.redraw()) },
      );
    }
    this.ctx.setToolOptions?.(opts);
  }

  /** The loop from the picked walls, or null (with the reason) if they don't close yet. */
  private pickedLoop(): { loop: Vec2[] | null; why: string } {
    if (!this.picked.length) return { loop: null, why: "" };
    try {
      return { loop: boundaryFromWalls(this.ctx.doc, this.picked, this.pickLine, this.pickOffset), why: "" };
    } catch (err) {
      return { loop: null, why: (err as Error).message };
    }
  }

  private get def() {
    return SKETCH[this.name];
  }

  activate(): void {
    this.reset();
    this.prompt();
    this.showOptions();
  }

  deactivate(): void {
    this.reset();
    this.ctx.viewport.setPreviewLines(null);
    this.ctx.setToolOptions?.(null);
  }

  /** Start re-sketching the boundary of an existing floor/ceiling (replaces it on finish). */
  edit(id: ElementId): void {
    this.reset();
    this.editing = id;
    this.prompt();
  }

  private reset(): void {
    this.loops = [];
    this.current = [];
    this.cursor = null;
    this.editing = null;
    this.picked = [];
  }

  private prompt(): void {
    if (this.picking) {
      const n = this.picked.length;
      const { loop, why } = this.pickedLoop();
      this.ctx.status(
        `Pick Walls: click walls round the ${this.def.label.toLowerCase()} (click again to drop one). ` +
          (loop ? "Loop closed: Enter = finish." : n ? `${n} picked${why ? ` \u2014 ${why}` : ""}.` : "") +
          " Untick Pick Walls to sketch holes; Esc = cancel",
      );
      return;
    }
    const what = this.editing ? `Edit ${this.def.label.toLowerCase()} boundary` : `${this.def.label} sketch`;
    const n = this.loops.length;
    const loops = n ? ` · ${n} loop${n > 1 ? "s" : ""} closed (extra loops become holes)` : "";
    this.ctx.status(
      `${what}: click corners, click the first point to close. Enter = finish, Backspace = undo point, Esc = cancel${loops}`,
    );
  }

  private point(ev: PointerEvent): Vec2 | null {
    return viewPoint(this.ctx, ev, this.current.at(-1) ?? null, [...this.loops.flat(), ...this.current]);
  }

  private redraw(): void {
    const seg: number[] = [];
    const add = (a: Vec2, b: Vec2) => seg.push(a.x, a.y, 0, b.x, b.y, 0);
    for (const loop of this.loops) loop.forEach((p, i) => add(p, loop[(i + 1) % loop.length]!));
    for (let i = 1; i < this.current.length; i++) add(this.current[i - 1]!, this.current[i]!);
    const last = this.current.at(-1);
    if (last && this.cursor) add(last, this.cursor);
    const picked = this.pickedLoop().loop;
    if (picked) picked.forEach((p, i) => add(p, picked[(i + 1) % picked.length]!));
    this.ctx.viewport.setPreviewLines(seg.length ? { segments: new Float32Array(seg), labels: [] } : null);
  }

  pointerMove(ev: PointerEvent): void {
    this.cursor = this.point(ev);
    this.redraw();
  }

  click(ev: PointerEvent): void {
    if (this.picking) {
      const id = this.ctx.viewport.pick(ev);
      if (!id || this.ctx.doc.get(id)?.category !== Cat.Wall) return this.ctx.status("Pick Walls: click a wall.");
      this.picked = this.picked.includes(id) ? this.picked.filter((x) => x !== id) : [...this.picked, id];
      this.ctx.setSelection(this.picked);
      this.redraw();
      this.prompt();
      return;
    }
    const p = this.point(ev);
    if (!p) return;
    const first = this.current[0];
    if (first && this.current.length >= 3 && p.x === first.x && p.y === first.y) {
      this.loops.push(this.current);
      this.current = [];
      this.prompt();
    } else {
      const last = this.current.at(-1);
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 10) this.current.push(p);
    }
    this.redraw();
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key === "Enter") {
      this.finish();
      return true;
    }
    if (ev.key === "Backspace") {
      if (this.current.length) this.current.pop();
      else if (this.loops.length) this.current = this.loops.pop()!;
      this.redraw();
      return true;
    }
    if (ev.key === "Escape" && (this.current.length || this.loops.length || this.editing || this.picked.length)) {
      this.reset();
      this.redraw();
      this.prompt();
      return true;
    }
    return false;
  }

  /** Family forms: map the sketch onto the view's work plane and create the form. */
  private finishForm(loops: Vec2[][]): void {
    const { doc } = this.ctx;
    try {
      const sp = sketchPlane(this.ctx);
      const toNum = (loop: Vec2[]): NumPt[] => loop.map((p) => sp.toPlane(p)).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
      const isVoid = this.ctx.formIsVoid();
      let id: ElementId;
      if (this.name === "extrusion") {
        const region = regionFromLoops(loops.map((l) => l.map(sp.toPlane)));
        id = doc.transact(isVoid ? "Create void extrusion" : "Create extrusion", (tx) =>
          createExtrusion(tx, toNum(region.boundary), { holes: region.holes.map(toNum), end: sp.depth, plane: sp.plane, isVoid }),
        ).id;
      } else if (this.name === "blend") {
        if (loops.length !== 2) throw new Error("Sketch two loops: the bottom profile, then the top");
        id = doc.transact("Create blend", (tx) => createBlend(tx, toNum(loops[0]!), toNum(loops[1]!), { end: sp.depth, plane: sp.plane, isVoid })).id;
      } else {
        if (loops.length !== 1) throw new Error("Sketch one closed profile to revolve");
        id = doc.transact("Create revolve", (tx) => createRevolution(tx, toNum(loops[0]!), { plane: sp.plane, isVoid })).id;
      }
      this.reset();
      this.redraw();
      this.ctx.setSelection([id]);
      this.ctx.status(`${this.def.label.split(" (")[0]} created. Edit depths and points (formulas welcome) in Properties.`);
    } catch (err) {
      this.ctx.status(`\u26a0 ${(err as Error).message}`);
    }
  }

  private finish(): void {
    let loops = this.current.length >= 3 ? [...this.loops, this.current] : this.loops;
    if (this.picked.length) {
      const { loop, why } = this.pickedLoop();
      if (!loop) return this.ctx.status(`\u26a0 ${why}`);
      // The picked loop is the boundary; sketched loops inside it become holes.
      loops = [loop, ...loops];
    }
    const { doc } = this.ctx;
    if (this.name === "extrusion" || this.name === "blend" || this.name === "revolution") return this.finishForm(loops);
    try {
      const region = regionFromLoops(loops);
      if (this.name === "roof" && region.holes.length) throw new Error("A footprint roof takes a single boundary loop");
      const editing = this.editing;
      let id: ElementId;
      if (editing) {
        // A re-sketched roof footprint gets default slopes: the old per-edge values no longer line up.
        const patch =
          this.name === "roof"
            ? normaliseFootprint(region.boundary, region.boundary.map(() => DEFAULT_ROOF_SLOPE))
            : { ...region };
        doc.transact(`Edit ${this.def.label.toLowerCase()} boundary`, (tx) => tx.update(editing, patch));
        id = editing;
      } else {
        if (this.name === "property") {
          const pl = doc.transact("Create property line", (tx) => createPropertyLine(tx, region.boundary));
          this.reset();
          this.redraw();
          this.ctx.setSelection([pl.id]);
          this.ctx.status("Property line made: its bearings and distances are in Properties (edit them there).");
          return;
        }
        if (this.name === "pad" || this.name === "subregion") {
          // Pads and subregions go on the toposolid they're sketched in.
          const made =
            this.name === "pad"
              ? doc.transact("Create building pad", (tx) => createBuildingPad(tx, doc, region.boundary))
              : doc.transact("Create subregion", (tx) => createSubregion(tx, doc, region.boundary));
          this.reset();
          this.redraw();
          this.ctx.setSelection([made.id]);
          this.ctx.status(this.name === "pad" ? "Building pad made: the ground is graded to its underside. Set its height and see the cut and fill in Properties." : "Subregion made. Pick its material in Properties.");
          return;
        }
        if (this.name === "toposolid") {
          const levelId = this.ctx.activeLevelId();
          const t = doc.transact("Create toposolid", (tx) => createToposolid(tx, doc, levelId, region.boundary));
          this.reset();
          this.redraw();
          this.ctx.setSelection([t.id]);
          this.ctx.status("Toposolid created (flat). Import survey points in Properties.");
          return;
        }
        if (this.name === "cloud") {
          const viewId = this.ctx.activeViewId();
          if (!viewId) throw new Error("Open a view or sheet first");
          // Clouds go on the latest revision that hasn't been issued (Revit's default).
          const rev = revisions(doc).filter((r) => !r.params.issued).at(-1);
          if (!rev) throw new Error("No open revision: add one in the browser (Revisions \u2192 New revision)");
          const c = doc.transact("Create revision cloud", (tx) => createRevisionCloud(tx, doc, viewId, rev.id, region.boundary));
          this.reset();
          this.redraw();
          this.ctx.setSelection([c.id]);
          this.ctx.status(`Revision cloud added for revision ${revisionNumber(doc, rev)}.`);
          return;
        }
        if (this.name === "region") {
          const viewId = this.ctx.activeViewId();
          if (!viewId) throw new Error("Open a plan, section or elevation first");
          const r = doc.transact("Create filled region", (tx) => createFilledRegion(tx, doc, viewId, region.boundary, { holes: region.holes }));
          this.reset();
          this.redraw();
          this.ctx.setSelection([r.id]);
          this.ctx.status("Filled region created.");
          return;
        }
        const typeId = this.ctx.activeTypeId(this.def.typeCategory);
        if (!typeId) throw new Error(`No ${this.def.label.toLowerCase()} types in this project`);
        const levelId = this.ctx.activeLevelId();
        id = doc.transact(`Create ${this.def.label.toLowerCase()}`, (tx) =>
          this.name === "floor"
            ? createFloor(tx, typeId, levelId, region.boundary, { holes: region.holes })
            : this.name === "ceiling"
              ? createCeiling(tx, typeId, levelId, region.boundary, { holes: region.holes })
              : createRoof(tx, typeId, levelId, region.boundary),
        ).id;
      }
      this.reset();
      this.redraw();
      this.ctx.setSelection([id]);
      this.ctx.status(
        this.name === "ceiling" && this.ctx.viewport.viewMode === "plan"
          ? "Ceiling created. It is above the plan cut plane, so see it in 3D."
          : `${this.def.label} ${editing ? "updated" : "created"}.`,
      );
    } catch (err) {
      this.ctx.status(`⚠ ${(err as Error).message}`);
    }
  }
}

// ---- Wall opening -----------------------------------------------------------

const OPENING_DEFAULT = { width: 900, sillHeight: 0, height: 2100 };

/** Click a wall to cut a rectangular opening there (Revit "Wall Opening"). Edit sizes in Properties. */
export class OpeningTool implements Tool {
  readonly name = "opening";
  constructor(private ctx: ToolContext) {}

  activate(): void {
    this.ctx.status(`Opening: click a wall to cut a ${OPENING_DEFAULT.width} \u00d7 ${OPENING_DEFAULT.height} opening. Change sizes in Properties.`);
  }

  click(ev: PointerEvent): void {
    const { doc, viewport } = this.ctx;
    const hit = viewport.pickHit(ev, (id) => doc.get(id)?.category === Cat.Wall);
    if (!hit) return this.ctx.status("Opening: click on a wall.");
    const wall = doc.require<WallParams>(hit.id) as Wall;
    const half = OPENING_DEFAULT.width / 2;
    const len = wallLength(wall);
    const at = Math.round(Math.min(Math.max(positionAlongWall(wall, hit.point), half), len - half));
    try {
      const o = doc.transact("Create opening", (tx) => createWallOpening(tx, doc, wall.id, at, OPENING_DEFAULT));
      this.ctx.setSelection([o.id]);
    } catch (err) {
      this.ctx.status(`\u26a0 ${(err as Error).message}`);
    }
  }
}

// ---- Doors & windows -----------------------------------------------------------

type HostedKind = "door" | "window";

/**
 * Click a wall to place a door or window of the first type, centred on the click
 * (nudged to fit). Doors swing to the side of the wall you clicked.
 */
export class HostedTool implements Tool {
  readonly name: HostedKind;
  constructor(
    private ctx: ToolContext,
    kind: HostedKind,
  ) {
    this.name = kind;
  }

  private typeId(): ElementId | undefined {
    return this.ctx.activeTypeId(this.name === "door" ? Cat.DoorType : Cat.WindowType);
  }

  activate(): void {
    const t = this.typeId();
    const name = t ? this.ctx.doc.require(t).name : "none";
    this.ctx.status(`${this.name === "door" ? "Door" : "Window"} (${name}): click a wall to place. Edit in Properties.`);
  }

  click(ev: PointerEvent): void {
    const { doc, viewport } = this.ctx;
    const typeId = this.typeId();
    if (!typeId) return this.ctx.status(`\u26a0 No ${this.name} types in this project`);
    const hit = viewport.pickHit(ev, (id) => doc.get(id)?.category === Cat.Wall);
    if (!hit) return this.ctx.status(`${this.name === "door" ? "Door" : "Window"}: click on a wall.`);
    const wall = doc.require<WallParams>(hit.id) as Wall;
    const probe = { id: "", category: this.name === "door" ? Cat.Door : Cat.Window, typeId };
    const width =
      this.name === "door"
        ? doorPlacement(doc, { ...probe, params: { hostId: wall.id, position: 0, sillHeight: 0, facingFlipped: false, handFlipped: false } }).width
        : windowPlacement(doc, { ...probe, params: { hostId: wall.id, position: 0, sillHeight: 0 } }).width;
    const len = wallLength(wall);
    const at = Math.round(Math.min(Math.max(positionAlongWall(wall, hit.point), width / 2), len - width / 2));
    // Which side of the location line was clicked: + is the wall's left.
    const { start, end } = wall.params;
    const side = (end.x - start.x) * (hit.point.y - start.y) - (end.y - start.y) * (hit.point.x - start.x);
    try {
      const el = doc.transact(`Place ${this.name}`, (tx) =>
        this.name === "door"
          ? createDoor(tx, doc, typeId, wall.id, at, { facingFlipped: side < 0 })
          : createWindow(tx, doc, typeId, wall.id, at),
      );
      this.ctx.setSelection([el.id]);
    } catch (err) {
      this.ctx.status(`\u26a0 ${(err as Error).message}`);
    }
  }
}

// ---- Sections & callouts ----------------------------------------------------------

/** Plain line preview on the work plane. */
const linePreview = (start: Vec2, end: Vec2): LineData => ({
  segments: new Float32Array([start.x, start.y, 0, end.x, end.y, 0]),
  labels: [],
});

/**
 * Temporary dimension (Revit's, while drawing): witness lines, a dimension line with ticks beside
 * the line being drawn, its length, and its angle when it isn't square to the axes. Paper sizes
 * scale with the open view.
 */
function tempDimension(ctx: ToolContext, a: Vec2, b: Vec2, base: LineData | null = null): LineData {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const seg: number[] = base ? [...base.segments] : [];
  const labels: LineData["labels"] = base ? [...base.labels] : [];
  if (len >= 1) {
    const viewId = ctx.activeViewId();
    const k = (viewId ? ctx.doc.get<ViewParams>(viewId)?.params.scale : undefined) ?? 100;
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const n = { x: -d.y, y: d.x };
    const off = 8 * k;
    const at = (q: Vec2, o: number) => ({ x: q.x + n.x * o, y: q.y + n.y * o });
    const ln = (q: Vec2, r: Vec2) => seg.push(q.x, q.y, 0, r.x, r.y, 0);
    for (const q of [a, b]) {
      ln(at(q, 1.5 * k), at(q, off + 2 * k));
      const c = at(q, off);
      const t = 1.4 * k;
      ln({ x: c.x - (d.x + n.x) * t, y: c.y - (d.y + n.y) * t }, { x: c.x + (d.x + n.x) * t, y: c.y + (d.y + n.y) * t });
    }
    ln(at(a, off), at(b, off));
    const mid = at({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, off + 2 * k);
    labels.push({ text: formatLength(len, projectUnits(ctx.doc)), position: [mid.x, mid.y, 0], size: 2.5 * k });
    const deg = (((Math.atan2(d.y, d.x) * 180) / Math.PI) % 360 + 360) % 360;
    if (Math.abs(deg - Math.round(deg / 90) * 90) > 0.05) {
      const q = { x: a.x - n.x * 4 * k + d.x * 4 * k, y: a.y - n.y * 4 * k + d.y * 4 * k };
      labels.push({ text: `${deg.toFixed(1)}\u00b0`, position: [q.x, q.y, 0], size: 2.2 * k });
    }
  }
  return { segments: new Float32Array(seg), labels };
}

/** Section: click the head end, then the tail. The view looks to the left of the line you draw. */
export class SectionTool extends DatumLineTool {
  constructor(ctx: ToolContext) {
    super(ctx, {
      name: "section",
      txName: "Create section",
      label: () => "Section (looks to the left of the line)",
      preview: (_doc, start, end) => linePreview(start, end),
      create: (tx, doc, start, end) => createSection(tx, doc, start, end),
    });
  }
}

/** Room separation line: click start and end on the active level (plans). */
export class RoomSeparatorTool extends DatumLineTool {
  constructor(ctx: ToolContext) {
    super(ctx, {
      name: "roomseparator",
      txName: "Create room separator",
      label: () => "Room separator",
      preview: (_doc, start, end) => linePreview(start, end),
      create: (tx, doc, start, end) => createRoomSeparator(tx, doc, ctx.activeLevelId(), start, end),
    });
  }
}

/** Stair (or ramp) by component: click the start and end of each run; Enter builds it, Esc cancels. */
export class StairTool implements Tool {
  readonly name: "stair" | "ramp";
  private runs: StairRun[] = [];
  private start: Vec2 | null = null;
  constructor(
    private ctx: ToolContext,
    kind: "stair" | "ramp" = "stair",
  ) {
    this.name = kind;
  }

  private get label(): string {
    return this.name === "ramp" ? "Ramp" : "Stair";
  }

  activate(): void {
    this.runs = [];
    this.start = null;
    this.ctx.status(`${this.label}: click the start and end of each run (centreline, going up). Enter to finish, Esc to cancel.`);
  }

  deactivate(): void {
    this.runs = [];
    this.start = null;
    this.ctx.viewport.setPreviewLines(null);
  }

  private preview(cursor: Vec2 | null): void {
    const seg: number[] = [];
    for (const r of this.runs) seg.push(r.start.x, r.start.y, 0, r.end.x, r.end.y, 0);
    if (this.start && cursor) seg.push(this.start.x, this.start.y, 0, cursor.x, cursor.y, 0);
    this.ctx.viewport.setPreviewLines(seg.length ? { segments: new Float32Array(seg), labels: [] } : null);
  }

  pointerMove(ev: PointerEvent): void {
    this.preview(viewPoint(this.ctx, ev, this.start));
  }

  click(ev: PointerEvent): void {
    if (this.ctx.viewport.viewMode !== "plan") return this.ctx.status(`Draw ${this.name}s in a floor plan.`);
    const p = viewPoint(this.ctx, ev, this.start);
    if (!p) return;
    if (!this.start) {
      this.start = p;
      return;
    }
    if (Math.hypot(p.x - this.start.x, p.y - this.start.y) < 100) return;
    this.runs.push({ start: this.start, end: p });
    this.start = null;
    this.preview(null);
    this.ctx.status(`${this.label}: ${this.runs.length} run(s). Click the next run, or Enter to finish.`);
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key === "Escape") {
      this.activate();
      this.ctx.viewport.setPreviewLines(null);
      return true;
    }
    if (ev.key !== "Enter" || !this.runs.length) return false;
    const { doc } = this.ctx;
    const base = this.ctx.activeLevelId();
    const top = levelAbove(doc, base);
    if (!top) {
      this.ctx.status(`\u26a0 ${this.label}s go up to the next level, and there's none above this one.`);
      return true;
    }
    try {
      const runs = this.runs;
      // Railings go on both sides, as Revit adds them by default.
      const ramp = this.name === "ramp";
      const s = doc.transact(`Create ${this.name}`, (tx) => {
        const host = ramp
          ? createRamp(tx, doc, this.ctx.activeTypeId(Cat.RampType) ?? ensureRampType(tx, doc), base, top, runs)
          : createStair(tx, doc, this.ctx.activeTypeId(Cat.StairType) ?? ensureStairType(tx, doc), base, top, runs);
        createStairRailings(tx, doc, ensureRailingType(tx, doc), host);
        return host;
      });
      this.ctx.setSelection([s.id]);
      this.activate();
      this.ctx.viewport.setPreviewLines(null);
      this.ctx.status(this.name === "ramp" ? "Ramp created. Check the gradient in Properties." : "Stair created. Check riser and going in Properties.");
    } catch (err) {
      this.ctx.status(`\u26a0 ${(err as Error).message}`);
    }
    return true;
  }
}

/** Railing by sketch: click points along the path, Enter to finish, Esc to cancel. */
export class RailingTool implements Tool {
  readonly name = "railing";
  private pts: Vec2[] = [];
  constructor(private ctx: ToolContext) {}

  activate(): void {
    this.pts = [];
    this.ctx.status("Railing: click points along the path. Enter to finish, Esc to cancel.");
  }

  deactivate(): void {
    this.pts = [];
    this.ctx.viewport.setPreviewLines(null);
  }

  pointerMove(ev: PointerEvent): void {
    const p = viewPoint(this.ctx, ev, this.pts.at(-1) ?? null);
    const seg: number[] = [];
    const all = p ? [...this.pts, p] : this.pts;
    for (let i = 0; i + 1 < all.length; i++) seg.push(all[i]!.x, all[i]!.y, 0, all[i + 1]!.x, all[i + 1]!.y, 0);
    this.ctx.viewport.setPreviewLines(seg.length ? { segments: new Float32Array(seg), labels: [] } : null);
  }

  click(ev: PointerEvent): void {
    if (this.ctx.viewport.viewMode !== "plan") return this.ctx.status("Sketch railings in a floor plan.");
    const p = viewPoint(this.ctx, ev, this.pts.at(-1) ?? null);
    if (p) this.pts.push(p);
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key === "Escape") {
      this.activate();
      this.ctx.viewport.setPreviewLines(null);
      return true;
    }
    if (ev.key !== "Enter" || this.pts.length < 2) return false;
    const { doc } = this.ctx;
    const pts = this.pts;
    try {
      const r = doc.transact("Create railing", (tx) => createRailing(tx, doc, this.ctx.activeTypeId(Cat.RailingType) ?? ensureRailingType(tx, doc), this.ctx.activeLevelId(), pts));
      this.ctx.setSelection([r.id]);
      this.activate();
      this.ctx.viewport.setPreviewLines(null);
    } catch (err) {
      this.ctx.status(`\u26a0 ${(err as Error).message}`);
    }
    return true;
  }
}

/** The structural section to use: the type selector's, else the first (creating NZ defaults). */
function sectionType(ctx: ToolContext, prefer: (name: string) => boolean): ElementId {
  const chosen = ctx.activeTypeId(Cat.StructuralType);
  if (chosen) return chosen;
  const { doc } = ctx;
  const ids = doc.byCategory(Cat.StructuralType).length ? doc.byCategory(Cat.StructuralType).map((t) => t.id) : doc.transact("Load structural sections", (tx) => ensureStructuralTypes(tx, doc));
  return ids.find((id) => prefer(doc.require(id).name ?? "")) ?? ids[0]!;
}

/** Structural column: click to place, from the active level to the one above. */
export class ColumnTool implements Tool {
  readonly name = "column";
  constructor(private ctx: ToolContext) {}

  activate(): void {
    if (!this.ctx.doc.byCategory(Cat.StructuralType).length) this.ctx.doc.transact("Load structural sections", (tx) => ensureStructuralTypes(tx, this.ctx.doc));
    this.ctx.status("Column: click to place (section from the type selector). Runs up to the next level.");
  }

  click(ev: PointerEvent): void {
    if (this.ctx.viewport.viewMode === "drawing") return this.ctx.status("Place columns in a plan or 3D.");
    const p = viewPoint(this.ctx, ev, null);
    if (!p) return;
    const { doc } = this.ctx;
    const base = this.ctx.activeLevelId();
    const top = levelAbove(doc, base);
    if (!top) return this.ctx.status("\u26a0 Columns run to the level above, and there's none.");
    try {
      const c = doc.transact("Create column", (tx) => createColumn(tx, doc, sectionType(this.ctx, (n) => n.includes("Column") || n.includes("Post")), base, top, p));
      this.ctx.setSelection([c.id]);
    } catch (err) {
      this.ctx.status(`\u26a0 ${(err as Error).message}`);
    }
  }
}

/** Beam: click start and end (chains until Esc); top of beam at the active level. */
export class BeamTool implements Tool {
  readonly name = "beam";
  private start: Vec2 | null = null;
  constructor(private ctx: ToolContext) {}

  activate(): void {
    this.start = null;
    if (!this.ctx.doc.byCategory(Cat.StructuralType).length) this.ctx.doc.transact("Load structural sections", (tx) => ensureStructuralTypes(tx, this.ctx.doc));
    this.ctx.status("Beam: click start, then end; beams chain until Esc. Top of beam at this level.");
  }

  deactivate(): void {
    this.start = null;
    this.ctx.viewport.setPreviewLines(null);
  }

  pointerMove(ev: PointerEvent): void {
    const p = viewPoint(this.ctx, ev, this.start);
    this.ctx.viewport.setPreviewLines(p && this.start ? tempDimension(this.ctx, this.start, p, linePreview(this.start, p)) : null);
  }

  click(ev: PointerEvent): void {
    const p = viewPoint(this.ctx, ev, this.start);
    if (!p) return;
    if (!this.start) {
      this.start = p;
      return;
    }
    const { doc } = this.ctx;
    const a = this.start;
    try {
      const b = doc.transact("Create beam", (tx) => createBeam(tx, doc, sectionType(this.ctx, (n) => n.includes("UB") || n.includes("190x45")), this.ctx.activeLevelId(), a, p));
      this.ctx.setSelection([b.id]);
      this.start = p;
    } catch (err) {
      this.ctx.status(`\u26a0 ${(err as Error).message}`);
    }
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key === "Escape" && this.start) {
      this.start = null;
      this.ctx.viewport.setPreviewLines(null);
      return true;
    }
    return false;
  }
}

/** Spot Elevation: click the point (a floor, roof or toposolid reads its top), then the leader's end. */
export class SpotElevationTool implements Tool {
  readonly name = "spot";
  private first: { point: Vec2; hostId: ElementId | null } | null = null;
  constructor(private ctx: ToolContext) {}

  activate(): void {
    this.first = null;
    this.ctx.status("Spot Elevation: click a point (on a floor, roof or ground for its top), then where the text goes.");
  }

  deactivate(): void {
    this.first = null;
    this.ctx.viewport.setPreviewLines(null);
  }

  private pointAt(ev: PointerEvent): Vec2 | null {
    return this.ctx.viewport.viewMode === "drawing" ? this.ctx.viewport.pickDrawing(ev) : viewPoint(this.ctx, ev, null);
  }

  pointerMove(ev: PointerEvent): void {
    const p = this.pointAt(ev);
    this.ctx.viewport.setPreviewLines(p && this.first ? linePreview(this.first.point, p) : null);
  }

  click(ev: PointerEvent): void {
    const viewId = requireAnnotView(this.ctx);
    if (!viewId) return;
    const { doc, viewport } = this.ctx;
    if (!this.first) {
      const hit = viewport.pickHit(ev, (id) => SPOT_HOSTS.has(doc.get(id)?.category ?? ""));
      const p = viewport.viewMode === "drawing" ? viewport.pickDrawing(ev) : (hit?.point ?? viewPoint(this.ctx, ev, null));
      if (!p) return;
      this.first = { point: p, hostId: hit?.id ?? null };
      this.ctx.status("Spot Elevation: click where the text goes.");
      return;
    }
    const leader = this.pointAt(ev);
    if (!leader) return;
    const f = this.first;
    try {
      const s = doc.transact("Create spot elevation", (tx) => createSpotElevation(tx, doc, viewId, f.point, leader, { hostId: f.hostId }));
      this.ctx.setSelection([s.id]);
      this.activate();
      this.ctx.viewport.setPreviewLines(null);
    } catch (err) {
      this.first = null;
      this.ctx.status(`⚠ ${(err as Error).message}`);
    }
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key === "Escape" && this.first) {
      this.activate();
      this.ctx.viewport.setPreviewLines(null);
      return true;
    }
    return false;
  }
}

/** Roof by Extrusion: click two opposite corners of the roof's plan rectangle (a gable across the shorter side). */
export class ExtrusionRoofTool implements Tool {
  readonly name = "roofextrusion";
  private start: Vec2 | null = null;
  constructor(private ctx: ToolContext) {}

  activate(): void {
    this.start = null;
    this.ctx.status("Roof by Extrusion: click two opposite corners. The profile (25° gable) runs across the shorter side; change it in Properties.");
  }

  deactivate(): void {
    this.start = null;
    this.ctx.viewport.setPreviewLines(null);
  }

  pointerMove(ev: PointerEvent): void {
    const p = viewPoint(this.ctx, ev, null);
    const a = this.start;
    if (!p || !a) return this.ctx.viewport.setPreviewLines(null);
    const q = [a, { x: p.x, y: a.y }, p, { x: a.x, y: p.y }];
    const seg: number[] = [];
    q.forEach((c, i) => {
      const d = q[(i + 1) % 4]!;
      seg.push(c.x, c.y, 0, d.x, d.y, 0);
    });
    this.ctx.viewport.setPreviewLines({ segments: new Float32Array(seg), labels: [] });
  }

  click(ev: PointerEvent): void {
    const p = viewPoint(this.ctx, ev, null);
    if (!p) return;
    if (!this.start) {
      this.start = p;
      return;
    }
    const { doc } = this.ctx;
    const a = this.start;
    try {
      const typeId = this.ctx.activeTypeId(Cat.RoofType);
      if (!typeId) throw new Error("No roof types in this project");
      const r = doc.transact("Create extrusion roof", (tx) => createExtrusionRoof(tx, typeId, this.ctx.activeLevelId(), a, p));
      this.start = null;
      this.ctx.viewport.setPreviewLines(null);
      this.ctx.setSelection([r.id]);
    } catch (err) {
      this.ctx.status(`⚠ ${(err as Error).message}`);
    }
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key === "Escape" && this.start) {
      this.start = null;
      this.ctx.viewport.setPreviewLines(null);
      return true;
    }
    return false;
  }
}

/** Foundations: click empty space for a pad footing, or a wall for a strip footing under it. */
export class FootingTool implements Tool {
  readonly name = "footing";
  constructor(private ctx: ToolContext) {}

  activate(): void {
    this.ctx.status("Footing: click a wall for a strip footing, or anywhere else for a 900 \u00d7 900 pad.");
  }

  click(ev: PointerEvent): void {
    const { doc } = this.ctx;
    const hit = this.ctx.viewport.pickHit(ev, (id) => doc.get(id)?.category === Cat.Wall);
    try {
      if (hit) {
        const f = doc.transact("Create strip footing", (tx) => createStripFooting(tx, doc, hit.id));
        this.ctx.setSelection([f.id]);
        return;
      }
      const p = viewPoint(this.ctx, ev, null);
      if (!p) return;
      const f = doc.transact("Create pad footing", (tx) => createPadFooting(tx, doc, this.ctx.activeLevelId(), p));
      this.ctx.setSelection([f.id]);
    } catch (err) {
      this.ctx.status(`\u26a0 ${(err as Error).message}`);
    }
  }
}

/** Demolish: click elements to demolish them in the open view's phase. */
export class DemolishTool implements Tool {
  readonly name = "demolish";
  constructor(private ctx: ToolContext) {}

  activate(): void {
    this.ctx.status("Demolish: click elements to demolish them in this view's phase.");
  }

  click(ev: PointerEvent): void {
    const { doc } = this.ctx;
    const id = this.ctx.viewport.pick(ev);
    if (!id) return;
    const v = this.ctx.activeViewId() ? doc.get<ViewParams>(this.ctx.activeViewId()!) : undefined;
    const phase = viewPhase(doc, v?.params.phase);
    try {
      doc.transact("Demolish", (tx) => demolish(tx, doc, id, phase));
      this.ctx.status(`Demolished in ${phases(doc).find((p) => p.id === phase)?.name}.`);
    } catch (err) {
      this.ctx.status(`\u26a0 ${(err as Error).message}`);
    }
  }
}

/** Place a copy of a group: click where its origin goes. */
export class PlaceGroupTool implements Tool {
  readonly name = "placegroup";
  source: ElementId | null = null;
  constructor(private ctx: ToolContext) {}

  activate(): void {
    this.ctx.status(this.source ? "Place group: click where the copy's origin goes. Esc to finish." : "Select a group first, then Place copy.");
  }

  click(ev: PointerEvent): void {
    const { doc } = this.ctx;
    if (!this.source || !doc.has(this.source)) return this.ctx.status("Select a group first, then Place copy.");
    const src = this.source;
    const detail = !!(doc.require(src).params as { viewId?: unknown }).viewId;
    let p: Vec2 | null;
    if (detail) {
      // Detail groups go in the open view, at a point in its own 2D space.
      p = viewPoint(this.ctx, ev, null);
    } else {
      const elevation = doc.require<LevelParams>(this.ctx.activeLevelId()).params.elevation;
      const raw = this.ctx.viewport.pickPlane(ev, elevation);
      p = raw && snapPoint(this.ctx, raw, null, ev.shiftKey).p;
    }
    if (!p) return;
    const at = p;
    try {
      const g = doc.transact("Place group", (tx) => placeGroup(tx, doc, src, at, 0, detail ? this.ctx.activeViewId() : undefined));
      this.ctx.setSelection([g.id]);
    } catch (err) {
      this.ctx.status(`\u26a0 ${(err as Error).message}`);
    }
  }
}

/** Tag by category / keynote: click an element, the tag goes where you click. Shift: no snapping. */
export class TagTool implements Tool {
  readonly name: string;
  leader = false;
  constructor(
    private ctx: ToolContext,
    private kind: TagKind,
  ) {
    this.name = kind === "keynote" ? "keynote" : "tag";
  }

  activate(): void {
    const what = this.kind === "keynote" ? "Keynote" : "Tag";
    this.ctx.status(`${what}: click a wall, door, window, component, floor or room. The tag goes where you click.`);
  }

  click(ev: PointerEvent): void {
    const viewId = requireAnnotView(this.ctx);
    if (!viewId) return;
    const { doc } = this.ctx;
    const hit = this.ctx.viewport.pickHit(ev, (id) => TAGGABLE.has(doc.get(id)?.category ?? ""));
    if (!hit) return this.ctx.status("Nothing taggable there.");
    // Openings are tagged on their centre (Revit's door/window tags); everything else where clicked.
    const host = doc.require(hit.id);
    const view = doc.require<ViewParams>(viewId) as View;
    const centred = this.kind === "category" && (host.category === Cat.Door || host.category === Cat.Window);
    const at = (centred ? anchorInView(doc, view, host) : null) ?? viewPoint(this.ctx, ev, null) ?? hit.point;
    try {
      const tag = doc.transact(this.kind === "keynote" ? "Keynote" : "Tag", (tx) => createTag(tx, doc, viewId, hit.id, at, { kind: this.kind, leader: this.leader }));
      this.ctx.setSelection([tag.id]);
    } catch (err) {
      this.ctx.status(`\u26a0 ${(err as Error).message}`);
    }
  }
}

/** The open area plan, or null (with a hint). */
function requireAreaPlan(ctx: ToolContext): ElementId | null {
  const id = ctx.activeViewId();
  const v = id ? ctx.doc.get<ViewParams>(id) : undefined;
  if (v?.params.kind !== "areaPlan") {
    ctx.status("Areas go in area plans. Create one in the browser (Views \u2192 New area plan).");
    return null;
  }
  return v.id;
}

/** Area boundary line: click start and end in an area plan. */
export class AreaBoundaryTool extends DatumLineTool {
  constructor(ctx: ToolContext) {
    super(ctx, {
      name: "areaboundary",
      txName: "Create area boundary",
      label: () => "Area boundary",
      preview: (_doc, start, end) => linePreview(start, end),
      create: (tx, doc, start, end) => {
        const viewId = requireAreaPlan(ctx);
        if (!viewId) throw new Error("Open an area plan first");
        return createAreaBoundary(tx, doc, viewId, start, end);
      },
    });
  }
}

/** Area: click inside area boundary lines in an area plan. */
export class AreaTool implements Tool {
  readonly name = "area";
  constructor(private ctx: ToolContext) {}

  activate(): void {
    this.ctx.status("Area: click inside area boundary lines (in an area plan).");
  }

  click(ev: PointerEvent): void {
    const viewId = requireAreaPlan(this.ctx);
    if (!viewId) return;
    const { doc } = this.ctx;
    const elevation = doc.require<LevelParams>(this.ctx.activeLevelId()).params.elevation;
    const p = this.ctx.viewport.pickPlane(ev, elevation);
    if (!p) return;
    const area = doc.transact("Create area", (tx) => createArea(tx, doc, viewId, p));
    this.ctx.setSelection([area.id]);
    this.ctx.status(areaBoundary(doc, area) ? `Area ${area.params.number} placed.` : "\u26a0 Area is not enclosed by area boundary lines.");
  }
}

/** Room: hover to preview the enclosed region, click to place a room (and its tag) there. */
export class RoomTool implements Tool {
  readonly name = "room";
  constructor(private ctx: ToolContext) {}

  activate(): void {
    this.ctx.status("Room: click inside an area enclosed by walls or room separators.");
  }

  deactivate(): void {
    this.ctx.viewport.setPreviewLines(null);
  }

  private probe(p: Vec2): Room {
    const { doc } = this.ctx;
    return {
      id: "preview",
      category: Cat.Room,
      name: "Room",
      params: { levelId: this.ctx.activeLevelId(), point: p, number: nextRoomNumber(doc), upperLevelId: null, limitOffset: 2400, baseOffset: 0 },
    } as Room;
  }

  pointerMove(ev: PointerEvent): void {
    if (this.ctx.viewport.viewMode !== "plan") return;
    const elevation = this.ctx.doc.require<LevelParams>(this.ctx.activeLevelId()).params.elevation;
    const p = this.ctx.viewport.pickPlane(ev, elevation);
    this.ctx.viewport.setPreviewLines(p ? buildRoomLines(this.ctx.doc, this.probe(p)) : null);
  }

  click(ev: PointerEvent): void {
    if (this.ctx.viewport.viewMode !== "plan") return this.ctx.status("Rooms are placed in floor plans. Open one first.");
    const { doc } = this.ctx;
    const elevation = doc.require<LevelParams>(this.ctx.activeLevelId()).params.elevation;
    const p = this.ctx.viewport.pickPlane(ev, elevation);
    if (!p) return;
    const room = doc.transact("Create room", (tx) => createRoom(tx, doc, this.ctx.activeLevelId(), p));
    this.ctx.setSelection([room.id]);
    this.ctx.status(roomBoundary(doc, room) ? `Room ${room.params.number} placed.` : "⚠ Room is not enclosed. Add walls or room separators around it.");
  }
}

/** Callout: click two opposite corners on a floor plan. */
export class CalloutTool implements Tool {
  readonly name = "callout";
  private start: Vec2 | null = null;
  get dragPlace(): boolean {
    return !this.start;
  }
  constructor(private ctx: ToolContext) {}

  activate(): void {
    this.start = null;
    this.ctx.status("Callout: click two opposite corners on a floor plan, or drag from one to the other.");
  }

  deactivate(): void {
    this.start = null;
    this.ctx.viewport.setPreviewLines(null);
  }

  private point(ev: PointerEvent): Vec2 | null {
    const elevation = this.ctx.doc.require<LevelParams>(this.ctx.activeLevelId()).params.elevation;
    const p = this.ctx.viewport.pickPlane(ev, elevation);
    return p && snapPoint(this.ctx, p, null, true).p;
  }

  pointerMove(ev: PointerEvent): void {
    const p = this.point(ev);
    if (!p || !this.start) return;
    const a = this.start;
    const corners = [a, { x: p.x, y: a.y }, p, { x: a.x, y: p.y }];
    const seg = corners.flatMap((c, i) => {
      const d = corners[(i + 1) % 4]!;
      return [c.x, c.y, 0, d.x, d.y, 0];
    });
    this.ctx.viewport.setPreviewLines({ segments: new Float32Array(seg), labels: [], dashed: true });
  }

  click(ev: PointerEvent): void {
    const p = this.point(ev);
    if (!p) return;
    if (!this.start) {
      this.start = p;
      return;
    }
    const { doc } = this.ctx;
    const parent = this.ctx.activeViewId();
    const start = this.start;
    this.start = null;
    this.ctx.viewport.setPreviewLines(null);
    try {
      if (!parent) throw new Error("Open a floor plan first");
      const v = doc.transact("Create callout", (tx) => createCallout(tx, doc, parent, start, p));
      this.ctx.setSelection([v.id]);
      this.ctx.status(`${v.name} created \u2014 open it from the project browser.`);
    } catch (err) {
      this.ctx.status(`\u26a0 ${(err as Error).message}`);
    }
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key === "Escape" && this.start) {
      this.start = null;
      this.ctx.viewport.setPreviewLines(null);
      return true;
    }
    return false;
  }
}

// ---- Annotation ---------------------------------------------------------------------

/**
 * Cursor point in the active view's 2D space: plan XY (full snapping) or, in sections/elevations,
 * drawing coordinates (endpoints in `extra`, ortho and the 50 mm increment).
 */
export function viewPoint(ctx: ToolContext, ev: PointerEvent, start: Vec2 | null, extra: Vec2[] = []): Vec2 | null {
  if (ctx.viewport.viewMode !== "drawing") {
    const elevation = ctx.doc.require<LevelParams>(ctx.activeLevelId()).params.elevation;
    const p = ctx.viewport.pickPlane(ev, elevation);
    return p && snapPoint(ctx, p, start, ev.shiftKey, extra).p;
  }
  const p = ctx.viewport.pickDrawing(ev);
  if (!p) return null;
  for (const q of extra) if (Math.hypot(q.x - p.x, q.y - p.y) < POINT_SNAP) return { ...q };
  let x = p.x;
  let y = p.y;
  if (start && !ev.shiftKey) {
    if (Math.abs(p.x - start.x) > Math.abs(p.y - start.y)) y = start.y;
    else x = start.x;
  }
  const r = (v: number) => Math.round(v / INCREMENT) * INCREMENT;
  return { x: start && y === start.y ? r(x) : start && x === start.x ? x : r(x), y: start && x === start.x ? r(y) : start && y === start.y ? y : r(y) };
}

function requireAnnotView(ctx: ToolContext): ElementId | null {
  const id = ctx.activeViewId();
  const v = id ? ctx.doc.get(id) : undefined;
  if (!v || (v.params as { kind: string }).kind === "3d") {
    ctx.status("Annotations go in plans, sections and elevations. Open one first.");
    return null;
  }
  return v.id;
}

/** Detail lines: click points; lines chain until Esc. */
export class DetailLineTool implements Tool {
  readonly name = "detailline";
  private start: Vec2 | null = null;
  constructor(private ctx: ToolContext) {}

  activate(): void {
    this.start = null;
    this.ctx.status("Detail line: click start, then each next point. Esc to finish. Drawn in this view only.");
  }

  deactivate(): void {
    this.start = null;
    this.ctx.viewport.setPreviewLines(null);
  }

  pointerMove(ev: PointerEvent): void {
    const p = viewPoint(this.ctx, ev, this.start);
    if (!p || !this.start) return this.ctx.viewport.setPreviewLines(null);
    this.ctx.viewport.setPreviewLines(tempDimension(this.ctx, this.start, p, linePreview(this.start, p)));
  }

  click(ev: PointerEvent): void {
    const viewId = requireAnnotView(this.ctx);
    if (!viewId) return;
    const p = viewPoint(this.ctx, ev, this.start);
    if (!p) return;
    if (!this.start) {
      this.start = p;
      return;
    }
    if (Math.hypot(p.x - this.start.x, p.y - this.start.y) < 1) return;
    const { doc } = this.ctx;
    const a = this.start;
    const line = doc.transact("Create detail line", (tx) => createDetailLine(tx, doc, viewId, a, p));
    this.ctx.setSelection([line.id]);
    this.start = p;
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key === "Escape" && this.start) {
      this.start = null;
      this.ctx.viewport.setPreviewLines(null);
      return true;
    }
    return false;
  }
}

/** Text: click to place a note, then edit its text in Properties. */
export class TextTool implements Tool {
  readonly name = "text";
  constructor(private ctx: ToolContext) {}

  activate(): void {
    this.ctx.status("Text: click to place a note; type its text in Properties.");
  }

  click(ev: PointerEvent): void {
    const viewId = requireAnnotView(this.ctx);
    if (!viewId) return;
    const p = viewPoint(this.ctx, ev, null);
    if (!p) return;
    const { doc } = this.ctx;
    const t = doc.transact("Create text", (tx) => createTextNote(tx, doc, viewId, p, "Text"));
    this.ctx.setSelection([t.id]);
  }
}

/**
 * Aligned dimension (plans): click walls (nearest face), grids or reference planes in turn,
 * then click empty space to place the dimension line. Esc clears the picks.
 */
export class DimensionTool implements Tool {
  readonly name = "dimension";
  private refs: DimRef[] = [];
  constructor(private ctx: ToolContext) {}

  activate(): void {
    this.refs = [];
    this.ctx.status("Dimension: click walls, grids or reference planes, then click empty space to place.");
  }

  deactivate(): void {
    this.refs = [];
  }

  click(ev: PointerEvent): void {
    const viewId = requireAnnotView(this.ctx);
    if (!viewId) return;
    const { doc, viewport } = this.ctx;
    if (viewport.viewMode === "drawing") return this.clickDrawing(ev, viewId);
    const pickable = new Set<string>([Cat.Wall, Cat.Grid, Cat.ReferencePlane]);
    const hit = viewport.pickHit(ev, (id) => pickable.has(doc.get(id)?.category ?? ""));
    if (hit) {
      const el = doc.require(hit.id);
      if (el.category === Cat.Wall) {
        const w = el as Wall;
        const { start, end } = w.params;
        const len = Math.hypot(end.x - start.x, end.y - start.y);
        const off = ((end.x - start.x) * (hit.point.y - start.y) - (end.y - start.y) * (hit.point.x - start.x)) / len;
        const half = totalThickness(doc.require<LayeredTypeParams>(w.typeId!)) / 2;
        // Nearest of the two faces and the centreline.
        const side = Math.abs(off) < half / 3 ? "centre" : off > 0 ? "left" : "right";
        this.refs.push({ kind: "wallFace", id: w.id, side, pick: hit.point });
      } else {
        this.refs.push({ kind: "datum", id: el.id, pick: hit.point });
      }
      this.ctx.setSelection(this.refs.flatMap((r) => (r.kind === "point" ? [] : [r.id])));
      this.ctx.status(`Dimension: ${this.refs.length} reference(s). Click more, or click empty space to place.`);
      return;
    }
    if (this.refs.length < 2) return this.ctx.status("Dimension: pick at least two walls, grids or reference planes first.");
    const at = viewPoint(this.ctx, ev, null);
    if (!at) return;
    const refs = this.refs;
    this.refs = [];
    try {
      const dim = doc.transact("Create dimension", (tx) => createDimension(tx, doc, viewId, refs, at));
      this.ctx.setSelection([dim.id]);
      this.activate();
    } catch (err) {
      this.ctx.status(`\u26a0 ${(err as Error).message}`);
    }
  }

  /**
   * Sections and elevations: levels (horizontal), grids and walls where the view crosses them
   * (vertical) stay live; anything else is a fixed point on the drawing.
   */
  private clickDrawing(ev: PointerEvent, viewId: ElementId): void {
    const { doc, viewport } = this.ctx;
    const p = viewport.pickDrawing(ev);
    if (!p) return;
    const tol = viewport.mmPerPixel() * 8;
    const view = doc.get<ViewParams>(viewId);
    const line = view?.params.line;
    const say = () => this.ctx.status(`Dimension: ${this.refs.length} reference(s). Click more, or click empty space (Enter) to place.`);
    // A level line?
    const lvl = doc.byCategory<LevelParams>(Cat.Level).find((l) => Math.abs(l.params.elevation - p.y) < tol);
    if (lvl) {
      this.refs.push({ kind: "level", id: lvl.id, pick: p });
      return say();
    }
    // A grid or a wall face crossing the view?
    const crossingRef = (ref: DimRef): number | null => {
      try {
        return resolveRef(doc, ref, viewId).point.x;
      } catch {
        return null;
      }
    };
    if (line) {
      for (const g of doc.byCategory(Cat.Grid)) {
        const ref: DimRef = { kind: "datum", id: g.id, pick: p };
        const x = crossingRef(ref);
        if (x !== null && Math.abs(x - p.x) < tol) {
          this.refs.push(ref);
          return say();
        }
      }
      const hit = viewport.pickHit(ev, (id) => doc.get(id)?.category === Cat.Wall);
      if (hit) {
        const sides = (["left", "centre", "right"] as const)
          .map((side) => ({ side, x: crossingRef({ kind: "wallFace", id: hit.id, side, pick: p }) }))
          .filter((s): s is { side: "left" | "centre" | "right"; x: number } => s.x !== null)
          .sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x));
        if (sides[0] && Math.abs(sides[0].x - p.x) < tol * 3) {
          this.refs.push({ kind: "wallFace", id: hit.id, side: sides[0].side, pick: p });
          return say();
        }
      }
    }
    // Two or more references and a click away from them: place the dimension there.
    if (this.refs.length >= 2) return this.place(viewId, p);
    // Otherwise a fixed point (snapped to the drawing's increments).
    const q = viewPoint(this.ctx, ev, null) ?? p;
    this.refs.push({ kind: "point", at: q });
    say();
  }

  private place(viewId: ElementId, at: Vec2): void {
    const { doc } = this.ctx;
    const refs = this.refs;
    this.refs = [];
    try {
      // Points only: measure the way they're furthest apart.
      const lineRef = refs.some((r) => r.kind !== "point");
      let dir: Vec2 | undefined;
      if (!lineRef) {
        const a = refPoint(doc, refs[0]!, viewId);
        const b = refPoint(doc, refs[refs.length - 1]!, viewId);
        dir = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? { x: 1, y: 0 } : { x: 0, y: 1 };
      }
      const dim = doc.transact("Create dimension", (tx) => createDimension(tx, doc, viewId, refs, at, dir ? { dir } : {}));
      this.ctx.setSelection([dim.id]);
      this.activate();
    } catch (err) {
      this.ctx.status(`\u26a0 ${(err as Error).message}`);
    }
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key === "Escape" && this.refs.length) {
      this.refs = [];
      this.ctx.setSelection([]);
      this.activate();
      return true;
    }
    return false;
  }
}

// ---- Family editor ------------------------------------------------------------------

/**
 * The work plane a family sketch lies on, from the active view: plans sketch on XY; the Front
 * elevation on XZ (u = x, v = z); side elevations on YZ (u = y, v = z).
 */
export function sketchPlane(ctx: ToolContext): { plane: WorkPlane; toPlane: (p: Vec2) => Vec2; depth: number } {
  const v = ctx.activeViewId() ? ctx.doc.get(ctx.activeViewId()!) : undefined;
  const view = v as View | undefined;
  if (view && (view.params.kind === "section" || view.params.kind === "elevation")) {
    const f = viewFrame(view);
    const front = Math.abs(f.dir[1]) >= Math.abs(f.dir[0]);
    return {
      plane: { kind: front ? "XZ" : "YZ", offset: 0 },
      toPlane: (p) => ({ x: front ? f.origin[0] + f.right[0] * p.x : f.origin[1] + f.right[1] * p.x, y: p.y }),
      depth: 300,
    };
  }
  return { plane: { kind: "XY", offset: 0 }, toPlane: (p) => p, depth: 1000 };
}

/** Sweep: click the path in plan, Enter to finish; a 50 x 50 profile is swept along it (edit in Properties). */
export class SweepTool implements Tool {
  readonly name = "sweep";
  private path: Vec2[] = [];
  constructor(private ctx: ToolContext) {}

  activate(): void {
    this.path = [];
    this.ctx.status("Sweep: click the path points in plan, then Enter. The profile is edited in Properties.");
  }

  deactivate(): void {
    this.path = [];
    this.ctx.viewport.setPreviewLines(null);
  }

  pointerMove(ev: PointerEvent): void {
    const p = viewPoint(this.ctx, ev, this.path.at(-1) ?? null, this.path);
    if (!p || !this.path.length) return;
    const pts = [...this.path, p];
    const seg = pts.slice(1).flatMap((q, i) => [pts[i]!.x, pts[i]!.y, 0, q.x, q.y, 0]);
    this.ctx.viewport.setPreviewLines({ segments: new Float32Array(seg), labels: [] });
  }

  click(ev: PointerEvent): void {
    const p = viewPoint(this.ctx, ev, this.path.at(-1) ?? null, this.path);
    if (p) this.path.push(p);
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key === "Enter") {
      const { doc } = this.ctx;
      try {
        if (this.path.length < 2) throw new Error("Click at least two path points first");
        const path = this.path.map((q) => ({ x: Math.round(q.x), y: Math.round(q.y) }));
        const profile: NumPt[] = [{ x: -25, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 50 }, { x: -25, y: 50 }];
        const s = doc.transact("Create sweep", (tx) => createSweep(tx, path, profile, { isVoid: this.ctx.formIsVoid() }));
        this.ctx.setSelection([s.id]);
        this.activate();
      } catch (err) {
        this.ctx.status(`\u26a0 ${(err as Error).message}`);
      }
      this.ctx.viewport.setPreviewLines(null);
      return true;
    }
    if (ev.key === "Escape" && this.path.length) {
      this.activate();
      this.ctx.viewport.setPreviewLines(null);
      return true;
    }
    return false;
  }
}

/** Component: place the selected family type; hosted families go in a wall. Space rotates 90 degrees. */
/** Family categories placed at ceiling height. */
const CEILING_FAMILIES = new Set<string>(["AirTerminal", "LightingFixture"]);

export class ComponentTool implements Tool {
  readonly name = "component";
  private rotation = 0;
  constructor(private ctx: ToolContext) {}

  activate(): void {
    const c = this.ctx.activeComponent();
    if (!c) return this.ctx.status("Component: load a family first (Project Browser \u2192 Families).");
    const def = this.ctx.doc.get(c.familyId) as FamilyDef | undefined;
    const hosted = def?.params.hosting === "wall";
    this.ctx.status(`Component ${def?.name} : ${c.typeName} \u2014 click ${hosted ? "a wall" : "to place; Space rotates 90\u00b0"}.`);
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key === " ") {
      this.rotation = (this.rotation + Math.PI / 2) % (2 * Math.PI);
      this.ctx.status(`Component rotation ${Math.round((this.rotation * 180) / Math.PI)}\u00b0`);
      return true;
    }
    return false;
  }

  click(ev: PointerEvent): void {
    const c = this.ctx.activeComponent();
    if (!c) return this.activate();
    const { doc, viewport } = this.ctx;
    const def = doc.require(c.familyId) as FamilyDef;
    try {
      let inst;
      if (def.params.hosting === "wall") {
        const hit = viewport.pickHit(ev, (id) => doc.get(id)?.category === Cat.Wall);
        if (!hit) return this.ctx.status("Component: click on a wall.");
        const wall = doc.require<WallParams>(hit.id) as Wall;
        const width = familyValues(familyDocument(def), c.typeName)["Width"] ?? 0;
        const len = wallLength(wall);
        const along = Math.round(Math.min(Math.max(positionAlongWall(wall, hit.point), width / 2), len - width / 2));
        inst = doc.transact("Place component", (tx) => placeFamilyInstance(tx, doc, def.id, c.typeName, { hostId: wall.id, along }));
      } else {
        const p = viewPoint(this.ctx, ev, null);
        if (!p) return;
        const levelId = this.ctx.activeLevelId();
        inst = doc.transact("Place component", (tx) =>
          // Air terminals and light fittings go on the ceiling (2400 above the level; change Offset).
          placeFamilyInstance(tx, doc, def.id, c.typeName, { levelId, position: p, rotation: this.rotation, offset: CEILING_FAMILIES.has(def.params.category) ? 2400 : 0 }),
        );
      }
      this.ctx.setSelection([inst.id]);
    } catch (err) {
      this.ctx.status(`\u26a0 ${(err as Error).message}`);
    }
  }
}
