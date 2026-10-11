import {
  Cat,
  PAPER_SIZES,
  currentRevision,
  effectiveGraphics,
  revisionNumber,
  sheetRevisions,
  projectSettings,
  viewportsOn,
  type Document,
  type ElementId,
  type Sheet,
  type View,
  type ViewParams,
  type Viewport,
} from "@open-bim/core";
import { addLineData, contentBounds, emptyDrawing, loopSegments, transformDrawing, viewDrawing, type Drawing } from "./drawing.ts";
import type { GeometryKernel } from "./kernel.ts";

// Sheet layout in paper mm (origin bottom-left): border, NZ-style title strip down the right-hand
// side, and each viewport's view drawn at its scale with a view title underneath.

const MARGIN = 10;
const TITLE_STRIP = 80;

export interface SheetDrawing extends Drawing {
  width: number;
  height: number;
  /** Paper-space rectangle of each viewport, for picking and selection. */
  viewports: { id: ElementId; min: { x: number; y: number }; max: { x: number; y: number } }[];
}

/** A viewport's view drawing moved onto the sheet. */
export function viewportDrawing(doc: Document, kernel: GeometryKernel, vp: Viewport): Drawing {
  const view = doc.get<ViewParams>(vp.params.viewId) as View | undefined;
  if (!view) return emptyDrawing();
  const d = viewDrawing(doc, kernel, view);
  const scale = effectiveGraphics(doc, view).scale;
  const cx = (d.bounds.min.x + d.bounds.max.x) / 2;
  const cy = (d.bounds.min.y + d.bounds.max.y) / 2;
  const a = 1 / scale;
  return transformDrawing(d, a, vp.params.centre.x - cx * a, vp.params.centre.y - cy * a);
}

export function sheetDrawing(doc: Document, kernel: GeometryKernel, sheet: Sheet): SheetDrawing {
  const { width, height } = PAPER_SIZES[sheet.params.size];
  const out: SheetDrawing = { ...emptyDrawing(), width, height, viewports: [] };
  const rect = (x0: number, y0: number, x1: number, y1: number) =>
    loopSegments([[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]]);
  const line = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y1];

  // Border and title strip.
  const right = width - MARGIN;
  const strip = right - TITLE_STRIP;
  out.strokes.push({ kind: "cut", segments: rect(MARGIN, MARGIN, right, height - MARGIN) });
  out.strokes.push({ kind: "annotation", segments: line(strip, MARGIN, strip, height - MARGIN) });

  // Title block fields, bottom up (sheet number largest, as in most NZ practice title blocks).
  const info = projectSettings(doc)?.params.info;
  const scales = [
    ...new Set(
      viewportsOn(doc, sheet.id).flatMap((vp) => {
        const v = doc.get<ViewParams>(vp.params.viewId) as View | undefined;
        return v ? [`1:${effectiveGraphics(doc, v).scale}`] : [];
      }),
    ),
  ];
  const fields: [string, string, number][] = [
    ["Sheet", sheet.params.number, 9],
    ["Revision", currentRevision(doc, sheet) || "-", 4],
    ["Sheet name", sheet.name ?? "", 4],
    ["Scale", scales.join(", ") || "-", 3],
    ["Date", sheet.params.issueDate, 3],
    ["Drawn / checked", [sheet.params.drawnBy, sheet.params.checkedBy].filter(Boolean).join(" / ") || "-", 3],
    ["Project number", info?.number || "-", 3],
    ["Client", info?.client || "-", 3],
    ["Address", info?.address || "-", 3],
    ["Project", info?.name || "Untitled project", 5],
  ];
  let y = MARGIN;
  for (const [label, value, size] of fields) {
    const h = Math.max(12, size * 2.6);
    out.texts.push({ text: label.toUpperCase(), x: strip + 3, y: y + h - 3, size: 1.8, align: "left" });
    out.texts.push({ text: value, x: strip + 3, y: y + (h - 4) / 2, size, align: "left" });
    y += h;
    out.strokes.push({ kind: "annotation", segments: line(strip, y, right, y) });
  }
  out.texts.push({ text: "Open-BIM", x: strip + 3, y: height - MARGIN - 6, size: 3, align: "left" });

  // Revision schedule at the top of the strip, latest first: Rev | Date | Description.
  const revs = sheetRevisions(doc, sheet);
  if (revs.length) {
    let ry = height - MARGIN - 12;
    out.strokes.push({ kind: "annotation", segments: line(strip, ry, right, ry) });
    out.texts.push({ text: "REV", x: strip + 3, y: ry - 3, size: 1.8, align: "left" });
    out.texts.push({ text: "DATE", x: strip + 12, y: ry - 3, size: 1.8, align: "left" });
    out.texts.push({ text: "DESCRIPTION", x: strip + 32, y: ry - 3, size: 1.8, align: "left" });
    ry -= 5;
    for (const r of [...revs].reverse()) {
      out.strokes.push({ kind: "annotation", segments: line(strip, ry, right, ry) });
      const ty = ry - 3.2;
      out.texts.push({ text: revisionNumber(doc, r), x: strip + 3, y: ty, size: 2.2, align: "left" });
      out.texts.push({ text: r.params.date, x: strip + 12, y: ty, size: 2.2, align: "left" });
      out.texts.push({ text: r.params.description, x: strip + 32, y: ty, size: 2.2, align: "left" });
      ry -= 6;
    }
    out.strokes.push({ kind: "annotation", segments: line(strip, ry, right, ry) });
  }
  // Annotation drawn on the sheet itself (revision clouds), in paper mm.
  for (const c of doc.byCategory(Cat.RevisionCloud)) {
    if ((c.params as { viewId: ElementId }).viewId !== sheet.id) continue;
    const lines = kernel.buildLines(doc, c);
    if (lines) addLineData(out, lines, "annotation", { id: c.id });
  }

  // Viewports, each with a title: number circle, view name, scale.
  viewportsOn(doc, sheet.id).forEach((vp, i) => {
    const view = doc.get<ViewParams>(vp.params.viewId) as View | undefined;
    if (!view) return;
    const d = viewportDrawing(doc, kernel, vp);
    out.strokes.push(...d.strokes.map((s) => ({ ...s, id: vp.id })));
    out.fills.push(...d.fills.map((f) => ({ ...f, id: vp.id })));
    out.texts.push(...d.texts);
    const b = contentBounds(d);
    out.viewports.push({ id: vp.id, min: b.min, max: b.max });
    const ty = b.min.y - 8;
    out.texts.push({ text: String(i + 1), x: b.min.x + 4, y: ty, size: 3, align: "center" });
    out.strokes.push({ kind: "annotation", segments: circle(b.min.x + 4, ty, 3.5) });
    out.texts.push({ text: (view.name ?? "View").toUpperCase(), x: b.min.x + 10, y: ty + 1.2, size: 3, align: "left" });
    out.texts.push({ text: `1:${effectiveGraphics(doc, view).scale}`, x: b.min.x + 10, y: ty - 3, size: 2, align: "left" });
    out.strokes.push({ kind: "cut", segments: line(b.min.x + 10, ty - 1, Math.max(b.min.x + 60, b.max.x), ty - 1) });
  });

  out.bounds = { min: { x: 0, y: 0 }, max: { x: width, y: height } };
  return out;
}

function circle(cx: number, cy: number, r: number): number[] {
  const seg: number[] = [];
  for (let i = 0; i < 24; i++) {
    const a0 = (i / 24) * 2 * Math.PI;
    const a1 = ((i + 1) / 24) * 2 * Math.PI;
    seg.push(cx + r * Math.cos(a0), cy + r * Math.sin(a0), cx + r * Math.cos(a1), cy + r * Math.sin(a1));
  }
  return seg;
}
