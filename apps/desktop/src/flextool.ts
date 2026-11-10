import {
  Cat,
  SYSTEM_CLASSIFICATIONS,
  createFlexDuct,
  ductTypes,
  elementConnectors,
  ensureDuctTypes,
  type DuctTypeParams,
  type LevelParams,
  type ModelConnector,
  type P3,
  type SystemClassification,
  type Vec2,
} from "@open-bim/core";
import type { ToolOption } from "./modifytools.ts";
import { viewPoint, type Tool, type ToolContext } from "./tools.ts";

// Flex Duct (Revit: Systems → Flex Duct): click the points it bends through, Enter (or click a
// connector) to finish. Round, smooth through the points; it joins a terminal or a duct end
// directly, with no fittings. Clicking on a connector takes its height (and, to start, its size and system).

const SNAP_PX = 14;

export class FlexDuctTool implements Tool {
  readonly name = "flexduct";
  private pts: P3[] = [];
  private diameter = 200;
  private elevation = 2700;
  private classification: SystemClassification = "supplyAir";

  constructor(private ctx: ToolContext) {}

  activate(): void {
    this.pts = [];
    this.showOptions();
    this.ctx.status("Flex Duct: click its start (a terminal's or duct's connector snaps), the points it bends through, then Enter or click a connector to finish. Esc cancels.");
  }

  deactivate(): void {
    this.pts = [];
    this.ctx.viewport.setPreviewLines(null);
    this.ctx.setToolOptions?.(null);
  }

  private showOptions(): void {
    this.ctx.setToolOptions?.([
      { kind: "number", label: "Diameter", value: this.diameter, min: 50, set: (v) => (this.diameter = v || this.diameter) },
      { kind: "number", label: "Middle elevation", value: this.elevation, min: -Infinity, set: (v) => (this.elevation = v) },
      {
        kind: "select",
        label: "System",
        value: this.classification,
        options: SYSTEM_CLASSIFICATIONS.filter((c) => c.domain === "duct").map((c) => ({ value: c.value, label: c.label })),
        set: (v) => (this.classification = v as SystemClassification),
      },
    ] satisfies ToolOption[]);
  }

  private levelZ(): number {
    return this.ctx.doc.get<LevelParams>(this.ctx.activeLevelId())?.params.elevation ?? 0;
  }

  private snap(p: Vec2): ModelConnector | null {
    const { doc } = this.ctx;
    const tol = SNAP_PX * this.ctx.viewport.mmPerPixel();
    let best: ModelConnector | null = null;
    let bestD = tol;
    for (const el of doc.all()) {
      if (el.category !== Cat.FamilyInstance && el.category !== Cat.Duct) continue;
      for (const c of elementConnectors(doc, el)) {
        if (c.domain !== "duct") continue;
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
    const last = this.pts[this.pts.length - 1];
    const q = viewPoint(this.ctx, ev, last ? { x: last.x, y: last.y } : null);
    if (!q) return null;
    const c = this.snap(q);
    if (c) return { p: { x: c.position[0], y: c.position[1], z: c.position[2] - this.levelZ() }, snapped: c };
    return { p: { x: q.x, y: q.y, z: this.elevation }, snapped: null };
  }

  private preview(extra?: P3): void {
    const pts = extra ? [...this.pts, extra] : this.pts;
    const seg: number[] = [];
    for (let i = 1; i < pts.length; i++) seg.push(pts[i - 1]!.x, pts[i - 1]!.y, 0, pts[i]!.x, pts[i]!.y, 0);
    this.ctx.viewport.setPreviewLines(seg.length ? { segments: new Float32Array(seg), labels: [] } : null);
  }

  pointerMove(ev: PointerEvent): void {
    if (!this.pts.length) return;
    const r = this.point(ev);
    if (r) this.preview(r.p);
  }

  click(ev: PointerEvent): void {
    if (this.ctx.viewport.viewMode === "drawing") return this.ctx.status("Route flex ducts in a plan or 3D view.");
    const r = this.point(ev);
    if (!r) return;
    if (!this.pts.length && r.snapped) {
      // Starting on a connector takes its size and system.
      if (r.snapped.diameter) this.diameter = r.snapped.diameter;
      if (r.snapped.classification && SYSTEM_CLASSIFICATIONS.find((c) => c.value === r.snapped!.classification)?.domain === "duct") this.classification = r.snapped.classification;
      this.showOptions();
    }
    this.pts.push(r.p);
    this.preview();
    // Ending on a connector finishes it.
    if (this.pts.length >= 2 && r.snapped) this.finish();
  }

  private finish(): void {
    if (this.pts.length < 2) return;
    const { doc } = this.ctx;
    const pts = this.pts;
    this.pts = [];
    this.ctx.viewport.setPreviewLines(null);
    try {
      let id = "";
      doc.transact("Create flex duct", (tx) => {
        ensureDuctTypes(tx, doc);
        const round = ductTypes(doc).find((t) => (t.params as DuctTypeParams).shape === "round") ?? ductTypes(doc)[0]!;
        id = createFlexDuct(tx, doc, round.id, this.ctx.activeLevelId(), pts, { diameter: this.diameter, classification: this.classification }).id;
      });
      this.ctx.setSelection([id]);
      this.ctx.status("Flex duct made. Click the next one's start, or Esc.");
    } catch (err) {
      this.ctx.status(`⚠ ${(err as Error).message}`);
    }
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key === "Enter" && this.pts.length >= 2) {
      this.finish();
      return true;
    }
    if (ev.key === "Escape" && this.pts.length) {
      this.pts = [];
      this.ctx.viewport.setPreviewLines(null);
      return true;
    }
    return false;
  }
}
