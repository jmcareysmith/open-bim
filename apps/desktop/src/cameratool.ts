import { createCameraView, type ElementId, type Vec2 } from "@open-bim/core";
import { viewPoint, type Tool, type ToolContext } from "./tools.ts";

// Camera (Revit: View → 3D View ▾ → Camera): in a plan, click where you stand, then where you
// look. Makes a perspective 3D view at eye height (1750 mm) and opens it.

export class CameraTool implements Tool {
  readonly name = "camera";
  private eye: Vec2 | null = null;

  constructor(
    private ctx: ToolContext,
    private open: (viewId: ElementId) => void,
  ) {}

  activate(): void {
    this.eye = null;
    this.ctx.status(
      this.ctx.viewport.viewMode === "plan" ? "Camera: click the eye point, then the target. Esc = cancel" : "Camera: open a floor plan first, then click the eye point and the target.",
    );
  }

  deactivate(): void {
    this.eye = null;
    this.ctx.viewport.setPreviewLines(null);
  }

  pointerMove(ev: PointerEvent): void {
    if (!this.eye) return;
    const p = viewPoint(this.ctx, ev, this.eye);
    if (!p) return;
    // A view cone: the sight line and the edges of a 50° field of view.
    const dx = p.x - this.eye.x;
    const dy = p.y - this.eye.y;
    const seg = [this.eye.x, this.eye.y, 0, p.x, p.y, 0];
    for (const a of [-25, 25]) {
      const r = (a * Math.PI) / 180;
      const c = Math.cos(r) / Math.cos((25 * Math.PI) / 180);
      const x = this.eye.x + (dx * Math.cos(r) - dy * Math.sin(r)) * c;
      const y = this.eye.y + (dx * Math.sin(r) + dy * Math.cos(r)) * c;
      seg.push(this.eye.x, this.eye.y, 0, x, y, 0);
    }
    this.ctx.viewport.setPreviewLines({ segments: new Float32Array(seg), labels: [] });
  }

  click(ev: PointerEvent): void {
    if (this.ctx.viewport.viewMode !== "plan") return this.activate();
    const p = viewPoint(this.ctx, ev, this.eye);
    if (!p) return;
    if (!this.eye) {
      this.eye = p;
      this.ctx.status("Camera: click the target.");
      return;
    }
    const { doc } = this.ctx;
    const eye = this.eye;
    try {
      const v = doc.transact("Camera", (tx) => createCameraView(tx, doc, this.ctx.activeLevelId(), eye, p));
      this.eye = null;
      this.ctx.viewport.setPreviewLines(null);
      this.open(v.id);
      this.ctx.status(`${v.name} created (perspective). Orbit and zoom as usual; the view keeps its camera.`);
    } catch (e) {
      this.ctx.status(`⚠ ${(e as Error).message}`);
    }
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key === "Escape" && this.eye) {
      this.ctx.viewport.setPreviewLines(null);
      this.activate();
      return true;
    }
    return false;
  }
}
