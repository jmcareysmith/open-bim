import {
  Document,
  applyFamilyTemplate,
  createDetailLine,
  createExtrusion,
  createFilledRegion,
  createTextNote,
  familyInfo as infoOf,
  type MarkerRole,
  createFamilyParameter,
  createRevolution,
  createConnector,
  familyInfo,
  type FamilyCategory,
  type FamilyInfoParams,
  type Num,
  type NumPt,
  type Transaction,
  type Values,
  type Vec2,
  views,
} from "@open-bim/core";

// The Open-BIM family library: parametric families written against the family API, so they're
// plain, reviewable code and export to the open .obim-family JSON format. Sizes follow common NZ
// residential practice. Hosted families use family X along the wall, Y across it, origin at the
// opening's bottom centre on the wall's location line.

export interface LibraryFamily {
  name: string;
  category: FamilyCategory;
  description: string;
  /** View Marker families: what they draw. */
  markerRole?: MarkerRole;
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
// ---- detail items (2D, drawn full size about the origin) ------------------------------------

function detailFamily(name: string, draw: (line: (a: Vec2, b: Vec2) => void, region: (boundary: Vec2[], holes?: Vec2[][], color?: number) => void) => void): Document {
  const doc = new Document();
  applyFamilyTemplate(doc, "DetailItem", name);
  const view = views(doc)[0]!;
  doc.transact("Draw detail", (tx) =>
    draw(
      (a, b) => void createDetailLine(tx, doc, view.id, a, b),
      (boundary, holes = [], color) => void createFilledRegion(tx, doc, view.id, boundary, { holes, ...(color !== undefined ? { color } : {}) }),
    ),
  );
  return doc;
}
const box = (w: number, h: number, cx = 0, cy = 0): Vec2[] => [
  { x: cx - w / 2, y: cy - h / 2 },
  { x: cx + w / 2, y: cy - h / 2 },
  { x: cx + w / 2, y: cy + h / 2 },
  { x: cx - w / 2, y: cy + h / 2 },
];

/** Sawn timber in section: outline with a cross (NZ drafting convention). */
const timberSection = (d: number, b: number): LibraryFamily => ({
  name: `Timber ${d}x${b} Section`,
  category: "DetailItem",
  description: `${d} × ${b} mm timber in section, crossed`,
  build: () =>
    detailFamily(`Timber ${d}x${b} Section`, (line) => {
      const [p0, p1, p2, p3] = box(d, b);
      line(p0!, p1!);
      line(p1!, p2!);
      line(p2!, p3!);
      line(p3!, p0!);
      line(p0!, p2!);
      line(p1!, p3!);
    }),
});

export const concreteBlock: LibraryFamily = {
  name: "Concrete Block 20 Series Section",
  category: "DetailItem",
  description: "390 × 190 mm hollow concrete masonry unit in section (two cores)",
  build: () => detailFamily("Concrete Block 20 Series Section", (_line, region) => region(box(390, 190), [box(130, 110, -95), box(130, 110, 95)], 0xb8b8b8)),
};

export const steelAngle: LibraryFamily = {
  name: "Steel Angle 75x75x6 Section",
  category: "DetailItem",
  description: "75 × 75 × 6 mm equal angle in section",
  build: () =>
    detailFamily("Steel Angle 75x75x6 Section", (_line, region) =>
      region(
        [
          { x: 0, y: 0 },
          { x: 75, y: 0 },
          { x: 75, y: 6 },
          { x: 6, y: 6 },
          { x: 6, y: 75 },
          { x: 0, y: 75 },
        ],
        [],
        0x3c4048,
      ),
    ),
};

// ---- view markers (2D, paper mm; the view looks along +Y) -------------------------------------

type Draw = { line(a: Vec2, b: Vec2): void; region(boundary: Vec2[], color?: number): void; text(at: Vec2, text: string, size?: number): void };

function markerFamily(name: string, role: MarkerRole, draw: (d: Draw) => void): Document {
  const doc = new Document();
  applyFamilyTemplate(doc, "ViewMarker", name);
  const view = views(doc)[0]!;
  doc.transact("Draw marker", (tx) => {
    tx.update(infoOf(doc)!.id, { markerRole: role });
    draw({
      line: (a, b) => void createDetailLine(tx, doc, view.id, a, b),
      region: (boundary, color = 0x2b2f36) => void createFilledRegion(tx, doc, view.id, boundary, { color }),
      text: (at, text, size = 2.3) => void createTextNote(tx, doc, view.id, at, text, size),
    });
  });
  return doc;
}
const circlePts = (c: Vec2, r: number, a0 = 0, a1 = 2 * Math.PI, n = 24): Vec2[] =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: c.x + r * Math.cos(a0 + ((a1 - a0) * i) / n), y: c.y + r * Math.sin(a0 + ((a1 - a0) * i) / n) }));
const ring = (d: Draw, c: Vec2, r: number) => {
  const pts = circlePts(c, r);
  for (let i = 0; i + 1 < pts.length; i++) d.line(pts[i]!, pts[i + 1]!);
};
/** A filled pointer from a bubble at `c` (radius r) out along +Y. */
const pointer = (d: Draw, c: Vec2, r: number) => {
  const tip = { x: c.x, y: c.y + r * 1.75 };
  const a = { x: c.x + r * 0.7, y: c.y + r * 0.71 };
  const b = { x: c.x - r * 0.7, y: c.y + r * 0.71 };
  d.line(tip, a);
  d.line(tip, b);
  d.region([b, a, tip]);
};
const marker = (name: string, role: MarkerRole, description: string, draw: (d: Draw) => void): LibraryFamily => ({
  name,
  category: "ViewMarker",
  description,
  markerRole: role,
  build: () => markerFamily(name, role, draw),
});

export const VIEW_MARKERS: LibraryFamily[] = [
  marker("Elevation Mark - Filled Pointer", "elevation", "Circle with the view number and a filled pointer", (d) => {
    ring(d, { x: 0, y: 0 }, 4);
    pointer(d, { x: 0, y: 0 }, 4);
    d.text({ x: 0, y: 0 }, "{n}");
  }),
  marker("Elevation Mark - Half Filled", "elevation", "Circle, filled on the side it looks to, with the view number", (d) => {
    ring(d, { x: 0, y: 0 }, 4);
    d.line({ x: -4, y: 0 }, { x: 4, y: 0 });
    d.region(circlePts({ x: 0, y: 0 }, 4, 0, Math.PI, 16));
    d.text({ x: 0, y: -1.9 }, "{n}", 2);
  }),
  marker("Section Head - Filled Pointer", "sectionHead", "Bubble before the line with the view number and a filled pointer", (d) => {
    ring(d, { x: -4, y: 0 }, 4);
    pointer(d, { x: -4, y: 0 }, 4);
    d.text({ x: -4, y: 0 }, "{n}");
  }),
  marker("Section Head - Number over Sheet", "sectionHead", "Split bubble: view number over the sheet it's on, with a filled pointer", (d) => {
    ring(d, { x: -5, y: 0 }, 5);
    d.line({ x: -10, y: 0 }, { x: 0, y: 0 });
    pointer(d, { x: -5, y: 0 }, 5);
    d.text({ x: -5, y: 2 }, "{n}", 2.2);
    d.text({ x: -5, y: -2.2 }, "{sheet}", 2);
  }),
  marker("Section Tail - Flag", "sectionTail", "A short flag showing the view direction", (d) => {
    d.line({ x: 0, y: 0 }, { x: 0, y: 4.8 });
    d.region([
      { x: 0, y: 4.8 },
      { x: 0, y: 2.8 },
      { x: 1.8, y: 3.8 },
    ]);
  }),
  marker("Section Tail - None", "sectionTail", "No tail symbol: the line just ends", () => {}),
  marker("Callout Head - Circle", "calloutHead", "Circle with the view number", (d) => {
    ring(d, { x: 0, y: 0 }, 4);
    d.text({ x: 0, y: 0 }, "{n}");
  }),
  marker("Callout Head - Number over Sheet", "calloutHead", "Split circle: view number over the sheet it's on", (d) => {
    ring(d, { x: 0, y: 0 }, 5);
    d.line({ x: -5, y: 0 }, { x: 5, y: 0 });
    d.text({ x: 0, y: 2 }, "{n}", 2.2);
    d.text({ x: 0, y: -2.2 }, "{sheet}", 2);
  }),
];


// ---- Conceptual masses (Massing & Site → Place Mass) -----------------------

export const massBox: LibraryFamily = {
  name: "Mass - Box",
  category: "Mass",
  description: "Rectangular mass, Width x Depth x Height, centred on its insertion point.",
  build: () =>
    family("Mass", "Mass - Box", [], [["12 x 8 x 6 m", { Width: 12000, Depth: 8000, Height: 6000 }]], (tx) => {
      createExtrusion(tx, rect("-Width/2", "-Depth/2", "Width/2", "Depth/2"), { end: "Height" });
    }),
};

export const massCylinder: LibraryFamily = {
  name: "Mass - Cylinder",
  category: "Mass",
  description: "Round mass (Radius, Height), for towers and silos.",
  build: () =>
    family("Mass", "Mass - Cylinder", [["Radius", 5000]], [["10 m diameter", { Radius: 5000, Height: 12000 }]], (tx) => {
      createRevolution(tx, rect(0, 0, "Radius", "Height"), { plane: { kind: "XZ", offset: 0 }, axis: 0 });
    }),
};

export const massGable: LibraryFamily = {
  name: "Mass - Gable",
  category: "Mass",
  description: "House-form mass: walls to Eave Height, a gable roof to Ridge Height along the Depth.",
  build: () =>
    family(
      "Mass",
      "Mass - Gable",
      [
        ["Eave Height", 2700],
        ["Ridge Height", 5400],
      ],
      [["12 x 8 m house", { Width: 12000, Depth: 8000 }]],
      (tx) => {
        // Gable profile in the front (XZ) plane, extruded through the depth.
        createExtrusion(
          tx,
          [
            { x: "-Width/2", y: 0 },
            { x: "Width/2", y: 0 },
            { x: "Width/2", y: "Eave Height" },
            { x: 0, y: "Ridge Height" },
            { x: "-Width/2", y: "Eave Height" },
          ],
          { plane: { kind: "XZ", offset: "-Depth/2" }, end: "Depth" },
        );
      },
    ),
};


// ---- Site and parking components (Massing & Site → Site / Parking Component) --

export const tree: LibraryFamily = {
  name: "Tree - Deciduous",
  category: "Site",
  description: "Round-headed tree: trunk and canopy (Height, Canopy Diameter).",
  build: () =>
    family(
      "Site",
      "Tree - Deciduous",
      [
        ["Canopy Diameter", 5000],
        ["Trunk Diameter", 300],
      ],
      [
        ["6 m", { Height: 6000, "Canopy Diameter": 5000 }],
        ["10 m", { Height: 10000, "Canopy Diameter": 8000 }],
      ],
      (tx) => {
        createRevolution(tx, rect(0, 0, "Trunk Diameter/2", "Height*0.45"), { axis: 0 });
        // Canopy: a rounded profile revolved about the trunk.
        const r = "Canopy Diameter/2";
        createRevolution(
          tx,
          [
            { x: 0, y: "Height*0.35" },
            { x: `${r}*0.7`, y: "Height*0.4" },
            { x: r, y: "Height*0.62" },
            { x: `${r}*0.8`, y: "Height*0.85" },
            { x: `${r}*0.35`, y: "Height*0.98" },
            { x: 0, y: "Height" },
          ],
          { axis: 0 },
        );
      },
    ),
};

export const parkingSpace: LibraryFamily = {
  name: "Parking Space",
  category: "Parking",
  description: "Marked car park: painted lines along the sides and across the end (Width, Length).",
  build: () =>
    family("Parking", "Parking Space", [["Line Width", 100]], [["2.5 x 5.0 m", { Width: 2500, Length: 5000 }], ["Accessible 3.6 x 5.0 m", { Width: 3600, Length: 5000 }]], (tx) => {
      createExtrusion(tx, rect("-Width/2", 0, "-Width/2 + Line Width", "Length"), { end: 5 });
      createExtrusion(tx, rect("Width/2 - Line Width", 0, "Width/2", "Length"), { end: 5 });
      createExtrusion(tx, rect("-Width/2", "Length - Line Width", "Width/2", "Length"), { end: 5 });
    }),
};


// ---- HVAC: air terminals and mechanical equipment (Systems → Air Terminal / Equipment) ------
// Air terminals have their origin on the ceiling face (placed at ceiling height); connectors carry
// the design flow so duct sizing works from them.

/** Round neck on top of a terminal: a short cylinder up from z0. */
const neck = (tx: Transaction, z0: Num, height: Num) => createRevolution(tx, rect(0, z0, "Neck Diameter/2", `${z0} + ${height}`), { axis: 0 });

export const supplyDiffuser: LibraryFamily = {
  name: "Supply Diffuser - Square",
  category: "AirTerminal",
  description: "Square ceiling diffuser with a round neck; supply air in at the top (Flow, L/s).",
  build: () =>
    family(
      "AirTerminal",
      "Supply Diffuser - Square",
      [
        ["Neck Diameter", 250],
        ["Flow", 100],
      ],
      [
        ["600 x 600 - 250 neck", { Width: 600, Depth: 600, "Neck Diameter": 250, Flow: 100 }],
        ["450 x 450 - 200 neck", { Width: 450, Depth: 450, "Neck Diameter": 200, Flow: 60 }],
      ],
      (tx) => {
        createExtrusion(tx, rect("-Width/2", "-Depth/2", "Width/2", "Depth/2"), { start: -40, end: 0 });
        neck(tx, 0, 150);
        createConnector(tx, { classification: "supplyAir", z: 150, facing: "+z", diameter: "Neck Diameter", flow: "Flow", flowDirection: "in" });
      },
    ),
};

export const returnGrille: LibraryFamily = {
  name: "Return Grille - Rectangular",
  category: "AirTerminal",
  description: "Ceiling return air grille; air leaves the room into the duct at the top (Flow, L/s).",
  build: () =>
    family(
      "AirTerminal",
      "Return Grille - Rectangular",
      [
        ["Neck Diameter", 300],
        ["Flow", 200],
      ],
      [["600 x 300", { Width: 600, Depth: 300, "Neck Diameter": 300, Flow: 200 }]],
      (tx) => {
        createExtrusion(tx, rect("-Width/2", "-Depth/2", "Width/2", "Depth/2"), { start: -30, end: 0 });
        neck(tx, 0, 150);
        createConnector(tx, { classification: "returnAir", z: 150, facing: "+z", diameter: "Neck Diameter", flow: "Flow", flowDirection: "out" });
      },
    ),
};

export const exhaustFan: LibraryFamily = {
  name: "Exhaust Fan - Ceiling",
  category: "MechanicalEquipment",
  description: "Bathroom/kitchen ceiling exhaust fan: exhaust air out at the top, and its power.",
  build: () =>
    family(
      "MechanicalEquipment",
      "Exhaust Fan - Ceiling",
      [
        ["Neck Diameter", 150],
        ["Flow", 50],
        ["Load", 30],
      ],
      [["150 mm - 50 L/s", { Width: 300, Depth: 300, Height: 200, "Neck Diameter": 150, Flow: 50, Load: 30 }]],
      (tx) => {
        createExtrusion(tx, rect("-Width/2", "-Depth/2", "Width/2", "Depth/2"), { start: -20, end: 0 });
        createExtrusion(tx, rect("-Width/2 + 30", "-Depth/2 + 30", "Width/2 - 30", "Depth/2 - 30"), { start: 0, end: "Height - 60" });
        neck(tx, "Height - 60", 60);
        createConnector(tx, { classification: "exhaustAir", z: "Height", facing: "+z", diameter: "Neck Diameter", flow: "Flow", flowDirection: "out" });
        createConnector(tx, { classification: "power", x: "Width/2 - 30", z: 100, facing: "+x", load: "Load" });
      },
    ),
};

export const ductedIndoorUnit: LibraryFamily = {
  name: "Ducted Heat Pump - Indoor Unit",
  category: "MechanicalEquipment",
  description: "Ceiling-space ducted unit: supply air out at one end, return in at the other, power and a condensate drain.",
  build: () =>
    family(
      "MechanicalEquipment",
      "Ducted Heat Pump - Indoor Unit",
      [
        ["Supply Diameter", 350],
        ["Return Diameter", 400],
        ["Airflow", 400],
        ["Load", 2500],
      ],
      [
        ["7 kW", { Width: 1100, Depth: 700, Height: 280, Airflow: 400, Load: 2200 }],
        ["10 kW", { Width: 1300, Depth: 750, Height: 300, Airflow: 550, Load: 3100 }],
      ],
      (tx) => {
        createExtrusion(tx, rect("-Width/2", "-Depth/2", "Width/2", "Depth/2"), { end: "Height" });
        createConnector(tx, { classification: "supplyAir", x: "Width/2", z: "Height/2", facing: "+x", diameter: "Supply Diameter", flow: "Airflow", flowDirection: "out" });
        createConnector(tx, { classification: "returnAir", x: "-Width/2", z: "Height/2", facing: "-x", diameter: "Return Diameter", flow: "Airflow", flowDirection: "in" });
        createConnector(tx, { classification: "power", y: "-Depth/2", z: "Height/2", facing: "-y", load: "Load" });
        createConnector(tx, { classification: "sanitary", x: "Width/2 - 100", y: "Depth/2", z: 40, facing: "+y", diameter: 20, flowDirection: "out" });
      },
    ),
};

export const outdoorUnit: LibraryFamily = {
  name: "Heat Pump - Outdoor Unit",
  category: "MechanicalEquipment",
  description: "Outdoor heat pump unit on its pad: power connection.",
  build: () =>
    family(
      "MechanicalEquipment",
      "Heat Pump - Outdoor Unit",
      [["Load", 2500]],
      [["7 kW", { Width: 800, Depth: 300, Height: 600, Load: 2200 }]],
      (tx) => {
        createExtrusion(tx, rect("-Width/2", "-Depth/2", "Width/2", "Depth/2"), { end: "Height" });
        createConnector(tx, { classification: "power", x: "Width/2", z: "Height/2", facing: "+x", load: "Load" });
      },
    ),
};

export const LIBRARY: LibraryFamily[] = [
  singleDoor,
  casementWindow,
  diningTable,
  chair,
  bed,
  baseCabinet,
  roundTable,
  timberSection(90, 45),
  timberSection(140, 45),
  timberSection(190, 45),
  concreteBlock,
  steelAngle,
  massBox,
  massCylinder,
  massGable,
  tree,
  parkingSpace,
  supplyDiffuser,
  returnGrille,
  exhaustFan,
  ductedIndoorUnit,
  outdoorUnit,
  ...VIEW_MARKERS,
];
