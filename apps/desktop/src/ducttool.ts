import {
  Cat,
  SYSTEM_CLASSIFICATIONS,
  createDuct,
  ductTypes,
  elementConnectors,
  ensureDuctTypes,
  type DuctTypeParams,
  type ElementId,
  type LevelParams,
  type ModelConnector,
  type P3,
  type SystemClassification,
  type Vec2,
} from "@open-bim/core";
import type { ToolOption } from "./modifytools.ts";
import { viewPoint, type Tool, type ToolContext } from "./tools.ts";

// Duct (Revit: Systems → Duct): click to route, each click a run; fittings appear by themselves
// (elbows at turns, tees where a run ends on another, transitions between sizes). Change the
// middle elevation between clicks for a riser. Click on a terminal's or equipment's connector to
// start or finish there (taking its height, size and system). Esc ends the run.

/** Connectors within this many pixels of a click snap the duct to them. */
const SNAP_PX = 14;

export class DuctTool implements Tool {
  readonly name = "duct";
  private last: P3 | null = null;
  private diameter = 200;
  private width = 400;
  private height = 250;
  /** Middle elevation above the level, mm. */
  private elevation = 2600;
  private classification: SystemClassification = "supplyAir";

  constructor(private ctx: ToolContext) {}

  activate(): void {
    const { doc } = this.ctx;
    if (!ductTypes(doc).length) doc.transact("Load duct types", (tx) => ensureDuctTypes(tx, doc));
    this.last = null;
    this.showOptions();
    this.ctx.status("Duct: click to route (each click a run; fittings are automatic). Click a connector to join a terminal or unit. Esc ends.");
  }

  deactivate(): void {
    this.last = null;
    this.ctx.viewport.setPreviewLines(null);
    this.ctx.setToolOptions?.(null);
  }

  private typeId(): ElementId | undefined {
    return this.ctx.activeTypeId(Cat.DuctType) ?? ductTypes(this.ctx.doc)[0]?.id;
  }

  private round(): boolean {
    const id = this.typeId();
    return (id ? this.ctx.doc.get<DuctTypeParams>(id)?.params.shape : "round") !== "rectangular";
  }

  private showOptions(): void {
    const opts: ToolOption[] = [
      {
        kind: "select",
        label: "System",
        value: this.classification,
        options: SYSTEM_CLASSIFICATIONS.filter((c) => c.domain === "duct").map((c) => ({ value: c.value, label: c.label })),
        set: (v) => (this.classification = v as SystemClassification),
      },
      ...(this.round()
        ? [{ kind: "number" as const, label: "Diameter", value: this.diameter, min: 50, set: (v: number) => (this.diameter = v || this.diameter) }]
        : [
            { kind: "number" as const, label: "Width", value: this.width, min: 50, set: (v: number) => (this.width = v || this.width) },
            { kind: "number" as const, label: "Height", value: this.height, min: 50, set: (v: number) => (this.height = v || this.height) },
          ]),
      { kind: "number", label: "Middle elevation", value: this.elevation, min: -Infinity, set: (v) => (this.elevation = v) },
    ];
    this.ctx.setToolOptions?.(opts);
  }

  private levelZ(): number {
    return this.ctx.doc.get<LevelParams>(this.ctx.activeLevelId())?.params.elevation ?? 0;
  }

  /** A duct connector near the plan point (not on a duct being drawn from), if any. */
  private snap(p: Vec2): ModelConnector | null {
    const { doc } = this.ctx;
    const tol = SNAP_PX * this.ctx.viewport.mmPerPixel();
    let best: ModelConnector | null = null;
    let bestD = tol;
    for (const el of doc.all()) {
      if (el.category !== Cat.FamilyInstance && el.category !== Cat.Duct) continue;
      for (const c of elementConnectors(doc, el)) {
        if (c.domain !== "duct") continue;
        const d = Math.hypot(c.position[0] - p.x, c.position[1] - p.y);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    return best;
  }

  private point(ev: PointerEvent): { p: P3; snapped: ModelConnector | null } | null {
    const q = viewPoint(this.ctx, ev, this.last ? { x: this.last.x, y: this.last.y } : null);
    if (!q) return null;
    const c = this.snap(q);
    if (c) return { p: { x: c.position[0], y: c.position[1], z: c.position[2] - this.levelZ() }, snapped: c };
    return { p: { x: q.x, y: q.y, z: this.elevation }, snapped: null };
  }

  pointerMove(ev: PointerEvent): void {
    if (!this.last) return;
    const r = this.point(ev);
    if (!r) return;
    this.ctx.viewport.setPreviewLines({ segments: new Float32Array([this.last.x, this.last.y, 0, r.p.x, r.p.y, 0]), labels: [] });
  }

  click(ev: PointerEvent): void {
    if (this.ctx.viewport.viewMode === "drawing") return this.ctx.status("Route ducts in a plan or 3D view.");
    const r = this.point(ev);
    if (!r) return;
    const { doc } = this.ctx;
    // Starting on a connector takes its size and system.
    if (!this.last) {
      if (r.snapped) this.adopt(r.snapped);
      this.last = r.p;
      this.ctx.status(r.snapped ? "Duct: starting at the connector. Click the next point." : "Duct: click the next point.");
      return;
    }
    const typeId = this.typeId();
    if (!typeId) return;
    const from = this.last;
    const to = r.p;
    const opts = { diameter: this.diameter, width: this.width, height: this.height, classification: this.classification };
    const level = this.ctx.activeLevelId();
    try {
      let made: ElementId[] = [];
      doc.transact("Create duct", (tx) => {
        let a = from;
        // A changed middle elevation rises (or drops) at the last point first.
        if (!r.snapped && Math.abs(a.z - to.z) > 1 && Math.hypot(to.x - a.x, to.y - a.y) > 1) {
          const riser = { x: a.x, y: a.y, z: to.z };
          made.push(createDuct(tx, doc, typeId, level, a, riser, opts).id);
          a = riser;
        }
        made.push(createDuct(tx, doc, typeId, level, a, to, opts).id);
      });
      made = made.filter((id) => doc.has(id));
      this.ctx.setSelection(made);
      // Ending on a connector finishes the run.
      this.last = r.snapped ? null : to;
      if (r.snapped) {
        this.ctx.viewport.setPreviewLines(null);
        this.ctx.status("Duct: connected. Click to start another run.");
      }
    } catch (err) {
      this.ctx.status(`⚠ ${(err as Error).message}`);
    }
  }

  private adopt(c: ModelConnector): void {
    this.classification = c.classification;
    if (c.shape === "round") this.diameter = c.diameter || this.diameter;
    else {
      this.width = c.width || this.width;
      this.height = c.height || this.height;
    }
    this.elevation = c.position[2] - this.levelZ();
    this.showOptions();
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key === "Escape" && this.last) {
      this.last = null;
      this.ctx.viewport.setPreviewLines(null);
      this.ctx.status("Duct: click to start a new run.");
      return true;
    }
    return false;
  }
}
