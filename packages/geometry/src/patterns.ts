import type { PatternName, Vec2 } from "@open-bim/core";

// Fill patterns as families of parallel (optionally dashed) lines, like Revit/AutoCAD .pat files.
// Drafting patterns are sized in paper mm and scale with the view; model patterns are real size.

export interface LineFamily {
  /** Line direction, degrees from +x. */
  angle: number;
  /** Distance between lines. */
  spacing: number;
  /** Shift of the family along its normal. */
  offset?: number;
  /** Dash and gap lengths along the line; solid if omitted. */
  dash?: [number, number];
}

export interface PatternDef {
  units: "paper" | "model";
  families: LineFamily[];
}

export const PATTERN_DEFS: Record<Exclude<PatternName, "none" | "solid">, PatternDef> = {
  diagonal: { units: "paper", families: [{ angle: 45, spacing: 1.5 }] },
  crosshatch: { units: "paper", families: [{ angle: 45, spacing: 2 }, { angle: 135, spacing: 2 }] },
  concrete: {
    units: "paper",
    families: [
      { angle: 45, spacing: 2.5, dash: [0.6, 1.4] },
      { angle: 135, spacing: 3.5, offset: 1, dash: [0.3, 2.2] },
    ],
  },
  insulation: { units: "paper", families: [{ angle: 60, spacing: 1.2 }, { angle: 120, spacing: 1.2 }] },
  timber: { units: "paper", families: [{ angle: 30, spacing: 2.5 }, { angle: 150, spacing: 6, dash: [1.5, 1.5] }] },
  weatherboard: { units: "model", families: [{ angle: 0, spacing: 150 }] },
  brick: { units: "model", families: [{ angle: 0, spacing: 86 }] },
  tile300: { units: "model", families: [{ angle: 0, spacing: 300 }, { angle: 90, spacing: 300 }] },
};

/** Pattern line families in model mm for a view at 1:`scale` (null for none/solid). */
export function patternFamilies(name: PatternName, scale: number): LineFamily[] | null {
  if (name === "none" || name === "solid") return null;
  const def = PATTERN_DEFS[name];
  const k = def.units === "paper" ? scale : 1;
  return def.families.map((f) => ({
    angle: f.angle,
    spacing: f.spacing * k,
    offset: (f.offset ?? 0) * k,
    ...(f.dash ? { dash: [f.dash[0] * k, f.dash[1] * k] as [number, number] } : {}),
  }));
}

/**
 * Hatch a polygon (even-odd, so holes as extra loops work) with line families.
 * Lines are anchored to the origin, so neighbouring regions' patterns line up.
 * Returns segments [x0, y0, x1, y1, …].
 */
export function hatch(loops: Vec2[][], families: LineFamily[], maxLines = 4000): number[] {
  const out: number[] = [];
  const pts = loops.flat();
  if (pts.length < 3) return out;
  for (const f of families) {
    if (!(f.spacing > 0)) continue;
    const a = (f.angle * Math.PI) / 180;
    const d = { x: Math.cos(a), y: Math.sin(a) };
    const n = { x: -d.y, y: d.x };
    const off = f.offset ?? 0;
    const proj = pts.map((p) => p.x * n.x + p.y * n.y);
    const k0 = Math.ceil((Math.min(...proj) - off) / f.spacing);
    const k1 = Math.floor((Math.max(...proj) - off) / f.spacing);
    if (k1 - k0 > maxLines) continue; // pattern far too fine for this region: skip rather than flood
    const lo = Math.min(...proj);
    const hi = Math.max(...proj);
    const eps = 1e-6 * Math.max(1, f.spacing);
    for (let k = k0; k <= k1; k++) {
      const s = off + k * f.spacing;
      if (s - lo < eps || hi - s < eps) continue; // a line along the outline would just redraw it
      // Crossings of the line n·p = s with every edge, as distances along d.
      const ts: number[] = [];
      for (const loop of loops) {
        for (let i = 0; i < loop.length; i++) {
          const p = loop[i]!;
          const q = loop[(i + 1) % loop.length]!;
          const sp = p.x * n.x + p.y * n.y - s;
          const sq = q.x * n.x + q.y * n.y - s;
          if ((sp > 0) === (sq > 0) || sp === sq) continue;
          const t = sp / (sp - sq);
          ts.push((p.x + (q.x - p.x) * t) * d.x + (p.y + (q.y - p.y) * t) * d.y);
        }
      }
      ts.sort((x, y) => x - y);
      for (let i = 0; i + 1 < ts.length; i += 2) {
        for (const [t0, t1] of dashes(ts[i]!, ts[i + 1]!, f.dash)) {
          out.push(n.x * s + d.x * t0, n.y * s + d.y * t0, n.x * s + d.x * t1, n.y * s + d.y * t1);
        }
      }
    }
  }
  return out;
}

/** Split [t0, t1] into dashes anchored at t = 0. */
function dashes(t0: number, t1: number, dash?: [number, number]): [number, number][] {
  if (!dash || !(dash[0] > 0)) return [[t0, t1]];
  const period = dash[0] + dash[1];
  const out: [number, number][] = [];
  for (let start = Math.floor(t0 / period) * period; start < t1; start += period) {
    const a = Math.max(t0, start);
    const b = Math.min(t1, start + dash[0]);
    if (b > a) out.push([a, b]);
  }
  return out;
}
