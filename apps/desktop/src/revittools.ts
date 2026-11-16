import { joinGeometry, switchJoinOrder, unjoinGeometry, Cat, createFloorPlan, createLevel, type Element, type FamilyInstanceParams, type LevelParams, type View } from "@open-bim/core";
import type { Tool, ToolContext } from "./tools.ts";

// Small Revit tools reached mostly by their shortcuts: Level (LL) and Match Type Properties (MA).

/** Level (Revit: Architecture → Level, LL): click in a section or elevation at the new level's height. */
export class LevelTool implements Tool {
  readonly name = "level";
  constructor(private ctx: ToolContext) {}

  activate(): void {
    this.ctx.status("Level: click at the height for the new level (in a section or elevation). It gets its own floor plan. Esc ends.");
  }

  private sectionView(): View | null {
    const id = this.ctx.activeViewId();
    const v = id ? this.ctx.doc.get(id) : undefined;
    return v && v.category === Cat.View && (v as View).params.line ? (v as View) : null;
  }

  click(ev: PointerEvent): void {
    if (this.ctx.viewport.viewMode !== "drawing" || !this.sectionView()) return this.ctx.status("Levels are placed in a section or elevation: open one first.");
    const p = this.ctx.viewport.pickDrawing(ev);
    if (!p) return;
    const { doc } = this.ctx;
    // Snap to 10 mm (Shift: as clicked).
    const z = ev.shiftKey ? Math.round(p.y) : Math.round(p.y / 10) * 10;
    const levels = doc.byCategory<LevelParams>(Cat.Level);
    if (levels.some((l) => Math.abs(l.params.elevation - z) < 1)) return this.ctx.status("There's already a level at that height.");
    const taken = new Set(levels.map((l) => l.name));
    let n = levels.length + 1;
    while (taken.has(`Level ${n}`)) n++;
    try {
      doc.transact("Create level", (tx) => {
        const l = createLevel(tx, `Level ${n}`, z);
        createFloorPlan(tx, doc, l.id, { name: `Level ${n}` });
      });
      this.ctx.status(`Level ${n} at ${z} mm (with its floor plan). Click for another, or Esc.`);
    } catch (e) {
      this.ctx.status(`⚠ ${(e as Error).message}`);
    }
  }
}

/**
 * Match Type Properties (Revit: Modify → Match Type, MA): click the element whose type to copy,
 * then each element to give it that type (same category). Esc ends.
 */
export class MatchTypeTool implements Tool {
  readonly name = "matchtype";
  private source: Element | null = null;
  constructor(private ctx: ToolContext) {}

  activate(): void {
    this.source = null;
    this.ctx.status("Match Type: click the element whose type to copy.");
  }

  click(ev: PointerEvent): void {
    const id = this.ctx.viewport.pick(ev);
    const el = id ? this.ctx.doc.get(id) : undefined;
    if (!el) return;
    if (!this.source) {
      const fam = el.category === Cat.FamilyInstance;
      if (!el.typeId && !fam) return this.ctx.status("That has no type to match: pick another.");
      this.source = el;
      this.ctx.setSelection([el.id]);
      this.ctx.status(`Match Type: now click elements to give them ${this.typeLabel(el)}. Esc ends.`);
      return;
    }
    const src = this.source;
    if (el.category !== src.category) return this.ctx.status(`Pick a ${src.category.toLowerCase()} (the same category as the source).`);
    if (src.category === Cat.FamilyInstance) {
      // Loadable families: the same family category (doors with doors, lights with lights), hosted alike.
      const s = src.params as FamilyInstanceParams;
      const e = el.params as FamilyInstanceParams;
      const cat = (id: string) => (this.ctx.doc.get(id)?.params as { category?: string } | undefined)?.category;
      if (cat(s.familyId) !== cat(e.familyId)) return this.ctx.status(`Pick another ${cat(s.familyId) ?? "family"} instance (the same family category as the source).`);
      if (!!s.hostId !== !!e.hostId) return this.ctx.status(s.hostId ? "Pick an instance hosted in a wall, like the source." : "Pick a free-standing instance, like the source.");
    }
    try {
      this.ctx.doc.transact("Match type", (tx) => {
        if (src.category === Cat.FamilyInstance) {
          const s = src.params as FamilyInstanceParams;
          tx.update<FamilyInstanceParams>(el.id, { familyId: s.familyId, typeName: s.typeName });
        } else if (src.typeId) tx.setType(el.id, src.typeId);
      });
      this.ctx.status(`Gave it ${this.typeLabel(src)}. Click more, or Esc.`);
    } catch (e) {
      this.ctx.status(`⚠ ${(e as Error).message}`);
    }
  }

  private typeLabel(el: Element): string {
    if (el.category === Cat.FamilyInstance) return `type "${(el.params as FamilyInstanceParams).typeName}"`;
    const t = el.typeId ? this.ctx.doc.get(el.typeId) : undefined;
    return t?.name ? `type "${t.name}"` : "that type";
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key === "Escape" && this.source) {
      this.source = null;
      this.ctx.status("Match Type: click the element whose type to copy.");
      return true;
    }
    return false;
  }
}

/** Zoom Region (Revit: ZR): drag a box; the view zooms to it, then the tool in use before comes back. */
export class ZoomRegionTool implements Tool {
  readonly name = "zoomregion";
  private from: { x: number; y: number } | null = null;
  private band: HTMLDivElement | null = null;
  constructor(
    private ctx: ToolContext,
    private done: () => void,
  ) {}

  activate(): void {
    this.ctx.status("Zoom Region: drag a box round what to zoom to.");
  }

  deactivate(): void {
    this.band?.remove();
    this.band = null;
    this.from = null;
  }

  pointerDown(ev: PointerEvent): void {
    if (ev.button === 0) this.from = { x: ev.clientX, y: ev.clientY };
  }

  pointerMove(ev: PointerEvent): void {
    if (!this.from || !(ev.buttons & 1)) return;
    if (!this.band) {
      this.band = document.createElement("div");
      this.band.className = "select-band";
      document.body.append(this.band);
    }
    Object.assign(this.band.style, {
      left: `${Math.min(this.from.x, ev.clientX)}px`,
      top: `${Math.min(this.from.y, ev.clientY)}px`,
      width: `${Math.abs(ev.clientX - this.from.x)}px`,
      height: `${Math.abs(ev.clientY - this.from.y)}px`,
    });
  }

  pointerUp(ev: PointerEvent): void {
    const f = this.from;
    this.band?.remove();
    this.band = null;
    this.from = null;
    if (!f) return;
    this.ctx.viewport.zoomRegion({ x0: f.x, y0: f.y, x1: ev.clientX, y1: ev.clientY });
    this.done();
  }
}

/**
 * Join Geometry / Unjoin / Switch Join Order (Revit: Modify → Join ▾): click the first element,
 * then the second. Join: the first cuts the second where they overlap. Esc ends.
 */
export class JoinGeometryTool implements Tool {
  readonly name: string;
  private first: string | null = null;
  constructor(
    private ctx: ToolContext,
    private mode: "join" | "unjoin" | "switch",
  ) {
    this.name = mode === "join" ? "joingeometry" : mode === "unjoin" ? "unjoingeometry" : "switchjoin";
  }

  private label(): string {
    return this.mode === "join" ? "Join Geometry" : this.mode === "unjoin" ? "Unjoin Geometry" : "Switch Join Order";
  }

  activate(): void {
    this.first = null;
    this.ctx.status(`${this.label()}: click the first element${this.mode === "join" ? " (it cuts the second)" : ""}.`);
  }

  click(ev: PointerEvent): void {
    const id = this.ctx.viewport.pick(ev);
    if (!id) return;
    if (!this.first) {
      this.first = id;
      this.ctx.setSelection([id]);
      return this.ctx.status(`${this.label()}: now click the second element.`);
    }
    const a = this.first;
    this.first = null;
    try {
      this.ctx.doc.transact(this.label(), (tx) =>
        this.mode === "join" ? joinGeometry(tx, this.ctx.doc, a, id) : this.mode === "unjoin" ? unjoinGeometry(tx, this.ctx.doc, a, id) : switchJoinOrder(tx, this.ctx.doc, a, id),
      );
      this.ctx.setSelection([]);
      this.ctx.status(`${this.label()} done. Click the next first element, or Esc.`);
    } catch (e) {
      this.ctx.status(`⚠ ${(e as Error).message}`);
    }
  }
}
