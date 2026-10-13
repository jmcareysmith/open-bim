import type { Document, Element, FamilyInstance, LevelParams } from "@open-bim/core";
import type { LineData } from "./datums.ts";
import type { MeshData } from "./mesh.ts";

// Plan symbols for ceiling and wall MEP items (Revit draws them whatever the view range): an air
// terminal is its outline with diagonals, a light fitting a circle with a cross, a device or a
// switchboard its outline with one diagonal. Drawn just above the level, on that level's plans.

type Builder = (doc: Document, el: Element) => MeshData | null;
let solids: Builder | null = null;

/** The kernel sets how to build an instance's solid (avoids a circular import). */
export function setSymbolSolids(build: Builder): void {
  solids = build;
}

const SYMBOLS = new Set(["AirTerminal", "LightingFixture", "ElectricalFixture", "ElectricalEquipment"]);

export function buildMepSymbol(doc: Document, el: Element): LineData | null {
  const inst = el as FamilyInstance;
  const def = doc.get(inst.params.familyId);
  const category = (def?.params as { category?: string } | undefined)?.category ?? "";
  if (!SYMBOLS.has(category) || inst.params.hostId) return null;
  const mesh = solids?.(doc, el);
  if (!mesh || !mesh.positions.length) return null;
  // The footprint in the instance's own axes (so a turned terminal keeps its square).
  const { position: o, rotation } = inst.params;
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const dx = mesh.positions[i]! - o.x;
    const dy = mesh.positions[i + 1]! - o.y;
    const u = dx * c + dy * s;
    const v = -dx * s + dy * c;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  const z = (doc.get<LevelParams>(inst.params.levelId)?.params.elevation ?? 0) + 1;
  const at = (u: number, v: number): [number, number] => [o.x + u * c - v * s, o.y + u * s + v * c];
  const seg: number[] = [];
  const line = (a: [number, number], b: [number, number]) => seg.push(a[0], a[1], z, b[0], b[1], z);
  const corners = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
  if (category === "LightingFixture") {
    const cu = (u0 + u1) / 2;
    const cv = (v0 + v1) / 2;
    const r = Math.max(u1 - u0, v1 - v0) / 2;
    const n = 24;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * 2 * Math.PI;
      const a1 = ((i + 1) / n) * 2 * Math.PI;
      line(at(cu + r * Math.cos(a0), cv + r * Math.sin(a0)), at(cu + r * Math.cos(a1), cv + r * Math.sin(a1)));
    }
    line(at(cu - r * 1.3, cv), at(cu + r * 1.3, cv));
    line(at(cu, cv - r * 1.3), at(cu, cv + r * 1.3));
  } else {
    corners.forEach((p, i) => line(p, corners[(i + 1) % 4]!));
    line(corners[0]!, corners[2]!);
    if (category === "AirTerminal") line(corners[1]!, corners[3]!);
  }
  return { segments: new Float32Array(seg), labels: [], planOnly: true, placement: "model" };
}
