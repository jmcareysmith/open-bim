import { describe, expect, it } from "vitest";
import { Document, applyResidentialTemplate, createWall } from "@open-bim/core";
import { SimpleKernel, exportGlb, exportObj, exportParts } from "../src/index.ts";

function model() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  doc.transact("W", (tx) => {
    createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 4000, y: 0 }, ids.levels.ground, { topLevelId: ids.levels.first });
    createWall(tx, ids.wallTypes.interior, { x: 0, y: 2000 }, { x: 4000, y: 2000 }, ids.levels.ground, { height: 2400 });
  });
  return exportParts(doc, new SimpleKernel());
}

describe("glTF / OBJ export", () => {
  it("writes a valid GLB: header, JSON and BIN chunks, a node per element, metres Y-up", () => {
    const parts = model();
    expect(parts).toHaveLength(2);
    const glb = exportGlb(parts);
    const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    expect(dv.getUint32(0, true)).toBe(0x46546c67);
    expect(dv.getUint32(4, true)).toBe(2);
    expect(dv.getUint32(8, true)).toBe(glb.length);
    const jsonLen = dv.getUint32(12, true);
    expect(dv.getUint32(16, true)).toBe(0x4e4f534a);
    let text = "";
    for (const b of glb.subarray(20, 20 + jsonLen)) text += String.fromCharCode(b);
    const gltf = JSON.parse(text);
    expect(gltf.nodes).toHaveLength(2);
    expect(gltf.nodes[0].extras.category).toBe("Wall");
    // Exterior wall: 2.7 m tall along +Y; the wall runs along X 0..4 m.
    const pos = gltf.accessors[gltf.meshes[0].primitives[0].attributes.POSITION];
    expect(pos.max[1]).toBeCloseTo(2.7, 3);
    expect(pos.max[0]).toBeGreaterThan(3.9);
    expect(gltf.buffers[0].byteLength % 4).toBe(0);
    expect(dv.getUint32(20 + jsonLen + 4, true)).toBe(0x004e4942);
    expect(gltf.materials.length).toBeGreaterThanOrEqual(1);
  });

  it("writes OBJ with objects, materials and consistent indices", () => {
    const parts = model();
    const { obj, mtl } = exportObj(parts, "house.mtl");
    expect(obj).toContain("mtllib house.mtl");
    const verts = obj.split("\n").filter((l) => l.startsWith("v ")).length;
    const faces = obj.split("\n").filter((l) => l.startsWith("f "));
    expect(verts).toBe(parts.reduce((s, p) => s + p.mesh.positions.length / 3, 0));
    const maxIndex = Math.max(...faces.flatMap((f) => f.slice(2).split(" ").map((x) => Number(x.split("/")[0]))));
    expect(maxIndex).toBe(verts);
    expect(mtl).toMatch(/newmtl c[0-9a-f]{6}/);
    expect(obj.split("\n").filter((l) => l.startsWith("o "))).toHaveLength(2);
  });
});
