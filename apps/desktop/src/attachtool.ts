import { BASE_ATTACH, Cat, TOP_ATTACH, attachWall, type ElementId } from "@open-bim/core";
import type { Tool, ToolContext } from "./tools.ts";

// Attach Top/Base (Revit: Modify | Walls → Attach Top/Base): with walls selected, click the roof,
// floor or ceiling their tops should meet (or, for the base, the floor they stand on). Works in
// 3D, plans and sections. Shift+click attaches the base.

export class AttachTool implements Tool {
  readonly name = "attach";
  end: "top" | "base" = "top";
  private walls: ElementId[] = [];
  constructor(private ctx: ToolContext) {}

  activate(): void {
    this.walls = this.ctx.selection().filter((id) => this.ctx.doc.get(id)?.category === Cat.Wall);
    this.ctx.status(
      this.walls.length
        ? `Attach ${this.end === "top" ? "Top" : "Base"}: click the ${this.end === "top" ? "roof, floor or ceiling" : "floor"} for ${this.walls.length} wall(s). Shift+click attaches the ${this.end === "top" ? "base" : "top"} instead.`
        : "Attach Top/Base: select walls first, then start the tool.",
    );
  }

  click(ev: PointerEvent): void {
    if (!this.walls.length) return this.activate();
    const end = ev.shiftKey ? (this.end === "top" ? "base" : "top") : this.end;
    const ok = end === "top" ? TOP_ATTACH : BASE_ATTACH;
    const hit = this.ctx.viewport.pickHit(ev, (id) => ok.has(this.ctx.doc.get(id)?.category ?? ""));
    if (!hit) return this.ctx.status(`Attach ${end}: click a ${end === "top" ? "roof, floor or ceiling" : "floor"}.`);
    const { doc } = this.ctx;
    const walls = this.walls;
    try {
      doc.transact(`Attach ${end}`, (tx) => walls.forEach((w) => attachWall(tx, doc, w, end, hit.id)));
      this.ctx.setSelection(walls);
      const t = doc.get(hit.id);
      this.ctx.status(`Attached the ${end} of ${walls.length} wall(s) to the ${t?.category.toLowerCase()}${t?.name ? ` ${t.name}` : ""}. Detach in Properties.`);
    } catch (e) {
      this.ctx.status(`⚠ ${(e as Error).message}`);
    }
  }
}
