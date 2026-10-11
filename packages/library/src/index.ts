import {
  Document,
  applyFamilyTemplate,
  createExtrusion,
  createFamilyParameter,
  createRevolution,
  familyInfo,
  type FamilyCategory,
  type FamilyInfoParams,
  type Num,
  type NumPt,
  type Transaction,
  type Values,
} from "@open-bim/core";

// The Open-BIM family library: parametric families written against the family API, so they're
// plain, reviewable code and export to the open .obim-family JSON format. Sizes follow common NZ
// residential practice. Hosted families use family X along the wall, Y across it, origin at the
// opening's bottom centre on the wall's location line.

export interface LibraryFamily {
  name: string;
  category: FamilyCategory;
  description: string;
  build(): Document;
}

/** Rectangle profile; corners may be formulas. */
const rect = (x0: Num, y0: Num, x1: Num, y1: Num): NumPt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** New family document with extra parameters and a set of types (replacing "Default"). */
function family(
  category: FamilyCategory,
  name: string,
  extra: [string, number][],
  types: [string, Values][],
  forms: (tx: Transaction, doc: Document) => void,
): Document {
  const doc = new Document();
  applyFamilyTemplate(doc, category, name);
  doc.transact("Build family", (tx) => {
    for (const [p, v] of extra) createFamilyParameter(tx, doc, p, { value: v });
    const info = familyInfo(doc)!;
    const base = info.params.types[0]!.values;
    tx.update<FamilyInfoParams>(info.id, {
      types: types.map(([t, values]) => ({ name: t, values: { ...base, ...Object.fromEntries(extra), ...values } })),
      currentType: types[0]![0],
    });
    forms(tx, doc);
  });
  return doc;
}

export const singleDoor: LibraryFamily = {
  name: "Door - Single Flush",
  category: "Door",
  description: "Hinged flush door in a timber frame. Width × Height is the frame opening.",
  build: () =>
    family(
      "Door",
      "Door - Single Flush",
      [
        ["Frame Width", 40],
        ["Frame Depth", 90],
        ["Leaf Thickness", 35],
      ],
      [
        ["760 x 1980", { Width: 840, Height: 2020 }],
        ["810 x 1980", { Width: 890, Height: 2020 }],
        ["860 x 1980", { Width: 940, Height: 2020 }],
      ],
      (tx) => {
        const d = "Frame Depth / 2";
        createExtrusion(tx, rect("-Width/2", `-${d}`, "-Width/2 + Frame Width", d), { end: "Height" });
        createExtrusion(tx, rect("Width/2 - Frame Width", `-${d}`, "Width/2", d), { end: "Height" });
        createExtrusion(tx, rect("-Width/2 + Frame Width", `-${d}`, "Width/2 - Frame Width", d), { start: "Height - Frame Width", end: "Height" });
        createExtrusion(tx, rect("-Width/2 + Frame Width + 2", "-Leaf Thickness/2", "Width/2 - Frame Width - 2", "Leaf Thickness/2"), {
          end: "Height - Frame Width - 2",
        });
      },
    ),
};

export const casementWindow: LibraryFamily = {
  name: "Window - Aluminium Casement",
  category: "Window",
  description: "Aluminium frame with a single glazed pane; sill height comes from Default Sill.",
  build: () =>
    family(
      "Window",
      "Window - Aluminium Casement",
      [
        ["Frame Width", 50],
        ["Frame Depth", 100],
        ["Default Sill", 900],
      ],
      [
        ["600 x 600", { Width: 600, Height: 600, "Default Sill": 1500 }],
        ["1200 x 1200", { Width: 1200, Height: 1200 }],
        ["1800 x 1200", { Width: 1800, Height: 1200 }],
      ],
      (tx) => {
        const d = "Frame Depth / 2";
        createExtrusion(tx, rect("-Width/2", `-${d}`, "-Width/2 + Frame Width", d), { end: "Height" });
        createExtrusion(tx, rect("Width/2 - Frame Width", `-${d}`, "Width/2", d), { end: "Height" });
        createExtrusion(tx, rect("-Width/2 + Frame Width", `-${d}`, "Width/2 - Frame Width", d), { end: "Frame Width" });
        createExtrusion(tx, rect("-Width/2 + Frame Width", `-${d}`, "Width/2 - Frame Width", d), { start: "Height - Frame Width", end: "Height" });
        createExtrusion(tx, rect("-Width/2 + Frame Width", -5, "Width/2 - Frame Width", 5), { start: "Frame Width", end: "Height - Frame Width" });
      },
    ),
};

export const diningTable: LibraryFamily = {
  name: "Table - Dining",
  category: "Furniture",
  description: "Rectangular table, four square legs set in from the edge.",
  build: () =>
    family(
      "Furniture",
      "Table - Dining",
      [
        ["Top Thickness", 30],
        ["Leg Size", 60],
        ["Leg Inset", 50],
      ],
      [
        ["1200 x 800", { Width: 1200, Depth: 800, Height: 750 }],
        ["1800 x 900", { Width: 1800, Depth: 900, Height: 750 }],
      ],
      (tx) => {
        createExtrusion(tx, rect("-Width/2", "-Depth/2", "Width/2", "Depth/2"), { start: "Height - Top Thickness", end: "Height" });
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ] as const) {
          const x0 = sx < 0 ? "-Width/2 + Leg Inset" : "Width/2 - Leg Inset - Leg Size";
          const y0 = sy < 0 ? "-Depth/2 + Leg Inset" : "Depth/2 - Leg Inset - Leg Size";
          createExtrusion(tx, rect(x0, y0, `${x0} + Leg Size`, `${y0} + Leg Size`), { end: "Height - Top Thickness" });
        }
      },
    ),
};

export const chair: LibraryFamily = {
  name: "Chair - Dining",
  category: "Furniture",
  description: "Four-legged dining chair with a solid back.",
  build: () =>
    family(
      "Furniture",
      "Chair - Dining",
      [
        ["Seat Height", 450],
        ["Seat Thickness", 30],
        ["Back Height", 850],
        ["Leg Size", 35],
      ],
      [["Standard", { Width: 450, Depth: 500, Height: 850 }]],
      (tx) => {
        createExtrusion(tx, rect("-Width/2", "-Depth/2", "Width/2", "Depth/2"), { start: "Seat Height - Seat Thickness", end: "Seat Height" });
        createExtrusion(tx, rect("-Width/2", "Depth/2 - 30", "Width/2", "Depth/2"), { start: "Seat Height", end: "Back Height" });
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ] as const) {
          const x0 = sx < 0 ? "-Width/2" : "Width/2 - Leg Size";
          const y0 = sy < 0 ? "-Depth/2" : "Depth/2 - Leg Size";
          createExtrusion(tx, rect(x0, y0, `${x0} + Leg Size`, `${y0} + Leg Size`), { end: "Seat Height - Seat Thickness" });
        }
      },
    ),
};

export const bed: LibraryFamily = {
  name: "Bed",
  category: "Furniture",
  description: "Bed base and mattress with a headboard, in NZ bed sizes. Origin at the foot, centred.",
  build: () =>
    family(
      "Furniture",
      "Bed",
      [
        ["Mattress Height", 550],
        ["Headboard Height", 1000],
        ["Headboard Thickness", 50],
      ],
      [
        ["Single", { Width: 920, Depth: 1880 }],
        ["Double", { Width: 1370, Depth: 1880 }],
        ["Queen", { Width: 1530, Depth: 2030 }],
        ["King", { Width: 1650, Depth: 2030 }],
        ["Super King", { Width: 1830, Depth: 2030 }],
      ],
      (tx) => {
        createExtrusion(tx, rect("-Width/2", 0, "Width/2", "Depth"), { end: "Mattress Height" });
        createExtrusion(tx, rect("-Width/2", "Depth", "Width/2", "Depth + Headboard Thickness"), { end: "Headboard Height" });
      },
    ),
};

export const baseCabinet: LibraryFamily = {
  name: "Cabinet - Kitchen Base",
  category: "Casework",
  description: "Base cabinet with a recessed toe kick (a void) and a 30 mm benchtop overhanging the front.",
  build: () =>
    family(
      "Casework",
      "Cabinet - Kitchen Base",
      [
        ["Toe Kick Height", 100],
        ["Toe Kick Depth", 60],
        ["Benchtop Thickness", 30],
        ["Overhang", 20],
      ],
      [
        ["300", { Width: 300 }],
        ["450", { Width: 450 }],
        ["600", { Width: 600 }],
        ["900", { Width: 900 }],
      ],
      (tx) => {
        // Front of the cabinet faces -Y (towards the Front elevation).
        createExtrusion(tx, rect("-Width/2", "-Depth/2", "Width/2", "Depth/2"), { end: "Height - Benchtop Thickness" });
        createExtrusion(tx, rect("-Width/2", "-Depth/2 - Overhang", "Width/2", "Depth/2"), { start: "Height - Benchtop Thickness", end: "Height" });
        createExtrusion(tx, rect("-Width/2 - 1", "-Depth/2 - 1", "Width/2 + 1", "-Depth/2 + Toe Kick Depth"), {
          start: -1,
          end: "Toe Kick Height",
          isVoid: true,
        });
      },
    ),
};

export const roundTable: LibraryFamily = {
  name: "Table - Round Pedestal",
  category: "Furniture",
  description: "Round top on a single pedestal and base, as one revolved profile.",
  build: () =>
    family(
      "Furniture",
      "Table - Round Pedestal",
      [
        ["Diameter", 900],
        ["Top Thickness", 30],
        ["Base Diameter", 500],
        ["Pedestal Diameter", 80],
      ],
      [
        ["900", { Diameter: 900, Height: 750 }],
        ["1200", { Diameter: 1200, Height: 750, "Base Diameter": 650 }],
      ],
      (tx) => {
        // Profile in the front plane (u = radius, v = height), revolved about the vertical axis.
        createRevolution(tx, [
          { x: 0, y: 0 },
          { x: "Base Diameter / 2", y: 0 },
          { x: "Base Diameter / 2", y: 30 },
          { x: "Pedestal Diameter / 2", y: 30 },
          { x: "Pedestal Diameter / 2", y: "Height - Top Thickness" },
          { x: "Diameter / 2", y: "Height - Top Thickness" },
          { x: "Diameter / 2", y: "Height" },
          { x: 0, y: "Height" },
        ]);
      },
    ),
};

/** Everything in the library, in browser order. */
export const LIBRARY: LibraryFamily[] = [singleDoor, casementWindow, diningTable, chair, bed, baseCabinet, roundTable];
