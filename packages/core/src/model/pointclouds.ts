import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element } from "../element.ts";
import { Cat } from "./architecture.ts";
import { fromShared, projectLocation } from "./settings.ts";

// Point clouds (Revit: Insert → Point Cloud): laser scans for existing buildings and sites. Files
// are read here (ASCII XYZ/PTS/TXT/CSV, and LAS 1.0–1.4 binary), thinned to at most
// MAX_POINT_CLOUD points so the project stays light, and stored in the element as base64 float32
// positions (project mm, relative to `origin`) with optional 8-bit colours.

export const MAX_POINT_CLOUD = 200_000;

export type PointCloudParams = {
  /** Where the stored positions are measured from, project mm (moving the cloud changes this). */
  origin: { x: number; y: number; z: number };
  count: number;
  /** base64 Float32Array, xyz per point, mm from `origin`. */
  positions: string;
  /** base64 Uint8Array, rgb per point; null when the scan has no colour. */
  colors: string | null;
  /** Points in the source file before thinning. */
  sourceCount: number;
  /** Displayed point size, px. */
  pointSize?: number | null;
};
export type PointCloud = Element<PointCloudParams>;

registerCategory({ name: Cat.PointCloud, dependencies: () => [], cascadeDelete: false, isType: false });

/** Points read from a file: map/local coordinates in metres, colours 0–255 (or null). */
export interface RawPoints {
  xyz: Float64Array;
  rgb: Uint8Array | null;
  /** Points in the file (xyz may hold fewer: read with a stride). */
  total: number;
}

/**
 * ASCII scans: one point per line, "x y z [intensity] [r g b]" (space, comma or tab separated).
 * PTS files start with a count line; headers and comments are skipped. Colour is taken from the
 * last three columns when there are six or more and they look like 0–255 values.
 */
export function parseAsciiPoints(text: string, max = MAX_POINT_CLOUD): RawPoints {
  const lines = text.split(/\r?\n/);
  const rows: number[][] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith("//")) continue;
    const v = t.split(/[\s,;]+/).map(Number);
    if (v.length < 3 || !v.slice(0, 3).every(Number.isFinite)) continue;
    rows.push(v);
  }
  const stride = Math.max(1, Math.ceil(rows.length / max));
  const n = Math.ceil(rows.length / stride);
  const xyz = new Float64Array(n * 3);
  const colored = rows.length > 0 && rows[0]!.length >= 6 && rows.slice(0, 50).every((r) => r.slice(-3).every((c) => Number.isInteger(c) && c >= 0 && c <= 255));
  const rgb = colored ? new Uint8Array(n * 3) : null;
  for (let i = 0, k = 0; i < rows.length; i += stride, k++) {
    const r = rows[i]!;
    xyz.set([r[0]!, r[1]!, r[2]!], k * 3);
    if (rgb) rgb.set(r.slice(-3), k * 3);
  }
  return { xyz, rgb, total: rows.length };
}

/** LAS 1.0–1.4 (point formats 0–10): positions scaled and offset as the header says. */
export function parseLas(buf: ArrayBuffer, max = MAX_POINT_CLOUD): RawPoints {
  const dv = new DataView(buf);
  const sig = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (sig !== "LASF") throw new Error("Not a LAS file");
  const minor = dv.getUint8(25);
  const offset = dv.getUint32(96, true);
  const format = dv.getUint8(104) & 0x3f;
  const recLen = dv.getUint16(105, true);
  let total = dv.getUint32(107, true);
  if (minor >= 4 && total === 0 && buf.byteLength >= 255) total = Number(dv.getBigUint64(247, true));
  total = Math.min(total, Math.floor((buf.byteLength - offset) / recLen));
  const scale = [dv.getFloat64(131, true), dv.getFloat64(139, true), dv.getFloat64(147, true)];
  const off = [dv.getFloat64(155, true), dv.getFloat64(163, true), dv.getFloat64(171, true)];
  // Where RGB sits in each record (16-bit channels), by point format.
  const rgbAt: Record<number, number> = { 2: 20, 3: 28, 5: 28, 7: 30, 8: 30, 10: 30 };
  const ci = rgbAt[format];
  const stride = Math.max(1, Math.ceil(total / max));
  const n = Math.ceil(total / stride);
  const xyz = new Float64Array(n * 3);
  const rgb = ci !== undefined ? new Uint8Array(n * 3) : null;
  // 16-bit colour is usually full range, but some writers store 0–255.
  let wide = false;
  if (rgb) for (let i = 0; i < Math.min(total, 200); i++) for (let c = 0; c < 3; c++) if (dv.getUint16(offset + i * recLen + ci! + c * 2, true) > 255) wide = true;
  for (let i = 0, k = 0; i < total; i += stride, k++) {
    const o = offset + i * recLen;
    for (let a = 0; a < 3; a++) xyz[k * 3 + a] = dv.getInt32(o + a * 4, true) * scale[a]! + off[a]!;
    if (rgb) for (let c = 0; c < 3; c++) rgb[k * 3 + c] = wide ? dv.getUint16(o + ci! + c * 2, true) >> 8 : dv.getUint16(o + ci! + c * 2, true);
  }
  return { xyz, rgb, total };
}

/**
 * Place raw points in the project: "shared" reads them as map coordinates (eastings, northings,
 * height in metres) through the project's location; "centre" puts the cloud's plan centre at the
 * project origin, keeping its heights.
 */
export function createPointCloud(tx: Transaction, doc: Document, raw: RawPoints, name: string, placement: "shared" | "centre"): PointCloud {
  const n = raw.xyz.length / 3;
  if (!n) throw new Error("No points found in that file");
  const loc = projectLocation(doc);
  let cx = 0;
  let cy = 0;
  if (placement === "centre") {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      x0 = Math.min(x0, raw.xyz[i * 3]!);
      x1 = Math.max(x1, raw.xyz[i * 3]!);
      y0 = Math.min(y0, raw.xyz[i * 3 + 1]!);
      y1 = Math.max(y1, raw.xyz[i * 3 + 1]!);
    }
    cx = (x0 + x1) / 2;
    cy = (y0 + y1) / 2;
  }
  const at = (i: number) => {
    const x = raw.xyz[i * 3]!;
    const y = raw.xyz[i * 3 + 1]!;
    const z = raw.xyz[i * 3 + 2]!;
    return placement === "shared" ? fromShared(loc, { e: x, n: y, h: z }) : { x: (x - cx) * 1000, y: (y - cy) * 1000, z: z * 1000 };
  };
  // Measure from the first point so float32 keeps millimetres.
  const origin = at(0);
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p = at(i);
    pos.set([p.x - origin.x, p.y - origin.y, p.z - origin.z], i * 3);
  }
  return tx.create<PointCloudParams>(
    Cat.PointCloud,
    { origin, count: n, positions: toBase64(new Uint8Array(pos.buffer)), colors: raw.rgb ? toBase64(raw.rgb) : null, sourceCount: raw.total, pointSize: 2 },
    { name },
  );
}

const decoded = new WeakMap<object, { positions: Float32Array; colors: Float32Array | null }>();

/** The cloud's points in project mm, and colours 0–1 (or null). Cached per params (they're replaced on edit). */
export function pointCloudPoints(el: PointCloud): { positions: Float32Array; colors: Float32Array | null } {
  const hit = decoded.get(el.params);
  if (hit) return hit;
  const out = decodePoints(el);
  decoded.set(el.params, out);
  return out;
}

function decodePoints(el: PointCloud): { positions: Float32Array; colors: Float32Array | null } {
  const p = el.params;
  const bytes = fromBase64(p.positions);
  const rel = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const positions = new Float32Array(rel.length);
  for (let i = 0; i < rel.length; i += 3) {
    positions[i] = rel[i]! + p.origin.x;
    positions[i + 1] = rel[i + 1]! + p.origin.y;
    positions[i + 2] = rel[i + 2]! + p.origin.z;
  }
  let colors: Float32Array | null = null;
  if (p.colors) {
    const c = fromBase64(p.colors);
    colors = new Float32Array(c.length);
    for (let i = 0; i < c.length; i++) colors[i] = c[i]! / 255;
  }
  return { positions, colors };
}

function toBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
