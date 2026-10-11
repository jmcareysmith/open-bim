import {
  applyResidentialTemplate,
  createDoor,
  createFloor,
  createGrid,
  createRoof,
  createWall,
  createWindow,
  type Document,
  type ElementId,
  type Vec2,
} from "@open-bim/core";

/** A small two-storey box so the app opens with something to look at. */
export function buildSample(doc: Document): void {
  const ids = applyResidentialTemplate(doc);
  const { ground, first, roof } = ids.levels;
  const W = 10000;
  const D = 8000;
  const outline: Vec2[] = [
    { x: 0, y: 0 },
    { x: W, y: 0 },
    { x: W, y: D },
    { x: 0, y: D },
  ];

  const exterior: Record<string, ElementId[]> = { [ground]: [], [first]: [] };
  doc.transact("Sample model", (tx) => {
    createFloor(tx, ids.floorTypes.slab, ground, outline);
    createFloor(tx, ids.floorTypes.timber, first, outline);
    for (const [base, top] of [
      [ground, first],
      [first, roof],
    ] as const) {
      for (let i = 0; i < 4; i++) {
        exterior[base]!.push(createWall(tx, ids.wallTypes.exterior, outline[i]!, outline[(i + 1) % 4]!, base, { topLevelId: top }).id);
      }
    }
    // Interior partitions, ground floor
    createWall(tx, ids.wallTypes.interior, { x: 4000, y: 0 }, { x: 4000, y: 5000 }, ground, { topLevelId: first });
    createWall(tx, ids.wallTypes.interior, { x: 4000, y: 5000 }, { x: W, y: 5000 }, ground, { topLevelId: first });
    // Hipped roof, 600 mm eaves.
    const e = 600;
    const eaves: Vec2[] = [
      { x: -e, y: -e },
      { x: W + e, y: -e },
      { x: W + e, y: D + e },
      { x: -e, y: D + e },
    ];
    createRoof(tx, ids.roofTypes.steel, roof, eaves);
  });

  // Front (south) wall: door and windows; first floor windows on the south and east.
  doc.transact("Sample doors and windows", (tx) => {
    const [south, east] = exterior[ground]!;
    const [south1, east1] = exterior[first]!;
    createDoor(tx, doc, ids.doorTypes.single860, south!, 6000);
    createWindow(tx, doc, ids.windowTypes.w1800x1200, south!, 2000);
    createWindow(tx, doc, ids.windowTypes.w1200x1200, south!, 8500);
    createWindow(tx, doc, ids.windowTypes.w1200x1200, east!, 2500);
    createWindow(tx, doc, ids.windowTypes.w1800x1200, south1!, 2500);
    createWindow(tx, doc, ids.windowTypes.w1800x1200, south1!, 7500);
    createWindow(tx, doc, ids.windowTypes.w600x600, east1!, 6000);
  });

  const ext = 1500; // grids run past the building
  doc.transact("Sample grids", (tx) => {
    [0, 4000, W].forEach((x, i) => createGrid(tx, doc, { x, y: -ext }, { x, y: D + ext }, String(i + 1)));
    [0, 5000, D].forEach((y, i) => createGrid(tx, doc, { x: -ext, y }, { x: W + ext, y }, "ABC"[i]));
  });
}
