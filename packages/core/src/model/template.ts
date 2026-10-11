import type { Document } from "../document.ts";
import type { ElementId } from "../element.ts";
import { Cat, createLevel, type LayeredTypeParams } from "./architecture.ts";

export interface TemplateIds {
  levels: { ground: ElementId; first: ElementId; roof: ElementId };
  wallTypes: { exterior: ElementId; interior: ElementId };
  floorTypes: { slab: ElementId; timber: ElementId };
  ceilingTypes: { plasterboard: ElementId };
  roofTypes: { steel: ElementId };
}

/** Starter project: NZ residential levels and common NZS 3604-style assemblies. */
export function applyResidentialTemplate(doc: Document): TemplateIds {
  return doc.transact("New project from template", (tx) => {
    const ground = createLevel(tx, "Ground Floor", 0).id;
    const first = createLevel(tx, "First Floor", 2700).id;
    const roof = createLevel(tx, "Roof", 5400).id;

    const wt = (name: string, layers: LayeredTypeParams["layers"]) =>
      tx.create<LayeredTypeParams>(Cat.WallType, { layers }, { name }).id;
    const ft = (name: string, layers: LayeredTypeParams["layers"]) =>
      tx.create<LayeredTypeParams>(Cat.FloorType, { layers }, { name }).id;

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
    const slab = ft("Concrete Slab 100", [{ function: "structure", material: "Concrete", thickness: 100 }]);
    const timber = ft("Timber Floor - 20 Ply on 240 Joists", [
      { function: "finish1", material: "Plywood", thickness: 20 },
      { function: "structure", material: "Timber Joists 240x45", thickness: 240 },
    ]);

    const plasterboard = tx.create<LayeredTypeParams>(
      Cat.CeilingType,
      {
        layers: [
          { function: "finish1", material: "Plasterboard", thickness: 13 },
          { function: "substrate", material: "Ceiling Battens", thickness: 35 },
        ],
      },
      { name: "Ceiling - 13 Plasterboard on Battens" },
    ).id;

    const steel = tx.create<LayeredTypeParams>(
      Cat.RoofType,
      {
        layers: [
          { function: "finish1", material: "Long-run Steel", thickness: 1 },
          { function: "substrate", material: "Purlins 70x45", thickness: 70 },
          { function: "structure", material: "Rafters 140x45", thickness: 140 },
        ],
      },
      { name: "Roof - Long-run Steel on Purlins and Rafters" },
    ).id;

    return {
      levels: { ground, first, roof },
      wallTypes: { exterior, interior },
      floorTypes: { slab, timber },
      ceilingTypes: { plasterboard },
      roofTypes: { steel },
    };
  });
}
