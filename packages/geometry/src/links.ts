import { linkDocument, linkTransform, type Document, type Element, type Link } from "@open-bim/core";
import type { GeometryKernel } from "./kernel.ts";
import { mergeMeshes } from "./doors.ts";
import type { MeshData } from "./mesh.ts";

// A linked project's geometry: every element of the snapshot built with the host's kernel (so OCCT
// cuts linked walls too), merged and moved into the host by the link's transform. Cached per
// kernel and snapshot; moving the link only re-applies the transform.

const cache = new WeakMap<GeometryKernel, WeakMap<object, MeshData | null>>();

function linkedMesh(kernel: GeometryKernel, link: Link): MeshData | null {
  let byJson = cache.get(kernel);
  if (!byJson) cache.set(kernel, (byJson = new WeakMap()));
  if (byJson.has(link.params.json)) return byJson.get(link.params.json)!;
  const ld = linkDocument(link);
  const parts: MeshData[] = [];
  for (const el of ld.all()) {
    try {
      const m = kernel.build(ld, el);
      if (m && m.indices.length) parts.push(m);
    } catch {
      // Elements that fail to build are left out of the link.
    }
  }
  const merged = parts.length ? mergeMeshes(parts) : null;
  byJson.set(link.params.json, merged);
  return merged;
}

export function buildLink(doc: Document, el: Element, kernel: GeometryKernel): MeshData | null {
  const link = el as Link;
  const m = linkedMesh(kernel, link);
  if (!m) return null;
  const xf = linkTransform(doc, link);
  const pos = new Float32Array(m.positions.length);
  const nor = new Float32Array(m.normals.length);
  const o = xf([0, 0, 0]);
  for (let i = 0; i < m.positions.length; i += 3) {
    const p = xf([m.positions[i]!, m.positions[i + 1]!, m.positions[i + 2]!]);
    pos.set(p, i);
    // Normals turn with the transform (it's rigid): move the origin by the normal and subtract.
    const q = xf([m.normals[i]!, m.normals[i + 1]!, m.normals[i + 2]!]);
    nor.set([q[0] - o[0], q[1] - o[1], q[2] - o[2]], i);
  }
  return { positions: pos, normals: nor, indices: m.indices };
}
