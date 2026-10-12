import { createElevationAt, type LevelParams } from "@open-bim/core";
import { snapPoint, type Tool, type ToolContext } from "./tools.ts";

// Elevation (Revit: View → Elevation): click in a plan to place one elevation marker; it looks
// square at the nearest wall. The ribbon's Elevation ▾ also offers all four building elevations.

export class ElevationTool implements Tool {
  readonly name = "elevation";
  constructor(private ctx: ToolContext) {}

  activate(): void {
    this.ctx.status("Elevation: click where the marker goes; it looks at the nearest wall. (Elevation ▾: all four building elevations.)");
  }

  click(ev: PointerEvent): void {
    const { doc } = this.ctx;
    const z = doc.require<LevelParams>(this.ctx.activeLevelId()).params.elevation;
    const raw = this.ctx.viewport.pickPlane(ev, z);
    if (!raw) return;
    const at = snapPoint(this.ctx, raw, null, true).p;
    try {
      const v = doc.transact("Create elevation", (tx) => createElevationAt(tx, doc, at));
      this.ctx.setSelection([v.id]);
      this.ctx.status(`${v.name} placed. Double-click its marker to open it.`);
    } catch (e) {
      this.ctx.status(`⚠ ${(e as Error).message}`);
    }
  }
}
