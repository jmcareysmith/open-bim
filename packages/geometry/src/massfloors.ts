import { massFloors, type Document, type Element, type ElementId, type LevelParams, type MassFloor, type Vec2 } from "@open-bim/core";
import type { LineData } from "./datums.ts";
import { planLinework } from "./hlr.ts";
import { SimpleKernel } from "./kernel.ts";
import { meshVolume, signedArea, type MeshData } from "./mesh.ts";

// Mass floor areas: the mass's solid cut at the floor's level (the same cut plans use), so
// floor area and perimeter follow the mass as it's edited.

let kernel: SimpleKernel | null = null;
function massMesh(doc: Document, massId: ElementId): MeshData | null {
  const mass = doc.get(massId);
  if (!mass) return null;
  kernel ??= new SimpleKernel();
  try {
    return kernel.build(doc, mass);
  } catch {
    return null;
  }
}

/** Outline loops of a mass floor (plan mm), and its height. */
export function massFloorLoops(doc: Document, mf: MassFloor): { loops: Vec2[][]; z: number } {
  const z = doc.get<LevelParams>(mf.params.levelId)?.params.elevation ?? 0;
  const mesh = massMesh(doc, mf.params.massId);
  if (!mesh) return { loops: [], z };
  // Cut a hair above the level so a mass standing on it is still cut at its base.
  const cut = z + 1;
  const [lw] = planLinework([{ id: mf.params.massId, mesh }], { bottom: cut - 1, cut });
  return { loops: lw?.cutLoops ?? [], z };
}

/** Floor area (mm²) and perimeter (mm) of a mass floor. Holes (courtyards) subtract. */
export function massFloorArea(doc: Document, mf: MassFloor): { area: number; perimeter: number } {
  const { loops } = massFloorLoops(doc, mf);
  let area = 0;
  let perimeter = 0;
  for (const l of loops) {
    area += signedArea(l);
    for (let i = 0; i < l.length; i++) {
      const a = l[i]!;
      const b = l[(i + 1) % l.length]!;
      perimeter += Math.hypot(b.x - a.x, b.y - a.y);
    }
  }
  return { area: Math.abs(area), perimeter };
}

/** A mass's gross floor area (all its floors), gross volume and floor count. */
export function massTotals(doc: Document, massId: ElementId): { floorArea: number; volume: number; floors: number } {
  const floors = massFloors(doc, massId);
  const mesh = massMesh(doc, massId);
  return { floorArea: floors.reduce((s, f) => s + massFloorArea(doc, f).area, 0), volume: mesh ? meshVolume(mesh) : 0, floors: floors.length };
}

/** Mass floors draw as their outline at their level (shown with Show Mass). */
export function buildMassFloorLines(doc: Document, el: Element): LineData | null {
  const { loops, z } = massFloorLoops(doc, el as MassFloor);
  if (!loops.length) return null;
  const seg: number[] = [];
  for (const l of loops) l.forEach((p, i) => seg.push(p.x, p.y, z, l[(i + 1) % l.length]!.x, l[(i + 1) % l.length]!.y, z));
  return { segments: new Float32Array(seg), labels: [], placement: "model" };
}
