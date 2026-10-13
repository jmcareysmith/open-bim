import { CONDUIT_SIZES, Cat, createCableTray, createConduit, ensureContainmentTypes, type ElementId, type P3 } from "@open-bim/core";
import type { ToolOption } from "./modifytools.ts";
import { viewPoint, type Tool, type ToolContext } from "./tools.ts";

// Cable Tray and Conduit (Revit: Systems → Cable Tray / Conduit): click to route, each click a run;
// bends, tees and crosses are automatic. Change the middle elevation between clicks for a riser.
// Esc ends the run.

export class ContainmentTool implements Tool {
  readonly name: "tray" | "conduit";
  private last: P3 | null = null;
  private width = 300;
  private height = 100;
  private diameter = 25;
  private elevation = 2700;

  constructor(
    private ctx: ToolContext,
    mode: "tray" | "conduit",
  ) {
    this.name = mode;
  }

  private get label(): string {
    return this.name === "tray" ? "Cable Tray" : "Conduit";
  }

  activate(): void {
    this.last = null;
    this.showOptions();
    this.ctx.status(`${this.label}: click to route (each click a run; bends and tees are automatic). Esc ends.`);
  }

  deactivate(): void {
    this.last = null;
    this.ctx.viewport.setPreviewLines(null);
    this.ctx.setToolOptions?.(null);
  }

  private showOptions(): void {
    const size: ToolOption[] =
      this.name === "tray"
        ? [
            { kind: "number", label: "Width", value: this.width, min: 50, set: (v) => (this.width = v || this.width) },
            { kind: "number", label: "Depth", value: this.height, min: 25, set: (v) => (this.height = v || this.height) },
          ]
        : [{ kind: "select", label: "Size", value: String(this.diameter), options: CONDUIT_SIZES.map((d) => ({ value: String(d), label: `${d} mm` })), set: (v) => (this.diameter = Number(v)) }];
    this.ctx.setToolOptions?.([...size, { kind: "number", label: "Middle elevation", value: this.elevation, min: -Infinity, set: (v) => (this.elevation = v) }]);
  }

  pointerMove(ev: PointerEvent): void {
    if (!this.last) return;
    const q = viewPoint(this.ctx, ev, this.last);
    if (q) this.ctx.viewport.setPreviewLines({ segments: new Float32Array([this.last.x, this.last.y, 0, q.x, q.y, 0]), labels: [] });
  }

  click(ev: PointerEvent): void {
    if (this.ctx.viewport.viewMode === "drawing") return this.ctx.status(`Route ${this.label.toLowerCase()} in a plan or 3D view.`);
    const q = viewPoint(this.ctx, ev, this.last);
    if (!q) return;
    const to: P3 = { x: q.x, y: q.y, z: this.elevation };
    if (!this.last) {
      this.last = to;
      return;
    }
    const { doc } = this.ctx;
    const from = this.last;
    const level = this.ctx.activeLevelId();
    try {
      let made: ElementId[] = [];
      doc.transact(`Create ${this.label.toLowerCase()}`, (tx) => {
        const types = ensureContainmentTypes(tx, doc);
        const make = (a: P3, b: P3) =>
          this.name === "tray"
            ? createCableTray(tx, doc, types.tray, level, a, b, { width: this.width, height: this.height })
            : createConduit(tx, doc, types.conduit, level, a, b, { diameter: this.diameter });
        let a = from;
        if (Math.abs(a.z - to.z) > 1) {
          const riser = { x: a.x, y: a.y, z: to.z };
          made.push(make(a, riser).id);
          a = riser;
        }
        made.push(make(a, to).id);
      });
      made = made.filter((id) => doc.has(id) && (doc.get(id)!.category === Cat.CableTray || doc.get(id)!.category === Cat.Conduit));
      this.ctx.setSelection(made);
      this.last = to;
    } catch (err) {
      this.ctx.status(`⚠ ${(err as Error).message}`);
    }
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key === "Escape" && this.last) {
      this.last = null;
      this.ctx.viewport.setPreviewLines(null);
      return true;
    }
    return false;
  }
}
