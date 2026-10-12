import { Cat, DEFAULT_SYMBOL_SIZE, SYMBOL_KINDS, createSymbol, type SymbolKind, type ViewParams } from "@open-bim/core";
import { buildSymbolLines } from "@open-bim/geometry";
import { viewPoint, type Tool, type ToolContext } from "./tools.ts";

// Symbol tool (Annotate → Symbol): click to place a north arrow, scale bar or break line in the
// open plan, section, elevation or sheet. The ribbon's Symbol ▾ picks which.

export class SymbolTool implements Tool {
  readonly name = "symbol";
  kind: SymbolKind = "northArrow";
  constructor(private ctx: ToolContext) {}

  private label(): string {
    return SYMBOL_KINDS.find((k) => k.value === this.kind)!.label;
  }

  activate(): void {
    this.ctx.status(`${this.label()}: click to place it. Rotate and resize it in Properties (or with Rotate).`);
  }

  deactivate(): void {
    this.ctx.viewport.setPreviewLines(null);
  }

  private owner(): string | null {
    const id = this.ctx.activeViewId();
    const v = id ? this.ctx.doc.get(id) : undefined;
    if (!v || (v.category === Cat.View && (v.params as ViewParams).kind === "3d") || (v.category !== Cat.View && v.category !== Cat.Sheet)) {
      this.ctx.status("Symbols go in plans, sections, elevations or sheets. Open one first.");
      return null;
    }
    return v.id;
  }

  pointerMove(ev: PointerEvent): void {
    const id = this.ctx.activeViewId();
    const p = viewPoint(this.ctx, ev, null);
    if (!p || !id) return;
    // Preview: the symbol as it would be placed.
    const ghost = { id: "", category: Cat.Symbol, params: { viewId: id, kind: this.kind, position: p, rotation: 0, size: DEFAULT_SYMBOL_SIZE[this.kind] } };
    const lines = buildSymbolLines(this.ctx.doc, ghost as never);
    this.ctx.viewport.setPreviewLines(lines ? { segments: lines.segments, labels: [] } : null);
  }

  click(ev: PointerEvent): void {
    const viewId = this.owner();
    if (!viewId) return;
    const p = viewPoint(this.ctx, ev, null);
    if (!p) return;
    try {
      const s = this.ctx.doc.transact(`Place ${this.label().toLowerCase()}`, (tx) => createSymbol(tx, this.ctx.doc, viewId, this.kind, p));
      this.ctx.setSelection([s.id]);
    } catch (e) {
      this.ctx.status(`⚠ ${(e as Error).message}`);
    }
  }
}
