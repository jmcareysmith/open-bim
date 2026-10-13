import {
  Cat,
  PIPE_SIZES,
  SYSTEM_CLASSIFICATIONS,
  createDuct,
  createPipe,
  ductTypes,
  elementConnectors,
  ensureDuctTypes,
  ensurePipeTypes,
  minimumFall,
  pipeFalls,
  pipeTypeFor,
  pipeTypes,
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

// Duct and Pipe (Revit: Systems → Duct / Pipe): click to route, each click a run; fittings appear
// by themselves (elbows at turns, tees where a run ends on another, transitions between sizes).
// Change the middle elevation between clicks for a riser. Click on a connector to start or finish
// there (taking its height, size and system). Drainage pipes fall as they go (minimum fall for the
// size, or as set). Esc ends the run.

/** Connectors within this many pixels of a click snap the duct to them. */
const SNAP_PX = 14;

export class RunTool implements Tool {
  readonly name: "duct" | "pipe";
  private last: P3 | null = null;
  /** Pipes: fall (rise over run) for drainage; null = the minimum for the size. */
  private fall: number | null = null;
  private diameter = 200;
  private width = 400;
  private height = 250;
  /** Middle elevation above the level, mm. */
  private elevation = 2600;
  private classification: SystemClassification = "supplyAir";

  constructor(
    private ctx: ToolContext,
    mode: "duct" | "pipe" = "duct",
  ) {
    this.name = mode;
    if (mode === "pipe") {
      this.classification = "coldWater";
      this.diameter = 20;
      this.elevation = 300;
    }
  }

  private get pipe(): boolean {
    return this.name === "pipe";
  }

  private get label(): string {
    return this.pipe ? "Pipe" : "Duct";
  }

  activate(): void {
    const { doc } = this.ctx;
    if (this.pipe && !pipeTypes(doc).length) doc.transact("Load pipe types", (tx) => ensurePipeTypes(tx, doc));
    if (!this.pipe && !ductTypes(doc).length) doc.transact("Load duct types", (tx) => ensureDuctTypes(tx, doc));
    this.last = null;
    this.showOptions();
    this.ctx.status(`${this.label}: click to route (each click a run; fittings are automatic). Click a connector to join a fixture or unit. Esc ends.`);
  }

  deactivate(): void {
    this.last = null;
    this.ctx.viewport.setPreviewLines(null);
    this.ctx.setToolOptions?.(null);
  }

  private typeId(): ElementId | undefined {
    if (this.pipe) return pipeTypeFor(this.ctx.doc, this.classification);
    return this.ctx.activeTypeId(Cat.DuctType) ?? ductTypes(this.ctx.doc)[0]?.id;
  }

  private round(): boolean {
    if (this.pipe) return true;
    const id = this.typeId();
    return (id ? this.ctx.doc.get<DuctTypeParams>(id)?.params.shape : "round") !== "rectangular";
  }

  private showOptions(): void {
    const opts: ToolOption[] = [
      {
        kind: "select",
        label: "System",
        value: this.classification,
        options: SYSTEM_CLASSIFICATIONS.filter((c) => c.domain === (this.pipe ? "pipe" : "duct")).map((c) => ({ value: c.value, label: c.label })),
        set: (v) => {
          this.classification = v as SystemClassification;
          // Drainage starts at DN100, supply at DN20.
          if (this.pipe) this.diameter = pipeFalls(this.classification) ? Math.max(this.diameter, 100) : Math.min(this.diameter, 25);
          this.showOptions();
        },
      },
      ...(this.pipe
        ? [
            {
              kind: "select" as const,
              label: "Size",
              value: String(this.diameter),
              options: PIPE_SIZES.map((d) => ({ value: String(d), label: `DN${d}` })),
              set: (v: string) => (this.diameter = Number(v)),
            },
          ]
        : this.round()
        ? [{ kind: "number" as const, label: "Diameter", value: this.diameter, min: 50, set: (v: number) => (this.diameter = v || this.diameter) }]
        : [
            { kind: "number" as const, label: "Width", value: this.width, min: 50, set: (v: number) => (this.width = v || this.width) },
            { kind: "number" as const, label: "Height", value: this.height, min: 50, set: (v: number) => (this.height = v || this.height) },
          ]),
      { kind: "number", label: "Middle elevation", value: this.elevation, min: -Infinity, set: (v) => (this.elevation = v) },
      ...(this.pipe && pipeFalls(this.classification)
        ? [
            {
              kind: "select" as const,
              label: "Fall",
              value: this.fall === null ? "min" : String(this.fall),
              options: [
                { value: "min", label: "Minimum for size" },
                { value: String(1 / 40), label: "1:40" },
                { value: String(1 / 60), label: "1:60" },
                { value: String(1 / 100), label: "1:100" },
                { value: "0", label: "Level" },
              ],
              set: (v: string) => (this.fall = v === "min" ? null : Number(v)),
            },
          ]
        : []),
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
      if (el.category !== Cat.FamilyInstance && el.category !== (this.pipe ? Cat.Pipe : Cat.Duct)) continue;
      for (const c of elementConnectors(doc, el)) {
        if (c.domain !== (this.pipe ? "pipe" : "duct")) continue;
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
    if (this.ctx.viewport.viewMode === "drawing") return this.ctx.status(`Route ${this.label.toLowerCase()}s in a plan or 3D view.`);
    const r = this.point(ev);
    if (!r) return;
    const { doc } = this.ctx;
    // Starting on a connector takes its size and system.
    if (!this.last) {
      if (r.snapped) this.adopt(r.snapped);
      this.last = r.p;
      this.ctx.status(r.snapped ? `${this.label}: starting at the connector. Click the next point.` : `${this.label}: click the next point.`);
      return;
    }
    const typeId = this.typeId();
    if (!typeId) return;
    const from = this.last;
    let to = r.p;
    // Drainage falls from the last point (a connector it ends on sets its own height).
    const falls = this.pipe && pipeFalls(this.classification) && !r.snapped;
    if (falls) {
      const run = Math.hypot(to.x - from.x, to.y - from.y);
      to = { ...to, z: from.z - run * (this.fall ?? minimumFall(this.diameter)) };
    }
    const opts = { diameter: this.diameter, width: this.width, height: this.height, classification: this.classification };
    const level = this.ctx.activeLevelId();
    try {
      let made: ElementId[] = [];
      doc.transact(`Create ${this.label.toLowerCase()}`, (tx) => {
        const make = (a: P3, b: P3) =>
          this.pipe ? createPipe(tx, doc, typeId, level, a, b, { diameter: this.diameter, classification: this.classification }) : createDuct(tx, doc, typeId, level, a, b, opts);
        let a = from;
        // A changed middle elevation rises (or drops) at the last point first.
        if (!r.snapped && !falls && Math.abs(a.z - to.z) > 1 && Math.hypot(to.x - a.x, to.y - a.y) > 1) {
          const riser = { x: a.x, y: a.y, z: to.z };
          made.push(make(a, riser).id);
          a = riser;
        }
        made.push(make(a, to).id);
      });
      made = made.filter((id) => doc.has(id));
      this.ctx.setSelection(made);
      // Ending on a connector finishes the run.
      this.last = r.snapped ? null : to;
      if (r.snapped) {
        this.ctx.viewport.setPreviewLines(null);
        this.ctx.status(`${this.label}: connected. Click to start another run.`);
      }
    } catch (err) {
      this.ctx.status(`⚠ ${(err as Error).message}`);
    }
  }

  private adopt(c: ModelConnector): void {
    this.classification = c.classification;
    if (c.shape === "round") this.diameter = this.pipe ? (PIPE_SIZES.find((d) => d >= c.diameter) ?? this.diameter) : c.diameter || this.diameter;
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
      this.ctx.status(`${this.label}: click to start a new run.`);
      return true;
    }
    return false;
  }
}
