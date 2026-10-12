import { describe, expect, it } from "vitest";
import {
  Cat,
  Document,
  annotationView,
  applyResidentialTemplate,
  createDetailLine,
  createGroup,
  createSymbol,
  createTextNote,
  createWall,
  groupMembers,
  isDetailGroup,
  placeGroup,
  views,
  type GroupParams,
  type SymbolParams,
  type TextNoteParams,
} from "../src/index.ts";

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const [plan1, plan2] = views(doc).filter((v) => v.params.kind === "floorPlan");
  const v3d = views(doc).find((v) => v.params.kind === "3d")!;
  return { doc, ids, plan1: plan1!, plan2: plan2!, v3d };
}

describe("detail groups", () => {
  it("group one view's drafting; place copies in this or another view", () => {
    const { doc, plan1, plan2, v3d } = setup();
    const els = doc.transact("Draft", (tx) => [
      createDetailLine(tx, doc, plan1.id, { x: 0, y: 0 }, { x: 1000, y: 0 }),
      createTextNote(tx, doc, plan1.id, { x: 0, y: 200 }, "Flashing"),
      createSymbol(tx, doc, plan1.id, "northArrow", { x: 500, y: 500 }),
    ]);
    const g = doc.transact("Group", (tx) => createGroup(tx, doc, els.map((e) => e.id)));
    expect(isDetailGroup(g)).toBe(true);
    expect(doc.get(g.typeId!)?.name).toBe("Detail Group 1");
    expect(annotationView(g)).toBe(plan1.id);

    const copy = doc.transact("Place", (tx) => placeGroup(tx, doc, g.id, { x: 5000, y: 0 }, Math.PI / 2, plan2.id));
    const members = groupMembers(doc, copy.id);
    expect(members).toHaveLength(3);
    expect(members.every((m) => (m.params as { viewId: string }).viewId === plan2.id)).toBe(true);
    const sym = members.find((m) => m.category === Cat.Symbol)!;
    expect((sym.params as SymbolParams).rotation).toBeCloseTo(Math.PI / 2);
    const note = members.find((m) => m.category === Cat.TextNote)!;
    expect((note.params as TextNoteParams).text).toBe("Flashing");
    expect(() => doc.transact("Place", (tx) => placeGroup(tx, doc, g.id, { x: 0, y: 0 }, 0, v3d.id))).toThrow(/plans, sections/);
    // Deleting the view deletes its detail groups (and their members).
    doc.transact("Delete", (tx) => tx.delete(plan2.id));
    expect(doc.has(copy.id)).toBe(false);
    expect((doc.require<GroupParams>(g.id).params.viewId)).toBe(plan1.id);
  });

  it("refuses mixed model/detail groups and drafting from several views", () => {
    const { doc, ids, plan1, plan2 } = setup();
    const w = doc.transact("W", (tx) => createWall(tx, ids.wallTypes.interior, { x: 0, y: 0 }, { x: 1000, y: 0 }, ids.levels.ground));
    const a = doc.transact("L", (tx) => createDetailLine(tx, doc, plan1.id, { x: 0, y: 0 }, { x: 1, y: 1 }));
    const b = doc.transact("L", (tx) => createDetailLine(tx, doc, plan2.id, { x: 0, y: 0 }, { x: 1, y: 1 }));
    expect(() => doc.transact("G", (tx) => createGroup(tx, doc, [w.id, a.id]))).toThrow(/separately/);
    expect(() => doc.transact("G", (tx) => createGroup(tx, doc, [a.id, b.id]))).toThrow(/one view/);
    // Model groups are unchanged.
    const g = doc.transact("G", (tx) => createGroup(tx, doc, [w.id]));
    expect(isDetailGroup(g)).toBe(false);
    expect(doc.get(g.typeId!)?.name).toBe("Group 1");
  });
});
