import { elementMaterial, type Document, type Element } from "@open-bim/core";
import type { GeometryKernel } from "./kernel.ts";
import type { MeshData } from "./mesh.ts";

// Model export for visualisation: binary glTF 2.0 (.glb) and Wavefront OBJ (+ MTL). Every element
// with geometry becomes one node/object named after it, coloured by its material (or category
// default). Model mm Z-up becomes metres Y-up (glTF's convention; OBJ follows the same).

export interface ExportedPart {
  el: Element;
  mesh: MeshData;
  color: number;
}

const DEFAULT = 0xcccccc;

/** Elements' meshes with colours; elements that fail to build are skipped. */
export function exportParts(doc: Document, kernel: GeometryKernel, colours: Record<string, number> = {}): ExportedPart[] {
  const out: ExportedPart[] = [];
  for (const el of doc.all()) {
    let mesh: MeshData | null = null;
    try {
      mesh = kernel.build(doc, el);
    } catch {
      mesh = null;
    }
    if (!mesh || !mesh.indices.length) continue;
    const color = elementMaterial(doc, el)?.params.color ?? (el.params as { color?: number }).color ?? colours[el.category] ?? DEFAULT;
    out.push({ el, mesh, color });
  }
  return out;
}

/** mm Z-up → m Y-up. */
const toY = (x: number, y: number, z: number): [number, number, number] => [x / 1000, z / 1000, -y / 1000];

const label = (el: Element) => `${el.name ?? el.category} [${el.id.slice(0, 8)}]`;

export function exportGlb(parts: ExportedPart[], name = "Open-BIM model"): Uint8Array {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const views: { buffer: number; byteOffset: number; byteLength: number; target: number }[] = [];
  const accessors: Record<string, unknown>[] = [];
  const meshes: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];
  const materials: Record<string, unknown>[] = [];
  const matIndex = new Map<number, number>();
  const push = (data: ArrayBufferView, target: number) => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      byteLength += pad;
    }
    views.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, target });
    chunks.push(bytes);
    byteLength += bytes.length;
    return views.length - 1;
  };
  for (const p of parts) {
    const n = p.mesh.positions.length / 3;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      const v = toY(p.mesh.positions[i * 3]!, p.mesh.positions[i * 3 + 1]!, p.mesh.positions[i * 3 + 2]!);
      pos.set(v, i * 3);
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k]!, v[k]!);
        max[k] = Math.max(max[k]!, v[k]!);
      }
      const nx = p.mesh.normals[i * 3] ?? 0;
      const ny = p.mesh.normals[i * 3 + 1] ?? 0;
      const nz = p.mesh.normals[i * 3 + 2] ?? 0;
      const l = Math.hypot(nx, ny, nz) || 1;
      nor.set([nx / l, nz / l, -ny / l], i * 3);
    }
    const idx = Uint32Array.from(p.mesh.indices);
    const pv = push(pos, 34962);
    const nv = push(nor, 34962);
    const iv = push(idx, 34963);
    accessors.push({ bufferView: pv, componentType: 5126, count: n, type: "VEC3", min, max });
    accessors.push({ bufferView: nv, componentType: 5126, count: n, type: "VEC3" });
    accessors.push({ bufferView: iv, componentType: 5125, count: idx.length, type: "SCALAR" });
    let m = matIndex.get(p.color);
    if (m === undefined) {
      m = materials.length;
      matIndex.set(p.color, m);
      const c = [(p.color >> 16) & 255, (p.color >> 8) & 255, p.color & 255].map((x) => srgbToLinear(x / 255));
      materials.push({ name: `#${p.color.toString(16).padStart(6, "0")}`, pbrMetallicRoughness: { baseColorFactor: [...c, 1], metallicFactor: 0, roughnessFactor: 0.9 }, doubleSided: true });
    }
    const a = accessors.length - 3;
    meshes.push({ name: label(p.el), primitives: [{ attributes: { POSITION: a, NORMAL: a + 1 }, indices: a + 2, material: m }] });
    nodes.push({ name: label(p.el), mesh: meshes.length - 1, extras: { id: p.el.id, category: p.el.category } });
  }
  const gltf = {
    asset: { version: "2.0", generator: "Open-BIM" },
    scene: 0,
    scenes: [{ name, nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength }],
  };
  const enc = new TextEncoder();
  let json: Uint8Array = enc.encode(JSON.stringify(gltf));
  const jsonPad = (4 - (json.length % 4)) % 4;
  if (jsonPad) json = concat([json, enc.encode(" ".repeat(jsonPad))]);
  const binPad = (4 - (byteLength % 4)) % 4;
  const bin = concat([...chunks, new Uint8Array(binPad)]);
  const total = 12 + 8 + json.length + (parts.length ? 8 + bin.length : 0);
  const header = new DataView(new ArrayBuffer(12));
  header.setUint32(0, 0x46546c67, true); // "glTF"
  header.setUint32(4, 2, true);
  header.setUint32(8, total, true);
  const chunkHead = (len: number, type: number) => {
    const d = new DataView(new ArrayBuffer(8));
    d.setUint32(0, len, true);
    d.setUint32(4, type, true);
    return new Uint8Array(d.buffer);
  };
  return concat([
    new Uint8Array(header.buffer),
    chunkHead(json.length, 0x4e4f534a),
    json,
    ...(parts.length ? [chunkHead(bin.length, 0x004e4942), bin] : []),
  ]);
}

/** OBJ text and its MTL; the OBJ references the MTL by `mtlName`. */
export function exportObj(parts: ExportedPart[], mtlName = "model.mtl"): { obj: string; mtl: string } {
  const obj: string[] = ["# Open-BIM OBJ export (metres, Y up)", `mtllib ${mtlName}`];
  const mtl: string[] = ["# Open-BIM materials"];
  const used = new Set<number>();
  let base = 1;
  let nBase = 1;
  for (const p of parts) {
    const mat = `c${p.color.toString(16).padStart(6, "0")}`;
    if (!used.has(p.color)) {
      used.add(p.color);
      const [r, g, b] = [(p.color >> 16) & 255, (p.color >> 8) & 255, p.color & 255].map((x) => (x / 255).toFixed(4));
      mtl.push(`newmtl ${mat}`, `Kd ${r} ${g} ${b}`, "Ka 0 0 0", "d 1", "illum 1", "");
    }
    obj.push(`o ${label(p.el).replace(/\s+/g, "_")}`, `usemtl ${mat}`);
    const n = p.mesh.positions.length / 3;
    for (let i = 0; i < n; i++) {
      const v = toY(p.mesh.positions[i * 3]!, p.mesh.positions[i * 3 + 1]!, p.mesh.positions[i * 3 + 2]!);
      obj.push(`v ${v.map((x) => +x.toFixed(5)).join(" ")}`);
    }
    for (let i = 0; i < n; i++) {
      const nx = p.mesh.normals[i * 3] ?? 0;
      const ny = p.mesh.normals[i * 3 + 1] ?? 0;
      const nz = p.mesh.normals[i * 3 + 2] ?? 0;
      obj.push(`vn ${+nx.toFixed(4)} ${+nz.toFixed(4)} ${+(-ny).toFixed(4)}`);
    }
    for (let t = 0; t < p.mesh.indices.length; t += 3) {
      const f = [p.mesh.indices[t]!, p.mesh.indices[t + 1]!, p.mesh.indices[t + 2]!].map((i) => `${i + base}//${i + nBase}`);
      obj.push(`f ${f.join(" ")}`);
    }
    base += n;
    nBase += n;
  }
  return { obj: obj.join("\n") + "\n", mtl: mtl.join("\n") };
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function concat(arrs: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrs.reduce((s, a) => s + a.length, 0));
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}
