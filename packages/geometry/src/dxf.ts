import { toShared, type CadImportParams, type Document, type Element, type SiteLocation, type Vec2 } from "@open-bim/core";
import type { LineData } from "./datums.ts";
import type { Drawing, StrokeKind } from "./drawing.ts";

// DXF (R12 ASCII, AC1009 — the version every CAD package reads, no handles needed) for 2D
// drawings: export a view/sheet drawing with layers by category and line kind; parse DXF line work
// (LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC, TEXT/MTEXT, INSERT of blocks) back into segments and texts.

/** AutoCAD colour index per line kind. */
const KIND_COLOUR: Record<StrokeKind, number> = { cut: 7, beyond: 8, surface: 9, hatch: 8, annotation: 7, datum: 5, symbol: 7 };

/** Layer for a stroke: "<Category>-<kind>" (e.g. "Wall-Cut"), or the kind alone. */
function layerName(doc: Document | undefined, id: string | undefined, kind: string): string {
  const cat = id && doc ? doc.get(id)?.category : undefined;
  const k = kind[0]!.toUpperCase() + kind.slice(1);
  return (cat ? `${cat}-${k}` : k).replace(/[^A-Za-z0-9_-]/g, "_");
}

/**
 * DXF text of a drawing. Coordinates are the drawing's (model mm for views, paper mm for sheets),
 * or — for plans with `shared` — map coordinates in metres (Revit's "shared" coordinate basis).
 */
export function drawingDxf(d0: Drawing, doc?: Document, opts: { shared?: SiteLocation } = {}): string {
  const d = opts.shared ? sharedDrawing(d0, opts.shared) : d0;
  const out: string[] = [];
  const g = (code: number, value: string | number) => out.push(String(code), typeof value === "number" ? num(value) : value);
  const layers = new Map<string, number>();
  const ents: string[] = [];
  const e = (code: number, value: string | number) => ents.push(String(code), typeof value === "number" ? num(value) : value);

  for (const s of d.strokes) {
    const layer = layerName(doc, s.id, s.kind);
    layers.set(layer, KIND_COLOUR[s.kind]);
    for (let i = 0; i + 3 < s.segments.length; i += 4) {
      e(0, "LINE");
      e(8, layer);
      if (s.dashed) e(6, "DASHED");
      e(10, s.segments[i]!);
      e(20, s.segments[i + 1]!);
      e(30, 0);
      e(11, s.segments[i + 2]!);
      e(21, s.segments[i + 3]!);
      e(31, 0);
    }
  }
  for (const f of d.fills) {
    // R12 has no hatch: fills go out as closed polylines on their own layer.
    const layer = layerName(doc, f.id, `Fill-${f.kind}`);
    layers.set(layer, 8);
    for (const loop of f.loops) {
      if (loop.length < 3) continue;
      e(0, "POLYLINE");
      e(8, layer);
      e(66, 1);
      e(70, 1);
      for (const p of loop) {
        e(0, "VERTEX");
        e(8, layer);
        e(10, p.x);
        e(20, p.y);
        e(30, 0);
      }
      e(0, "SEQEND");
      e(8, layer);
    }
  }
  if (d.texts.length) layers.set("Text", 7);
  for (const t of d.texts) {
    e(0, "TEXT");
    e(8, "Text");
    e(10, t.x);
    e(20, t.y);
    e(30, 0);
    e(40, t.size);
    e(1, t.text.replace(/[\r\n]+/g, " "));
    // Centred text: horizontal centre (72=1), vertical middle (73=2), aligned at the second point.
    if (t.align === "center") {
      e(72, 1);
      e(11, t.x);
      e(21, t.y);
      e(31, 0);
      e(73, 2);
    } else {
      e(72, 0);
      e(11, t.x);
      e(21, t.y);
      e(31, 0);
      e(73, 2);
    }
  }

  g(0, "SECTION");
  g(2, "HEADER");
  g(9, "$ACADVER");
  g(1, "AC1009");
  g(9, "$INSUNITS");
  g(70, opts.shared ? 6 : 4); // metres or millimetres
  g(9, "$EXTMIN");
  g(10, d.bounds.min.x);
  g(20, d.bounds.min.y);
  g(9, "$EXTMAX");
  g(10, d.bounds.max.x);
  g(20, d.bounds.max.y);
  g(0, "ENDSEC");
  g(0, "SECTION");
  g(2, "TABLES");
  g(0, "TABLE");
  g(2, "LTYPE");
  g(70, 2);
  for (const [name, desc, pattern] of [
    ["CONTINUOUS", "Solid line", [] as number[]],
    ["DASHED", "Dashed __ __ __", [6, -3]],
  ] as const) {
    g(0, "LTYPE");
    g(2, name);
    g(70, 0);
    g(3, desc);
    g(72, 65);
    g(73, pattern.length);
    g(40, pattern.reduce((s, x) => s + Math.abs(x), 0));
    for (const x of pattern) g(49, x);
  }
  g(0, "ENDTAB");
  g(0, "TABLE");
  g(2, "LAYER");
  g(70, layers.size + 1);
  for (const [name, colour] of [["0", 7] as const, ...layers]) {
    g(0, "LAYER");
    g(2, name);
    g(70, 0);
    g(62, colour);
    g(6, "CONTINUOUS");
  }
  g(0, "ENDTAB");
  g(0, "ENDSEC");
  g(0, "SECTION");
  g(2, "ENTITIES");
  out.push(...ents);
  g(0, "ENDSEC");
  g(0, "EOF");
  return out.join("\r\n") + "\r\n";
}

/** A plan drawing moved into map coordinates (metres). */
function sharedDrawing(d: Drawing, loc: SiteLocation): Drawing {
  const pt = (x: number, y: number) => {
    const q = toShared(loc, { x, y });
    return [q.e, q.n] as const;
  };
  const seg = (s: number[]) => {
    const out: number[] = [];
    for (let i = 0; i + 1 < s.length; i += 2) out.push(...pt(s[i]!, s[i + 1]!));
    return out;
  };
  const corners = [pt(d.bounds.min.x, d.bounds.min.y), pt(d.bounds.max.x, d.bounds.max.y), pt(d.bounds.min.x, d.bounds.max.y), pt(d.bounds.max.x, d.bounds.min.y)];
  return {
    strokes: d.strokes.map((s) => ({ ...s, segments: seg(s.segments) })),
    fills: d.fills.map((f) => ({ ...f, loops: f.loops.map((l) => l.map((p) => ({ x: pt(p.x, p.y)[0], y: pt(p.x, p.y)[1] }))) })),
    texts: d.texts.map((t) => ({ ...t, x: pt(t.x, t.y)[0], y: pt(t.x, t.y)[1], size: t.size / 1000 })),
    bounds: {
      min: { x: Math.min(...corners.map((c) => c[0])), y: Math.min(...corners.map((c) => c[1])) },
      max: { x: Math.max(...corners.map((c) => c[0])), y: Math.max(...corners.map((c) => c[1])) },
    },
  };
}

function num(v: number): string {
  const r = Math.round(v * 1e6) / 1e6;
  return Number.isInteger(r) ? `${r}.0` : String(r);
}

// ---- reading -------------------------------------------------------------------------------

export interface DxfContent {
  /** [x0, y0, x1, y1, …] in mm. */
  segments: number[];
  texts: { text: string; x: number; y: number; size: number }[];
  layers: string[];
  /** Millimetres per drawing unit applied. */
  scale: number;
}

const INSUNITS_MM: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 14: 100 };

interface Entity {
  type: string;
  codes: [number, string][];
}

/** Parse DXF (ASCII, any version) into line work in mm. Curves become 32-segment polylines per circle. */
export function parseDxf(text: string, defaultScale = 1): DxfContent {
  const lines = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i]!.trim(), 10), lines[i + 1]!.trim()]);

  // Split into sections of entities.
  let scale = defaultScale;
  const blocks = new Map<string, { base: Vec2; ents: Entity[] }>();
  const entities: Entity[] = [];
  let section = "";
  let current: Entity | null = null;
  let block: { name: string; base: Vec2; ents: Entity[] } | null = null;
  let headerVar = "";
  const flush = () => {
    if (!current) return;
    if (block && current.type !== "BLOCK" && current.type !== "ENDBLK") block.ents.push(current);
    else if (section === "ENTITIES") entities.push(current);
    current = null;
  };
  for (let i = 0; i < pairs.length; i++) {
    const [code, value] = pairs[i]!;
    if (code === 0) {
      flush();
      if (value === "SECTION") {
        section = pairs[i + 1]?.[0] === 2 ? pairs[i + 1]![1] : "";
        i++;
        continue;
      }
      if (value === "ENDSEC") {
        section = "";
        continue;
      }
      if (section === "BLOCKS" && value === "BLOCK") {
        block = { name: "", base: { x: 0, y: 0 }, ents: [] };
        current = { type: "BLOCK", codes: [] };
        continue;
      }
      if (section === "BLOCKS" && value === "ENDBLK") {
        if (block) blocks.set(block.name, block);
        block = null;
        continue;
      }
      current = { type: value, codes: [] };
      continue;
    }
    if (section === "HEADER") {
      if (code === 9) headerVar = value;
      else if (headerVar === "$INSUNITS" && code === 70) scale = INSUNITS_MM[parseInt(value, 10)] ?? defaultScale;
      continue;
    }
    if (current) {
      current.codes.push([code, value]);
      if (current.type === "BLOCK" && block) {
        if (code === 2) block.name = value;
        if (code === 10) block.base.x = parseFloat(value);
        if (code === 20) block.base.y = parseFloat(value);
      }
    }
  }
  flush();

  const out: DxfContent = { segments: [], texts: [], layers: [], scale };
  const layerSet = new Set<string>();
  type Xf = (p: Vec2) => Vec2;
  const emit = (ents: Entity[], xf: Xf, depth: number) => {
    let poly: { pts: Vec2[]; closed: boolean } | null = null;
    const endPoly = () => {
      if (poly && poly.pts.length > 1) addPolyline(poly.pts, poly.closed, xf);
      poly = null;
    };
    for (const en of ents) {
      const v = (c: number) => en.codes.find(([k]) => k === c)?.[1];
      const f = (c: number, d = 0) => parseFloat(v(c) ?? `${d}`);
      const layer = v(8);
      if (layer) layerSet.add(layer);
      switch (en.type) {
        case "LINE":
          seg(xf({ x: f(10), y: f(20) }), xf({ x: f(11), y: f(21) }));
          break;
        case "LWPOLYLINE": {
          const pts: Vec2[] = [];
          for (const [c, val] of en.codes) {
            if (c === 10) pts.push({ x: parseFloat(val), y: 0 });
            else if (c === 20 && pts.length) pts[pts.length - 1]!.y = parseFloat(val);
          }
          addPolyline(pts, (parseInt(v(70) ?? "0", 10) & 1) === 1, xf);
          break;
        }
        case "POLYLINE":
          endPoly();
          poly = { pts: [], closed: (parseInt(v(70) ?? "0", 10) & 1) === 1 };
          break;
        case "VERTEX":
          (poly as { pts: Vec2[] } | null)?.pts.push({ x: f(10), y: f(20) });
          break;
        case "SEQEND":
          endPoly();
          break;
        case "CIRCLE":
          arc(f(10), f(20), f(40), 0, 360, xf);
          break;
        case "ARC":
          arc(f(10), f(20), f(40), f(50), f(51), xf);
          break;
        case "TEXT":
        case "MTEXT": {
          const raw = en.codes.filter(([c]) => c === 1 || c === 3).map(([, t]) => t).join("");
          const t = raw.replace(/\\P/g, " ").replace(/\\[A-Za-z][^;]*;/g, "").replace(/[{}]/g, "");
          const p = xf({ x: f(10), y: f(20) });
          if (t) out.texts.push({ text: t, x: p.x, y: p.y, size: f(40, 2.5) * scale });
          break;
        }
        case "INSERT": {
          const b = blocks.get(v(2) ?? "");
          if (!b || depth > 8) break;
          const ip = { x: f(10), y: f(20) };
          const sx = f(41, 1);
          const sy = f(42, 1);
          const rot = (f(50) * Math.PI) / 180;
          const c = Math.cos(rot);
          const s = Math.sin(rot);
          emit(
            b.ents,
            (p) => {
              const x = (p.x - b.base.x) * sx;
              const y = (p.y - b.base.y) * sy;
              return xf({ x: ip.x + x * c - y * s, y: ip.y + x * s + y * c });
            },
            depth + 1,
          );
          break;
        }
        default:
          break;
      }
    }
    endPoly();
  };
  const seg = (a: Vec2, b: Vec2) => out.segments.push(a.x, a.y, b.x, b.y);
  const addPolyline = (pts: Vec2[], closed: boolean, xf: Xf) => {
    const q = pts.map(xf);
    for (let i = 0; i + 1 < q.length; i++) seg(q[i]!, q[i + 1]!);
    if (closed && q.length > 2) seg(q[q.length - 1]!, q[0]!);
  };
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number, xf: Xf) => {
    let sweep = a1 - a0;
    if (sweep <= 0) sweep += 360;
    const n = Math.max(4, Math.ceil((32 * sweep) / 360));
    let prev = xf({ x: cx + r * Math.cos((a0 * Math.PI) / 180), y: cy + r * Math.sin((a0 * Math.PI) / 180) });
    for (let i = 1; i <= n; i++) {
      const a = ((a0 + (sweep * i) / n) * Math.PI) / 180;
      const p = xf({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      seg(prev, p);
      prev = p;
    }
  };
  emit(entities, (p) => ({ x: p.x * scale, y: p.y * scale }), 0);
  out.layers = [...layerSet];
  return out;
}

/** A CAD import's line work in its view (offset applied). */
export function buildCadImportLines(_doc: Document, el: Element): LineData {
  const p = el.params as CadImportParams;
  const seg = new Float32Array((p.segments.length / 4) * 6);
  for (let i = 0, j = 0; i + 3 < p.segments.length; i += 4, j += 6) {
    seg[j] = p.segments[i]! + p.offset.x;
    seg[j + 1] = p.segments[i + 1]! + p.offset.y;
    seg[j + 3] = p.segments[i + 2]! + p.offset.x;
    seg[j + 4] = p.segments[i + 3]! + p.offset.y;
  }
  return {
    segments: seg,
    labels: p.texts.map((t) => ({ text: t.text, position: [t.x + p.offset.x, t.y + p.offset.y, 0] as [number, number, number], size: t.size, align: "left" as const })),
  };
}
