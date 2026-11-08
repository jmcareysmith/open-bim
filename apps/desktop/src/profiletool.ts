import { Cat, setWallProfile, wallExtent, wallProfileMapping, type ElementId, type Vec2, type ViewParams, type Wall } from "@open-bim/core";
import type { Tool, ToolContext } from "./tools.ts";

// Edit Profile, sketched (Revit: select a wall → Edit Profile in an elevation): with a section or
// elevation open that runs along the wall, click the outline's corners on the drawing, then Enter.
// Points go into the wall's own coordinates (along from its start, up from its base).

export class WallProfileTool implements Tool {
  readonly name = "wallProfile";
  wallId: ElementId | null = null;
  private pts: Vec2[] = [];

  constructor(private ctx: ToolContext) {}

  activate(): void {
    this.pts = [];
    this.ctx.status("Edit Profile: click the outline's corners on the drawing; Enter to finish, Esc to cancel.");
  }

  deactivate(): void {
    this.pts = [];
    this.ctx.viewport.setPreviewLines(null);
  }

  private snap(ev: PointerEvent): Vec2 | null {
    const p = this.ctx.viewport.pickDrawing(ev);
    if (!p) return null;
    const last = this.pts[this.pts.length - 1];
    // Square to the last point unless Shift; round to 10 mm.
    const r = (v: number) => Math.round(v / 10) * 10;
    if (last && !ev.shiftKey) return Math.abs(p.x - last.x) > Math.abs(p.y - last.y) ? { x: r(p.x), y: last.y } : { x: last.x, y: r(p.y) };
    return { x: r(p.x), y: r(p.y) };
  }

  private draw(extra: Vec2 | null): void {
    const pts = extra ? [...this.pts, extra] : this.pts;
    const seg: number[] = [];
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length]!;
      if (i + 1 < pts.length || pts.length > 2) seg.push(a.x, a.y, 0, b.x, b.y, 0);
    });
    this.ctx.viewport.setPreviewLines(seg.length ? { segments: new Float32Array(seg), labels: [] } : null);
  }

  pointerMove(ev: PointerEvent): void {
    this.draw(this.snap(ev));
  }

  click(ev: PointerEvent): void {
    const p = this.snap(ev);
    if (!p) return;
    this.pts.push(p);
    this.draw(null);
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key === "Escape") {
      // Points first, then (Esc again) back to Select.
      if (!this.pts.length) return false;
      this.pts = [];
      this.ctx.viewport.setPreviewLines(null);
      return true;
    }
    if (ev.key !== "Enter") return false;
    const { doc } = this.ctx;
    const wall = this.wallId ? (doc.get(this.wallId) as Wall | undefined) : undefined;
    const viewId = this.ctx.activeViewId();
    const view = viewId ? doc.get<ViewParams>(viewId) : undefined;
    const map = wall && view ? wallProfileMapping(wall, view) : null;
    if (!wall || wall.category !== Cat.Wall || !map) {
      this.ctx.status("⚠ Open a section or elevation that runs along the wall.");
      return true;
    }
    const bottom = wallExtent(doc, wall).bottom;
    const profile = this.pts.map(map).map((q) => ({ x: Math.round(q.x), y: Math.round(q.y - bottom) }));
    try {
      doc.transact("Edit wall profile", (tx) => setWallProfile(tx, doc, wall.id, profile));
      this.ctx.setSelection([wall.id]);
      this.pts = [];
      this.ctx.viewport.setPreviewLines(null);
      this.ctx.status("Profile set. Esc to finish, or sketch it again.");
    } catch (e) {
      this.ctx.status(`⚠ ${(e as Error).message}`);
    }
    return true;
  }
}
