import {
  alongArc,
  arcMid,
  arcLength,
  tangentLine,
  Cat,
  columnExtent,
  curtainOf,
  dragGrip,
  setCurtainEdits,
  elementGrips,
  flipWall,
  isPinned,
  setPinned,
  hostedClearances,
  setHostedClearance,
  wallClearances,
  setWallClearance,
  pointClearances,
  setPointClearance,
  createDimension,
  type DimRef,
  floorExtent,
  lineLength,
  setLineLength,
  setVerticalEdge,
  verticalHandles,
  viewFrame,
  wallExtent,
  wallThickness,
  type Column,
  type Document,
  type Floor,
  type LevelParams,
  type View,
  type ViewParams,
  type Wall,
  type Element,
  type ElementId,
  type Grip,
  type Vec2,
  type Transaction,
} from "@open-bim/core";
import { curtainExtent, curtainGridLines } from "@open-bim/geometry";
import { snapPoint, viewPoint, type ToolContext } from "./tools.ts";

// Grips and temporary dimensions over the viewport (Revit's drag controls). Shown for the
// selection while the Select tool is active, in plans (model elements and the plan's annotations)
// and in sections/sheets (that view's annotations and viewports), and in 3D (model elements: grips on
// their base, plus shape handles to drag a wall's or column's top and base up and down).
// Drag a grip to reshape; click a wall's or line's length to type a new one.

/** Height (mm) a plan grip of `el` sits at in 3D: its base (a floor's top), or a run end's own height. */
function gripZ(doc: Document, el: Element, key?: string): number {
  const p = el.params as Record<string, unknown>;
  const level = (id: unknown) => (typeof id === "string" ? (doc.get<LevelParams>(id)?.params.elevation ?? 0) : 0);
  if (el.category === Cat.Wall) return wallExtent(doc, el as Wall).bottom;
  if (el.category === Cat.Column) return columnExtent(doc, el as Column).bottom;
  if (el.category === Cat.Floor) return floorExtent(doc, el as Floor).top;
  const host = typeof p.hostId === "string" ? doc.get(p.hostId) : undefined;
  if (host && host.id !== el.id && host.category === Cat.Wall) return wallExtent(doc, host as Wall).bottom + Number(p.sillHeight ?? 0);
  const end = key === "start" || key === "end" ? (p[key] as { z?: number } | undefined) : undefined;
  if (typeof end?.z === "number") return level(p.levelId) + end.z;
  const off = [p.offset, p.baseOffset, p.heightOffset].find((v) => typeof v === "number") as number | undefined;
  return level(p.levelId ?? p.baseLevelId) + (off ?? 0);
}

/** More selected than this and grips are left off (as Revit does for big selections). */
const MAX_ELEMENTS = 30;

interface Placed {
  el: HTMLElement;
  at: () => Vec2;
  /** Height in 3D views (plans and drawings use the work plane). */
  z?: () => number;
}

export class GripLayer {
  private root: HTMLDivElement;
  private placed: Placed[] = [];
  private enabled = true;
  private dragging = false;

  constructor(
    private ctx: ToolContext,
    host: HTMLElement,
  ) {
    this.root = document.createElement("div");
    this.root.className = "grip-layer";
    host.append(this.root);
    ctx.viewport.onFrame(() => this.position());
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.refresh();
  }

  /** Elements whose grips this view can show. */
  private editable(el: Element): boolean {
    const mode = this.ctx.viewport.viewMode;
    const p = el.params as { viewId?: unknown; sheetId?: unknown };
    const view = this.ctx.activeViewId();
    if (mode === "3d") return p.viewId === undefined && p.sheetId === undefined;
    if (mode === "drawing") return p.viewId === view || p.sheetId === view;
    return p.viewId === undefined || p.viewId === view;
  }

  /** Rebuild for the current selection (after selection or model changes). */
  refresh(): void {
    if (this.dragging) return;
    this.root.replaceChildren();
    this.placed = [];
    this.ctx.viewport.setOverlay(null);
    if (!this.enabled) return;
    const { doc } = this.ctx;
    // Sections and elevations: selected model elements get their top/base handles there too.
    if (this.ctx.viewport.viewMode === "drawing" && this.sectionView()) {
      const model = this.ctx.selection().map((id) => doc.get(id)).filter((e): e is Element => !!e && (e.params as { viewId?: unknown }).viewId === undefined && (e.params as { sheetId?: unknown }).sheetId === undefined);
      if (model.length <= MAX_ELEMENTS) for (const el of model) if (!isPinned(el)) this.addHeightHandles(el);
    }
    const sel = this.ctx.selection().map((id) => doc.get(id)).filter((e): e is Element => !!e && this.editable(e));
    if (!sel.length || sel.length > MAX_ELEMENTS) return;
    const in3d = this.ctx.viewport.viewMode === "3d";
    for (const el of sel) {
      // Pinned: a pin to click (unpins) instead of grips.
      if (isPinned(el)) {
        this.addPin(el);
        continue;
      }
      for (const g of elementGrips(doc, el)) this.addGrip(el.id, g);
      if (in3d) this.addHeightHandles(el);
    }
    if (sel.length === 1 && isPinned(sel[0]!)) return this.position();
    if (sel.length === 1) this.addLength(sel[0]!);
    if (sel.length === 1 && this.ctx.viewport.viewMode !== "drawing") this.addClearances(sel[0]!);
    if (sel.length === 1 && this.ctx.viewport.viewMode === "plan" && sel[0]!.category === Cat.Wall) this.addWallClearances(sel[0] as Wall);
    if (sel.length === 1 && this.ctx.viewport.viewMode !== "drawing") this.addPointClearances(sel[0]!);
    if (in3d && sel.length === 1 && sel[0]!.category === Cat.Wall && curtainOf(doc, sel[0]!)) this.addCurtainLines(sel[0] as Wall);
    if (sel.length === 1 && sel[0]!.category === Cat.View) this.showExtent(sel[0] as View);
    if (sel.length === 1 && sel[0]!.category === Cat.Wall && this.ctx.viewport.viewMode !== "drawing") this.addFlip(sel[0]!);
    this.position();
  }

  /** Client point of a grip: on the work plane, or at its own height in 3D. */
  private screen(at: Vec2, z?: number): { x: number; y: number } {
    return this.ctx.viewport.viewMode === "3d" && z !== undefined ? this.ctx.viewport.toScreen3(at, z) : this.ctx.viewport.toScreen(at);
  }

  private position(): void {
    for (const p of this.placed) {
      const s = this.screen(p.at(), p.z?.());
      const r = this.root.getBoundingClientRect();
      p.el.style.left = `${s.x - r.left}px`;
      p.el.style.top = `${s.y - r.top}px`;
    }
  }

  private addGrip(id: ElementId, g: Grip): void {
    const el = document.createElement("div");
    el.className = `grip grip-${g.kind}`;
    el.title = g.kind === "move" ? "Drag to move" : "Drag to reshape";
    let at = g.point;
    const owner = this.ctx.doc.get(id);
    const z = owner ? gripZ(this.ctx.doc, owner, g.key) : 0;
    const in3d = this.ctx.viewport.viewMode === "3d";
    el.onpointerdown = (ev) => {
      if (ev.button !== 0) return;
      ev.stopPropagation();
      ev.preventDefault();
      el.setPointerCapture(ev.pointerId);
      this.dragging = true;
      const from = g.point;
      el.onpointermove = (mv) => {
        // 3D: on the horizontal plane through the grip (its base), snapped as in plans.
        const raw = in3d ? this.ctx.viewport.pickPlane(mv, z) : null;
        const p = in3d ? raw && snapPoint(this.ctx, raw, null, mv.shiftKey).p : viewPoint(this.ctx, mv, null);
        if (!p) return;
        at = p;
        this.position();
        if (!in3d) this.ctx.viewport.setPreviewLines({ segments: new Float32Array([from.x, from.y, 0, p.x, p.y, 0]), labels: [] });
        this.ctx.status(`Drag: ${Math.round(Math.hypot(p.x - from.x, p.y - from.y))} mm`);
      };
      el.onpointerup = () => {
        el.onpointermove = null;
        el.onpointerup = null;
        this.dragging = false;
        this.ctx.viewport.setPreviewLines(null);
        const to = at;
        at = g.point;
        if (Math.hypot(to.x - from.x, to.y - from.y) < 0.5) return this.refresh();
        try {
          this.ctx.doc.transact("Drag", (tx) => dragGrip(tx, this.ctx.doc, id, g.key, to, this.ctx.selection()));
          this.ctx.status("Dragged. Ctrl+Z to undo.");
        } catch (e) {
          this.ctx.status(`⚠ ${(e as Error).message}`);
        }
        this.refresh();
      };
    };
    this.root.append(el);
    this.placed.push({ el, at: () => at, z: () => z });
  }

  /**
   * A curtain wall's interior grid lines in 3D: a grip on each (verticals at mid-height,
   * horizontals at mid-length); drag along the wall or up and down to move the line.
   */
  private addCurtainLines(wall: Wall): void {
    const { doc } = this.ctx;
    const grid = curtainOf(doc, wall);
    if (!grid) return;
    const { start, end, curve } = wall.params;
    // Along the location line (arcs: along the arc).
    const len = curve ? arcLength(start, end, curve) : Math.hypot(end.x - start.x, end.y - start.y);
    if (len < 1) return;
    const { bottom, top } = curtainExtent(doc, wall);
    const edits = wall.params.curtainEdits ?? {};
    const { u: us, z: zs } = curtainGridLines(len, bottom, top, grid, edits);
    const uIn = us.slice(1, -1);
    const zIn = zs.slice(1, -1).map((z) => z - bottom);
    const point = (u: number): Vec2 => {
      const t = tangentLine(wall, u);
      return { x: t.start.x + t.dir.x * u, y: t.start.y + t.dir.y * u };
    };
    const alongOf = (p: Vec2): number => {
      if (curve) return alongArc(start, end, curve, p);
      const d = { x: (end.x - start.x) / len, y: (end.y - start.y) / len };
      return (p.x - start.x) * d.x + (p.y - start.y) * d.y;
    };
    const save = (uLines: number[], zLines: number[]) => {
      try {
        doc.transact("Move grid line", (tx) => setCurtainEdits(tx, doc, wall.id, { ...edits, uLines, zLines }));
        this.ctx.status("Grid line moved. Ctrl+Z to undo.");
      } catch (e) {
        this.ctx.status(`⚠ ${(e as Error).message}`);
      }
      this.refresh();
    };
    const line = (axis: "u" | "z", k: number) => {
      const el = document.createElement("div");
      el.className = "grip grip-line";
      el.title = axis === "u" ? "Drag to move this grid line along the wall" : "Drag to move this grid line up or down";
      let u = axis === "u" ? uIn[k]! : len / 2;
      let z = axis === "z" ? bottom + zIn[k]! : (bottom + top) / 2;
      el.onpointerdown = (ev) => {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        ev.preventDefault();
        el.setPointerCapture(ev.pointerId);
        this.dragging = true;
        const [u0, z0] = [u, z];
        el.onpointermove = (mv) => {
          if (axis === "u") {
            const p = this.ctx.viewport.pickPlane(mv, z);
            if (!p) return;
            const t = alongOf(p);
            // Between its neighbours (100 mm clear), as Revit keeps grid lines in order.
            const lo = (k > 0 ? uIn[k - 1]! : 0) + 100;
            const hi = (k + 1 < uIn.length ? uIn[k + 1]! : len) - 100;
            u = Math.min(hi, Math.max(lo, mv.shiftKey ? t : Math.round(t / 10) * 10));
            this.ctx.status(`Grid line at ${Math.round(u)} mm from the start (${u - u0 >= 0 ? "+" : ""}${Math.round(u - u0)}). Shift: no snapping.`);
          } else {
            const v = this.ctx.viewport.pickVertical(mv, point(u));
            if (v === null) return;
            const lo = bottom + (k > 0 ? zIn[k - 1]! : 0) + 100;
            const hi = bottom + (k + 1 < zIn.length ? zIn[k + 1]! : top - bottom) - 100;
            z = Math.min(hi, Math.max(lo, mv.shiftKey ? v : Math.round(v / 10) * 10));
            this.ctx.status(`Grid line at ${Math.round(z - bottom)} mm above the base (${z - z0 >= 0 ? "+" : ""}${Math.round(z - z0)}). Shift: no snapping.`);
          }
          this.position();
        };
        el.onpointerup = () => {
          el.onpointermove = null;
          el.onpointerup = null;
          this.dragging = false;
          if (Math.abs(u - u0) < 0.5 && Math.abs(z - z0) < 0.5) return this.refresh();
          if (axis === "u") save(uIn.map((x, i) => (i === k ? u : x)), zIn);
          else save(uIn, zIn.map((x, i) => (i === k ? z - bottom : x)));
        };
      };
      this.root.append(el);
      this.placed.push({ el, at: () => point(u), z: () => z });
    };
    uIn.forEach((_, k) => line("u", k));
    zIn.forEach((_, k) => line("z", k));
  }

  /**
   * Temporary dimensions for a selected door, window or opening (Revit's): the clearance to the
   * nearest wall face either side; click one to type a new distance and move it.
   */
  private addClearances(el: Element): void {
    const { doc } = this.ctx;
    const c = hostedClearances(doc, el);
    if (!c) return;
    const host = doc.get(c.hostId) as Wall | undefined;
    if (!host) return;
    const { start, end } = host.params;
    const L = Math.hypot(end.x - start.x, end.y - start.y);
    const d = { x: (end.x - start.x) / L, y: (end.y - start.y) / L };
    const n = { x: -d.y, y: d.x };
    const half = wallThickness(doc, host) / 2;
    const z = gripZ(doc, host);
    for (const side of ["left", "right"] as const) {
      const s = c[side];
      if (!Number.isFinite(s.dist)) continue;
      const mid = side === "left" ? (s.stop + c.u - c.half) / 2 : (c.u + c.half + s.stop) / 2;
      const label = document.createElement("div");
      label.className = "temp-dim temp-dim-side";
      label.textContent = `${Math.round(s.dist)}`;
      label.title = "Click to type the distance to this wall face";
      label.onpointerdown = (ev) => ev.stopPropagation();
      this.editOnClick(label, s.dist, "Change clearance", (tx, v) => setHostedClearance(tx, doc, el.id, side, v));
      this.root.append(label);
      this.placed.push({
        el: label,
        at: () => {
          const off = half + 16 * this.ctx.viewport.mmPerPixel();
          return { x: start.x + d.x * mid - n.x * off, y: start.y + d.y * mid - n.y * off };
        },
        z: () => z,
      });
    }
  }

  /** A selected wall's temporary dimensions: centreline distance to the nearest parallel wall each side. */
  private addWallClearances(wall: Wall): void {
    const { doc } = this.ctx;
    const c = wallClearances(doc, wall);
    const { start, end } = wall.params;
    const L = Math.hypot(end.x - start.x, end.y - start.y);
    if (L < 1) return;
    const n = { x: -(end.y - start.y) / L, y: (end.x - start.x) / L };
    const z = gripZ(doc, wall);
    for (const side of ["left", "right"] as const) {
      const s = c[side];
      if (!s) continue;
      // Where the two walls overlap: its middle, or a third of the way when that's the wall's middle
      // (clear of the length label and flip arrow).
      let f = (s.u0 + s.u1) / 2 / L;
      if (Math.abs(f - 0.5) < 0.1) f = (s.u0 + (s.u1 - s.u0) / 3) / L;
      const base = { x: start.x + (end.x - start.x) * f, y: start.y + (end.y - start.y) * f };
      const sign = side === "left" ? 1 : -1;
      const at = { x: base.x + n.x * sign * (s.dist / 2), y: base.y + n.y * sign * (s.dist / 2) };
      const label = document.createElement("div");
      label.className = "temp-dim";
      label.textContent = `${Math.round(s.dist)}`;
      label.title = "Distance to the parallel wall (centrelines): click to type a new one; this wall moves";
      label.onpointerdown = (ev) => ev.stopPropagation();
      this.editOnClick(label, s.dist, "Change wall distance", (tx, v) => setWallClearance(tx, doc, wall.id, side, v));
      this.root.append(label);
      this.placed.push({ el: label, at: () => at, z: () => z });
      const other = doc.get(s.otherId) as Wall | undefined;
      if (other) {
        const os = other.params.start;
        const oe = other.params.end;
        const ol = Math.hypot(oe.x - os.x, oe.y - os.y) || 1;
        const od = { x: (oe.x - os.x) / ol, y: (oe.y - os.y) / ol };
        const t = (base.x - os.x) * od.x + (base.y - os.y) * od.y;
        const onOther = { x: os.x + od.x * t, y: os.y + od.y * t };
        this.addPermanent(at, [
          { kind: "wallFace", id: wall.id, side: "centre", pick: base },
          { kind: "wallFace", id: other.id, side: "centre", pick: onOther },
        ]);
      }
    }
  }

  /** A column's or free-standing family's temporary dimensions: to the nearest grid each way. */
  private addPointClearances(el: Element): void {
    const { doc } = this.ctx;
    const at = (el.params as { position?: Vec2 }).position;
    if (!at) return;
    const z = gripZ(doc, el);
    for (const c of pointClearances(doc, el)) {
      // Halfway between the element and the grid.
      const mid = { x: at.x - (c.normal.x * c.dist) / 2, y: at.y - (c.normal.y * c.dist) / 2 };
      const label = document.createElement("div");
      label.className = "temp-dim";
      label.textContent = `${Math.round(c.dist)}`;
      label.title = "Distance to the grid: click to type a new one";
      label.onpointerdown = (ev) => ev.stopPropagation();
      this.editOnClick(label, c.dist, "Change distance to grid", (tx, v) => setPointClearance(tx, doc, el.id, c.gridId, v));
      this.root.append(label);
      this.placed.push({ el: label, at: () => mid, z: () => z });
      this.addPermanent(mid, [
        { kind: "datum", id: c.gridId, pick: { x: at.x - c.normal.x * c.dist, y: at.y - c.normal.y * c.dist } },
        { kind: "elementPoint", id: el.id },
      ]);
    }
  }

  /** Revit's "make this temporary dimension permanent" button under a temporary dimension (plans only). */
  private addPermanent(at: Vec2, refs: DimRef[]): void {
    const viewId = this.ctx.activeViewId();
    if (this.ctx.viewport.viewMode !== "plan" || !viewId) return;
    const b = document.createElement("button");
    b.className = "temp-dim-permanent";
    b.textContent = "↦";
    b.title = "Make this temporary dimension permanent";
    b.onpointerdown = (ev) => ev.stopPropagation();
    b.onclick = () => {
      try {
        this.ctx.doc.transact("Make dimension permanent", (tx) => createDimension(tx, this.ctx.doc, viewId, refs, at));
        this.ctx.status("Dimension placed.");
      } catch (e) {
        this.ctx.status(`⚠ ${(e as Error).message}`);
      }
    };
    this.root.append(b);
    this.placed.push({ el: b, at: () => at });
  }

  /** Click a temporary dimension to type a new value (Enter applies; Esc, an empty box or leaving cancels). */
  private editOnClick(label: HTMLElement, value: number, name: string, apply: (tx: Transaction, v: number) => void): void {
    label.onclick = () => {
      const input = document.createElement("input");
      input.type = "number";
      input.value = String(Math.round(value));
      label.replaceChildren(input);
      input.focus();
      input.select();
      input.onkeydown = (ev) => {
        ev.stopPropagation();
        if (ev.key === "Escape") return this.refresh();
        if (ev.key !== "Enter") return;
        const v = input.value.trim() === "" ? NaN : Number(input.value);
        if (!Number.isFinite(v)) return this.refresh();
        try {
          this.ctx.doc.transact(name, (tx) => apply(tx, v));
        } catch (e) {
          this.ctx.status(`⚠ ${(e as Error).message}`);
        }
        this.refresh();
      };
      input.onblur = () => this.refresh();
    };
  }

  /** A pinned element's pin (Revit's pushpin): click it to unpin. */
  private addPin(target: Element): void {
    const { doc } = this.ctx;
    const g = elementGrips(doc, target)[0];
    const h = verticalHandles(doc, target);
    const at = g?.point ?? h?.at;
    if (!at) return;
    const b = document.createElement("button");
    b.className = "pin-marker";
    b.textContent = "\u{1F4CC}";
    b.title = "Pinned: click to unpin (UP)";
    b.onpointerdown = (ev) => ev.stopPropagation();
    b.onclick = () => {
      try {
        doc.transact("Unpin", (tx) => setPinned(tx, doc, [target.id], false));
        this.ctx.status("Unpinned.");
      } catch (e) {
        this.ctx.status(`⚠ ${(e as Error).message}`);
      }
      this.refresh();
    };
    const z = gripZ(doc, target, g?.key);
    this.root.append(b);
    this.placed.push({ el: b, at: () => at, z: () => z });
  }

  /** The open section/elevation (a view with a cut line), if that's what the viewport shows. */
  private sectionView(): View | null {
    const id = this.ctx.activeViewId();
    const v = id ? this.ctx.doc.get(id) : undefined;
    return v && v.category === Cat.View && (v as View).params.line ? (v as View) : null;
  }

  /** Shape handles in 3D: arrows on a wall's or column's top and base; drag up or down. */
  private addHeightHandles(target: Element): void {
    const h = verticalHandles(this.ctx.doc, target);
    if (!h) return;
    // In a section or elevation the handles sit in its drawing (x along the view, y = height).
    const view = this.ctx.viewport.viewMode === "drawing" ? this.sectionView() : null;
    if (this.ctx.viewport.viewMode === "drawing" && !view) return;
    const f = view ? viewFrame(view) : null;
    const across = f ? (h.at.x - f.origin[0]) * f.right[0] + (h.at.y - f.origin[1]) * f.right[1] : 0;
    const both = h.top !== null && h.bottom !== null;
    for (const edge of ["top", "base"] as const) {
      const start = edge === "top" ? h.top : h.bottom;
      if (start === null) continue;
      const el = document.createElement("div");
      el.className = `shape-handle shape-${edge}`;
      // One handle (floors, ceilings, roofs, families): it moves the whole element up and down.
      el.textContent = both ? (edge === "top" ? "\u25B2" : "\u25BC") : "\u2B0D";
      el.title = !both ? "Drag to move up or down" : edge === "top" ? "Drag to change the top" : "Drag to change the base";
      let z = start;
      el.onpointerdown = (ev) => {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        ev.preventDefault();
        el.setPointerCapture(ev.pointerId);
        this.dragging = true;
        const from = z;
        el.onpointermove = (mv) => {
          const v = f ? (this.ctx.viewport.pickDrawing(mv)?.y ?? null) : this.ctx.viewport.pickVertical(mv, h.at);
          if (v === null) return;
          // Snap to 10 mm (Shift: free), and to levels within 150 mm.
          let q = mv.shiftKey ? v : Math.round(v / 10) * 10;
          for (const l of this.ctx.doc.byCategory<LevelParams>(Cat.Level)) if (!mv.shiftKey && Math.abs(l.params.elevation - v) < 150) q = l.params.elevation;
          z = q;
          this.position();
          this.ctx.status(`${edge === "top" ? "Top" : "Base"}: ${Math.round(q)} (${q - from >= 0 ? "+" : ""}${Math.round(q - from)} mm). Shift: no snapping.`);
        };
        el.onpointerup = () => {
          el.onpointermove = null;
          el.onpointerup = null;
          this.dragging = false;
          if (Math.abs(z - from) < 0.5) return this.refresh();
          try {
            this.ctx.doc.transact(edge === "top" ? "Drag top" : "Drag base", (tx) => setVerticalEdge(tx, this.ctx.doc, target.id, edge, z));
            this.ctx.status("Changed. Ctrl+Z to undo.");
          } catch (e) {
            this.ctx.status(`\u26A0 ${(e as Error).message}`);
          }
          this.refresh();
        };
      };
      this.root.append(el);
      this.placed.push(f ? { el, at: () => ({ x: across, y: z }) } : { el, at: () => h.at, z: () => z });
    }
  }

  /** A section's or elevation's view extent: dashed outline (line to far clip) with a light hatch. */
  private showExtent(v: View): void {
    const p = v.params as ViewParams;
    if (!p.line || this.ctx.viewport.viewMode !== "plan") return;
    const f = viewFrame(v);
    const dir = { x: f.dir[0], y: f.dir[1] };
    const { start, end } = p.line;
    const L = Math.hypot(end.x - start.x, end.y - start.y);
    const F = p.farClip ?? 0;
    if (L < 1 || F < 1) return;
    const u = { x: (end.x - start.x) / L, y: (end.y - start.y) / L };
    const at = (a: number, b: number) => [start.x + u.x * a + dir.x * b, start.y + u.y * a + dir.y * b, 0];
    const outline = [...at(0, 0), ...at(L, 0), ...at(L, 0), ...at(L, F), ...at(L, F), ...at(0, F), ...at(0, F), ...at(0, 0)];
    // 45° hatch, spaced for the zoom: lines a - b = c clipped to the rectangle.
    const step = Math.max(50, this.ctx.viewport.mmPerPixel() * 14);
    // Keep the hatch out of the marker bubbles (section head before the start; elevation mark).
    const holes = [p.kind === "elevation" ? (p.marker ?? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }) : { x: start.x - u.x * 400, y: start.y - u.y * 400 }];
    const hatch: number[] = [];
    for (let c = -F + step; c < L; c += step) {
      const b0 = Math.max(0, -c);
      const b1 = Math.min(F, L - c);
      if (b1 > b0) hatch.push(...clipCircles(at(c + b0, b0), at(c + b1, b1), holes, 480));
    }
    this.ctx.viewport.setOverlay([
      { lines: { segments: new Float32Array(hatch), labels: [] }, color: 0xb9c9dc },
      { lines: { segments: new Float32Array(outline), labels: [], dashed: true }, color: 0x2f7de1 },
    ]);
  }

  /** Revit's flip arrows: on the wall's exterior side; click to swap the exterior face. */
  private addFlip(wall: Element): void {
    const { start, end } = wall.params as unknown as { start: Vec2; end: Vec2 };
    const len = Math.hypot(end.x - start.x, end.y - start.y);
    if (len < 1) return;
    // Exterior is to the left of start → end.
    const n = { x: -(end.y - start.y) / len, y: (end.x - start.x) / len };
    const curve = (wall.params as { curve?: number | null }).curve ?? 0;
    // On an arc, its middle (where its normal is the chord's).
    const mid = curve ? arcMid(start, end, curve) : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const half = wallThickness(this.ctx.doc, wall as never) / 2;
    const b = document.createElement("button");
    b.className = "flip-arrow";
    b.textContent = "⇅";
    b.title = "Flip: swap the wall's exterior side";
    b.onpointerdown = (ev) => ev.stopPropagation();
    b.onclick = () => {
      try {
        this.ctx.doc.transact("Flip wall", (tx) => flipWall(tx, this.ctx.doc, wall.id));
      } catch (e) {
        this.ctx.status(`⚠ ${(e as Error).message}`);
      }
      this.refresh();
    };
    const at = () => {
      const off = half + 22 * this.ctx.viewport.mmPerPixel();
      return { x: mid.x + n.x * off, y: mid.y + n.y * off };
    };
    // Point the arrows across the wall, as drawn on screen.
    const z = gripZ(this.ctx.doc, wall);
    const a = this.screen(mid, z);
    const c = this.screen({ x: mid.x + n.x * 1000, y: mid.y + n.y * 1000 }, z);
    b.style.rotate = `${Math.atan2(c.y - a.y, c.x - a.x) * (180 / Math.PI) + 90}deg`;
    this.root.append(b);
    this.placed.push({ el: b, at, z: () => z });
  }

  /** Temporary dimension: the length at the line's midpoint; click to type a new length. */
  private addLength(el: Element): void {
    const chord = lineLength(el);
    if (chord === null) return;
    const { start, end, curve } = el.params as unknown as { start: Vec2; end: Vec2; curve?: number | null };
    const mid = curve ? arcMid(start, end, curve) : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const len = curve ? arcLength(start, end, curve) : chord;
    const label = document.createElement("div");
    label.className = "temp-dim";
    label.textContent = `${Math.round(len)}`;
    label.title = curve ? "Arc length (drag the middle grip to change the bow)" : "Click to type a new length (the start stays put)";
    label.onpointerdown = (ev) => ev.stopPropagation();
    label.onclick = () => {
      if (curve) return;
      const input = document.createElement("input");
      input.type = "number";
      input.value = String(Math.round(len));
      label.replaceChildren(input);
      input.focus();
      input.select();
      input.onkeydown = (ev) => {
        ev.stopPropagation();
        if (ev.key === "Escape") return this.refresh();
        if (ev.key !== "Enter") return;
        try {
          this.ctx.doc.transact("Change length", (tx) => setLineLength(tx, this.ctx.doc, el.id, Number(input.value)));
        } catch (e) {
          this.ctx.status(`⚠ ${(e as Error).message}`);
        }
        this.refresh();
      };
      input.onblur = () => this.refresh();
    };
    this.root.append(label);
    // Walls: on the interior side, clear of the flip arrows (which sit on the exterior side).
    const L = Math.hypot(end.x - start.x, end.y - start.y);
    const wall = el.category === Cat.Wall && L > 0;
    const n = wall ? { x: -(end.y - start.y) / L, y: (end.x - start.x) / L } : { x: 0, y: 0 };
    const half = wall ? wallThickness(this.ctx.doc, el as never) / 2 : 0;
    if (wall) label.classList.add("temp-dim-side");
    const lz = gripZ(this.ctx.doc, el);
    this.placed.push({
      el: label,
      z: () => lz,
      at: () => {
        const off = half + 16 * this.ctx.viewport.mmPerPixel();
        return { x: mid.x - n.x * off, y: mid.y - n.y * off };
      },
    });
  }
}

/** A segment (x, y, z triples) with the parts inside any circle removed, as flat segment data. */
function clipCircles(a: number[], b: number[], centres: Vec2[], r: number): number[] {
  let parts: [number, number][] = [[0, 1]];
  const dx = b[0]! - a[0]!;
  const dy = b[1]! - a[1]!;
  for (const c of centres) {
    // Solve |a + t·d - c| = r.
    const fx = a[0]! - c.x;
    const fy = a[1]! - c.y;
    const A = dx * dx + dy * dy;
    const B = 2 * (fx * dx + fy * dy);
    const C = fx * fx + fy * fy - r * r;
    const disc = B * B - 4 * A * C;
    if (A === 0 || disc <= 0) continue;
    const t0 = (-B - Math.sqrt(disc)) / (2 * A);
    const t1 = (-B + Math.sqrt(disc)) / (2 * A);
    parts = parts.flatMap(([s, e]): [number, number][] => {
      const out: [number, number][] = [];
      if (t0 > s) out.push([s, Math.min(e, t0)]);
      if (t1 < e) out.push([Math.max(s, t1), e]);
      return out.filter(([x, y]) => y > x);
    });
  }
  return parts.flatMap(([s, e]) => [a[0]! + dx * s, a[1]! + dy * s, 0, a[0]! + dx * e, a[1]! + dy * e, 0]);
}
