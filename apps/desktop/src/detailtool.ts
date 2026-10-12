import { Cat, createDetailComponent, familyDefs, isDetailFamily, type ElementId, type ViewParams } from "@open-bim/core";
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
