import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createTag,
  createWall,
  floorPlanFor,
  keynoteTable,
  keynotesInView,
  parseKeynoteFile,
  setKeynoteTable,
  tagText,
  writeKeynoteFile,
} from "../src/index.ts";

const FILE = "# Open-BIM keynotes\r\nB\tFraming\r\nB10\tTimber wall framing, 90 x 45 SG8\tB\r\nE\tCladding\r\nE20\tBevel-back weatherboard\tE\r\n";

describe("keynotes", () => {
  it("read and write Revit keynote files", () => {
    const entries = parseKeynoteFile(FILE);
    expect(entries).toHaveLength(4);
    expect(entries[1]).toEqual({ key: "B10", text: "Timber wall framing, 90 x 45 SG8", parent: "B" });
    expect(parseKeynoteFile(writeKeynoteFile(entries))).toEqual(entries);
    expect(() => parseKeynoteFile("A\tx\nA\ty")).toThrow(/twice/);
    expect(() => parseKeynoteFile("A1\tx\tZ")).toThrow(/unknown parent/);
  });

  it("keynote tags show the element's or its type's key; the legend lists keys used in a view", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    doc.transact("Keynotes", (tx) => setKeynoteTable(tx, doc, parseKeynoteFile(FILE)));
    expect(keynoteTable(doc)).toHaveLength(4);
    const wall = doc.transact("W", (tx) =>
      createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 4000, y: 0 }, ids.levels.ground, { topLevelId: ids.levels.first }),
    );
    doc.transact("Type keynote", (tx) => tx.update(ids.wallTypes.exterior, { keynote: "E20" }));
    const plan = floorPlanFor(doc, ids.levels.ground)!;
    const t = doc.transact("Keynote", (tx) => createTag(tx, doc, plan.id, wall.id, { x: 2000, y: -400 }, { kind: "keynote" }));
    expect(tagText(doc, t)).toBe("E20");
    doc.transact("Own keynote", (tx) => tx.update(wall.id, { keynote: "B10" }));
    expect(tagText(doc, doc.require(t.id) as typeof t)).toBe("B10");
    expect(keynotesInView(doc, plan.id)).toEqual([{ key: "B10", text: "Timber wall framing, 90 x 45 SG8", parent: "B" }]);
  });
});
