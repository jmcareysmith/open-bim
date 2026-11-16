import {
  Document,
  applyResidentialTemplate,
  createDoor,
  createFloor,
  createLevel,
  createWall,
  createWindow,
  type Vec2,
} from "@open-bim/core";

// A big test model for speed checks (perf.test.ts).

/** n × n rooms of 4 m on `storeys` levels. */
export function bigModel(n: number, storeys: number) {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const lvls = [ids.levels.ground];
  doc.transact("Levels", (tx) => {
    for (let s = 1; s < storeys; s++) lvls.push(createLevel(tx, `L${s + 1}`, s * 3000).id);
  });
  const S = 4000;
  const p = (x: number, y: number): Vec2 => ({ x: x * S, y: y * S });
  for (const lv of lvls) {
    doc.transact("Walls", (tx) => {
      for (let i = 0; i <= n; i++) {
        for (let j = 0; j < n; j++) {
          const a = createWall(tx, i === 0 || i === n ? ids.wallTypes.exterior : ids.wallTypes.interior, p(i, j), p(i, j + 1), lv, { height: 2700 });
          const b = createWall(tx, j === 0 || j === n ? ids.wallTypes.exterior : ids.wallTypes.interior, p(j, i), p(j + 1, i), lv, { height: 2700 });
          if (i > 0 && i < n) createDoor(tx, doc, ids.doorTypes.single860, a.id, 2000);
          else createWindow(tx, doc, ids.windowTypes.w1200x1200, b.id, 2000);
        }
      }
      createFloor(tx, ids.floorTypes.slab, lv, [p(0, 0), p(n, 0), p(n, n), p(0, n)]);
    });
  }
  return { doc, ids, lvls };
}

