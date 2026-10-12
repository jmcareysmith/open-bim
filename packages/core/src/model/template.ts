import type { Document } from "../document.ts";
import type { ElementId } from "../element.ts";
import { Cat, createLevel, type Layer, type LayeredTypeParams } from "./architecture.ts";
import { createMaterial, type MaterialParams } from "./materials.ts";
import type { DoorTypeParams, WindowTypeParams } from "./doors.ts";
import { createProjectSettings } from "./settings.ts";
import { create3DView, createFloorPlan } from "./viewdefs.ts";

export interface TemplateIds {
  levels: { ground: ElementId; first: ElementId; roof: ElementId };
  wallTypes: { exterior: ElementId; interior: ElementId; curtain: ElementId };
  floorTypes: { slab: ElementId; timber: ElementId };
  ceilingTypes: { plasterboard: ElementId };
  roofTypes: { steel: ElementId };
  doorTypes: { single810: ElementId; single860: ElementId };
  windowTypes: { w1200x1200: ElementId; w1800x1200: ElementId; w600x600: ElementId };
}

/** Starter project: NZ residential levels and common NZS 3604-style assemblies. */
export function applyResidentialTemplate(doc: Document): TemplateIds {
  return doc.transact("New project from template", (tx) => {
    createProjectSettings(tx, doc);
    const ground = createLevel(tx, "Ground Floor", 0).id;
    const first = createLevel(tx, "First Floor", 2700).id;
    const roof = createLevel(tx, "Roof", 5400).id;
    for (const id of [ground, first, roof]) createFloorPlan(tx, doc, id);
    create3DView(tx, doc);

    // Materials: shading colour, cut pattern (plans/sections), surface pattern (elevations).
    const mats: [string, Partial<MaterialParams>][] = [
      ["Weatherboard", { color: 0xe4e0d4, cutPattern: "timber", surfacePattern: "weatherboard" }],
      ["Cavity Battens", { color: 0xb08a5a, cutPattern: "timber" }],
      ["Building Wrap", { color: 0x5b6670, cutPattern: "none" }],
      ["Timber Frame 90x45", { color: 0xc9a46b, cutPattern: "insulation" }],
      ["Plasterboard", { color: 0xf1efe9, cutPattern: "diagonal" }],
      ["Concrete", { color: 0xa7a8a6, cutPattern: "concrete" }],
      ["Plywood", { color: 0xc59a5b, cutPattern: "timber" }],
      ["Timber Joists 240x45", { color: 0xb88f55, cutPattern: "crosshatch" }],
      ["Ceiling Battens", { color: 0xb08a5a, cutPattern: "timber" }],
      ["Long-run Steel", { color: 0x5f6b75, cutPattern: "solid" }],
      ["Purlins 70x45", { color: 0xb08a5a, cutPattern: "timber" }],
      ["Rafters 140x45", { color: 0xb88f55, cutPattern: "crosshatch" }],
      ["Glazing", { color: 0xa9cfe3, cutPattern: "none" }],
      ["Aluminium", { color: 0x8a9199, cutPattern: "solid" }],
    ];
    const matId = new Map(mats.map(([name, p]) => [name, createMaterial(tx, doc, name, p).id]));
    const link = (layers: Layer[]): Layer[] => layers.map((l) => ({ ...l, materialId: matId.get(l.material)! }));

    const wt = (name: string, layers: Layer[]) => tx.create<LayeredTypeParams>(Cat.WallType, { layers: link(layers) }, { name }).id;
    const ft = (name: string, layers: Layer[]) => tx.create<LayeredTypeParams>(Cat.FloorType, { layers: link(layers) }, { name }).id;

    const exterior = wt("Exterior - Weatherboard, 90 Timber Frame", [
      { function: "finish1", material: "Weatherboard", thickness: 18 },
      { function: "substrate", material: "Cavity Battens", thickness: 20 },
      { function: "membrane", material: "Building Wrap", thickness: 1 },
      { function: "structure", material: "Timber Frame 90x45", thickness: 90 },
      { function: "finish2", material: "Plasterboard", thickness: 10 },
    ]);
    const interior = wt("Interior - 90 Timber Frame", [
      { function: "finish1", material: "Plasterboard", thickness: 10 },
      { function: "structure", material: "Timber Frame 90x45", thickness: 90 },
      { function: "finish2", material: "Plasterboard", thickness: 10 },
    ]);
    const curtain = tx.create<LayeredTypeParams>(
      Cat.WallType,
      {
        layers: link([{ function: "structure", material: "Aluminium", thickness: 100 }]),
        curtain: { uSpacing: 1200, vSpacing: 1500, mullionWidth: 50, mullionDepth: 100, panelThickness: 24, panelMaterialId: matId.get("Glazing")!, mullionMaterialId: matId.get("Aluminium")! },
      },
      { name: "Curtain Wall - Aluminium 1200 x 1500" },
    ).id;
    const slab = ft("Concrete Slab 100", [{ function: "structure", material: "Concrete", thickness: 100 }]);
    const timber = ft("Timber Floor - 20 Ply on 240 Joists", [
      { function: "finish1", material: "Plywood", thickness: 20 },
      { function: "structure", material: "Timber Joists 240x45", thickness: 240 },
    ]);

    const plasterboard = tx.create<LayeredTypeParams>(
      Cat.CeilingType,
      {
        layers: link([
          { function: "finish1", material: "Plasterboard", thickness: 13 },
          { function: "substrate", material: "Ceiling Battens", thickness: 35 },
        ]),
      },
      { name: "Ceiling - 13 Plasterboard on Battens" },
    ).id;

    const steel = tx.create<LayeredTypeParams>(
      Cat.RoofType,
      {
        layers: link([
          { function: "finish1", material: "Long-run Steel", thickness: 1 },
          { function: "substrate", material: "Purlins 70x45", thickness: 70 },
          { function: "structure", material: "Rafters 140x45", thickness: 140 },
        ]),
      },
      { name: "Roof - Long-run Steel on Purlins and Rafters" },
    ).id;

    // NZ standard leaf heights are 1980; common leaf widths 760/810/860.
    const door = (name: string, leafWidth: number) =>
      tx.create<DoorTypeParams>(Cat.DoorType, { leafWidth, leafHeight: 1980, frameWidth: 30 }, { name }).id;
    const single810 = door("Door - Single 810 x 1980", 810);
    const single860 = door("Door - Single 860 x 1980", 860);
    const win = (name: string, width: number, height: number, defaultSill: number) =>
      tx.create<WindowTypeParams>(Cat.WindowType, { width, height, frameWidth: 50, defaultSill }, { name }).id;
    const w1200x1200 = win("Window - Aluminium 1200 x 1200", 1200, 1200, 900);
    const w1800x1200 = win("Window - Aluminium 1800 x 1200", 1800, 1200, 900);
    const w600x600 = win("Window - Aluminium 600 x 600 (bathroom)", 600, 600, 1500);

    return {
      levels: { ground, first, roof },
      wallTypes: { exterior, interior, curtain },
      floorTypes: { slab, timber },
      ceilingTypes: { plasterboard },
      roofTypes: { steel },
      doorTypes: { single810, single860 },
      windowTypes: { w1200x1200, w1800x1200, w600x600 },
    };
  });
}
