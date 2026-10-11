import { applyResidentialTemplate, createFloor, createWall, type Document, type Vec2 } from "@open-bim/core";

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

  doc.transact("Sample model", (tx) => {
    createFloor(tx, ids.floorTypes.slab, ground, outline);
    createFloor(tx, ids.floorTypes.timber, first, outline);
    for (const [base, top] of [
      [ground, first],
      [first, roof],
    ] as const) {
      for (let i = 0; i < 4; i++) {
        createWall(tx, ids.wallTypes.exterior, outline[i]!, outline[(i + 1) % 4]!, base, { topLevelId: top });
      }
    }
    // Interior partitions, ground floor
    createWall(tx, ids.wallTypes.interior, { x: 4000, y: 0 }, { x: 4000, y: 5000 }, ground, { topLevelId: first });
    createWall(tx, ids.wallTypes.interior, { x: 4000, y: 5000 }, { x: W, y: 5000 }, ground, { topLevelId: first });
  });
}
