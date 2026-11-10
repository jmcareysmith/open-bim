import type { Document } from "../document.ts";
import type { ElementId, Vec2 } from "../element.ts";
import { Cat, floorExtent, wallExtent, type Floor, type LevelParams, type Wall } from "./architecture.ts";
import { columnExtent, type BeamParams, type Column, type EndFixity, type PadFootingParams, type StructuralSectionParams } from "./structure.ts";

// The structural analytical model (Revit: Analytical Model), derived from the physical one:
// - columns: their axis, base to top;
// - beams and braces: the section's centreline (half the depth below the top line);
// - walls: the mid-surface panel along the location line, base to top;
// - floors: the mid-depth panel over their outline.
// Member ends within ANALYTICAL_TOLERANCE of each other, or of a column's axis, share a node
// (Revit's auto-connect: beams framing into a column meet its axis). Column bases on a footing
// or at the lowest level are supports (pinned).

export const ANALYTICAL_TOLERANCE = 300;

type V3 = [number, number, number];

export interface AnalyticalNode {
  p: V3;
  /** A support (column base on a footing or at the lowest level, or as the column says). */
  support: boolean;
  /** The support's fixity (when `support`): pinned unless the column says fixed. */
  fixity?: EndFixity;
}

export interface AnalyticalMember {
  id: ElementId;
  kind: "column" | "beam" | "brace";
  a: number;
  b: number;
  /** How each end connects (columns are continuous: fixed; beams and braces pinned unless released otherwise). */
  ends: [EndFixity, EndFixity];
}

export interface AnalyticalPanel {
  id: ElementId;
  kind: "wall" | "floor";
  /** Closed outline, model mm. */
  loop: V3[];
}

export interface AnalyticalModel {
  nodes: AnalyticalNode[];
  members: AnalyticalMember[];
  panels: AnalyticalPanel[];
}

const d3 = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function analyticalModel(doc: Document): AnalyticalModel {
  const nodes: AnalyticalNode[] = [];
  const members: AnalyticalMember[] = [];
  const panels: AnalyticalPanel[] = [];
  const nodeAt = (p: V3): number => {
    const i = nodes.findIndex((n) => d3(n.p, p) <= ANALYTICAL_TOLERANCE);
    if (i >= 0) return i;
    nodes.push({ p, support: false });
    return nodes.length - 1;
  };

  // Columns first: their axes are what beams snap to.
  const lowest = Math.min(...doc.byCategory<LevelParams>(Cat.Level).map((l) => l.params.elevation), 0);
  const axes: { at: Vec2; bottom: number; top: number }[] = [];
  const pads = doc.byCategory<PadFootingParams>(Cat.PadFooting);
  for (const c of doc.byCategory(Cat.Column) as Column[]) {
    const { bottom, top } = columnExtent(doc, c);
    if (top <= bottom) continue;
    const at = c.params.position;
    axes.push({ at, bottom, top });
    const a = nodeAt([at.x, at.y, bottom]);
    const b = nodeAt([at.x, at.y, top]);
    members.push({ id: c.id, kind: "column", a, b, ends: ["fixed", "fixed"] });
    const onPad = pads.some((f) => {
      const lv = doc.get<LevelParams>(f.params.levelId)?.params.elevation ?? 0;
      return Math.hypot(f.params.position.x - at.x, f.params.position.y - at.y) <= Math.max(f.params.width, f.params.length) / 2 && Math.abs(lv + f.params.offset - bottom) <= ANALYTICAL_TOLERANCE;
    });
    const mode = c.params.baseSupport ?? "auto";
    if (mode === "pinned" || mode === "fixed") nodes[a]!.support = true;
    else if (mode === "auto" && (onPad || Math.abs(bottom - lowest) <= ANALYTICAL_TOLERANCE)) nodes[a]!.support = true;
    if (nodes[a]!.support) nodes[a]!.fixity = mode === "fixed" ? "fixed" : (nodes[a]!.fixity ?? "pinned");
  }

  /** A beam end, moved onto a column axis it frames into (within the tolerance in plan). */
  const snap = (p: V3): V3 => {
    for (const ax of axes) {
      if (Math.hypot(ax.at.x - p[0], ax.at.y - p[1]) <= ANALYTICAL_TOLERANCE && p[2] >= ax.bottom - ANALYTICAL_TOLERANCE && p[2] <= ax.top + ANALYTICAL_TOLERANCE) {
        return [ax.at.x, ax.at.y, p[2]];
      }
    }
    return p;
  };
  for (const b of doc.byCategory<BeamParams>(Cat.Beam)) {
    const p = b.params;
    const s = b.typeId ? doc.get<StructuralSectionParams>(b.typeId)?.params : undefined;
    const half = (s?.d ?? 0) / 2;
    const lv = doc.get<LevelParams>(p.levelId)?.params.elevation ?? 0;
    const a = snap([p.start.x, p.start.y, lv + p.offset - half]);
    const e = snap([p.end.x, p.end.y, lv + (p.endOffset ?? p.offset) - half]);
    if (d3(a, e) < 1) continue;
    members.push({ id: b.id, kind: p.brace ? "brace" : "beam", a: nodeAt(a), b: nodeAt(e), ends: [p.startFixity ?? "pinned", p.endFixity ?? "pinned"] });
  }

  for (const w of doc.byCategory(Cat.Wall) as Wall[]) {
    if (w.params.curve) continue;
    const { bottom, top } = wallExtent(doc, w);
    const { start: s, end: e } = w.params;
    panels.push({ id: w.id, kind: "wall", loop: [[s.x, s.y, bottom], [e.x, e.y, bottom], [e.x, e.y, top], [s.x, s.y, top]] });
  }
  for (const f of doc.byCategory(Cat.Floor) as Floor[]) {
    const { bottom, top } = floorExtent(doc, f);
    const z = (bottom + top) / 2;
    panels.push({ id: f.id, kind: "floor", loop: f.params.boundary.map((q): V3 => [q.x, q.y, z]) });
  }
  return { nodes, members, panels };
}
