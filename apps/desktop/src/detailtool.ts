import { Cat, createDetailComponent, createRepeatingDetail, detailWidth, familyDefs, isDetailFamily, type ElementId, type ViewParams } from "@open-bim/core";
import { buildDetailComponentLines } from "@open-bim/geometry";
import { viewPoint, type Tool, type ToolContext } from "./tools.ts";

// Detail Component tool (Annotate → Detail → Component): place a loaded Detail Item family in the
// open plan, section or elevation. Pick the family from the ribbon's Component ▾ or the type
// selector; Space rotates the next one by 90° (as in Revit).

export class DetailComponentTool implements Tool {
  readonly name = "detailcomponent";
  familyId: ElementId | null = null;
  private rotation = 0;
  constructor(private ctx: ToolContext) {}

  /** Loaded Detail Item families. */
  families() {
    return familyDefs(this.ctx.doc).filter(isDetailFamily);
  }

  private family() {
    const fams = this.families();
    return fams.find((f) => f.id === this.familyId) ?? fams[0];
  }

  activate(): void {
    const f = this.family();
    this.ctx.status(
      f
        ? `Detail component ${f.name}: click to place. Space rotates 90°. Pick another in the type selector or Component ▾.`
        : "Detail component: no Detail Item families loaded. Use Component ▾ to load one from the library, or make one (New family → Detail Item).",
    );
  }

  deactivate(): void {
    this.ctx.viewport.setPreviewLines(null);
  }

  private view(): ElementId | null {
    const id = this.ctx.activeViewId();
    const v = id ? this.ctx.doc.get(id) : undefined;
    if (v?.category !== Cat.View || ["3d", "legend"].includes((v.params as ViewParams).kind)) return null;
    return v.id;
  }

  pointerMove(ev: PointerEvent): void {
    const f = this.family();
    const viewId = this.view();
    const p = viewPoint(this.ctx, ev, null);
    if (!f || !viewId || !p) return this.ctx.viewport.setPreviewLines(null);
    const ghost = { id: "", category: Cat.DetailComponent, params: { viewId, familyId: f.id, position: p, rotation: this.rotation, mirrored: false } };
    const lines = buildDetailComponentLines(this.ctx.doc, ghost as never);
    this.ctx.viewport.setPreviewLines(lines ? { segments: lines.segments, labels: [] } : null);
  }

  click(ev: PointerEvent): void {
    const f = this.family();
    if (!f) return this.activate();
    const viewId = this.view();
    if (!viewId) return this.ctx.status("Detail components go in plans, sections or elevations. Open one first.");
    const p = viewPoint(this.ctx, ev, null);
    if (!p) return;
    try {
      const d = this.ctx.doc.transact(`Place ${f.name}`, (tx) => createDetailComponent(tx, this.ctx.doc, viewId, f.id, p, { rotation: this.rotation }));
      this.ctx.setSelection([d.id]);
    } catch (e) {
      this.ctx.status(`⚠ ${(e as Error).message}`);
    }
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key !== " ") return false;
    this.rotation = (this.rotation + Math.PI / 2) % (2 * Math.PI);
    this.ctx.status(`Detail component rotated to ${Math.round((this.rotation * 180) / Math.PI)}°.`);
    return true;
  }
}

/**
 * Repeating Detail Component (Revit: Detail → Component ▾ Repeating Detail): click the start and
 * the end; the detail item repeats along the line at its own width (Spacing in Properties).
 */
export class RepeatingDetailTool implements Tool {
  readonly name = "repeatingdetail";
  private start: { x: number; y: number } | null = null;
  constructor(
    private ctx: ToolContext,
    private pick: () => ElementId | null,
  ) {}

  activate(): void {
    this.start = null;
    const id = this.pick();
    this.ctx.status(id ? `Repeating detail ${this.ctx.doc.get(id)?.name}: click the start, then the end.` : "Repeating detail: load a Detail Item family first (Component \u25be).");
  }

  deactivate(): void {
    this.start = null;
    this.ctx.viewport.setPreviewLines(null);
  }

  pointerMove(ev: PointerEvent): void {
    const id = this.pick();
    const viewId = this.ctx.activeViewId();
    const p = viewPoint(this.ctx, ev, this.start);
    if (!id || !viewId || !p || !this.start) return this.ctx.viewport.setPreviewLines(null);
    const def = this.ctx.doc.get(id) as never;
    const ghost = { id: "", category: Cat.DetailComponent, params: { viewId, familyId: id, position: this.start, rotation: 0, mirrored: false, repeat: { end: p, spacing: detailWidth(def) } } };
    const lines = buildDetailComponentLines(this.ctx.doc, ghost as never);
    this.ctx.viewport.setPreviewLines(lines ? { segments: lines.segments, labels: [] } : null);
  }

  click(ev: PointerEvent): void {
    const id = this.pick();
    if (!id) return this.activate();
    const viewId = this.ctx.activeViewId();
    const v = viewId ? this.ctx.doc.get<ViewParams>(viewId) : undefined;
    if (!v || v.category !== Cat.View || ["3d", "legend"].includes(v.params.kind)) return this.ctx.status("Repeating details go in plans, sections, elevations or drafting views.");
    const p = viewPoint(this.ctx, ev, this.start);
    if (!p) return;
    if (!this.start) {
      this.start = p;
      return this.ctx.status("Repeating detail: click the end.");
    }
    const a = this.start;
    this.start = null;
    this.ctx.viewport.setPreviewLines(null);
    try {
      const d = this.ctx.doc.transact("Repeating detail", (tx) => createRepeatingDetail(tx, this.ctx.doc, v.id, id, a, p));
      this.ctx.setSelection([d.id]);
    } catch (e) {
      this.ctx.status(`\u26a0 ${(e as Error).message}`);
    }
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key === "Escape" && this.start) {
      this.activate();
      return true;
    }
    return false;
  }
}
