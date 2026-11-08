import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  autoSchemeColor,
  createColorFillLegend,
  createColorScheme,
  createRoom,
  createRoomSeparator,
  createWall,
  floorPlanFor,
  schemeColor,
  schemeLegend,
  schemeValue,
  setColorSchemeEntry,
  type ColorScheme,
  type RoomParams,
  type Vec2,
  type ViewParams,
} from "@open-bim/core";
import { SimpleKernel, viewDrawing, viewSchemeFill } from "../src/index.ts";

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const pts: Vec2[] = [
    { x: 0, y: 0 },
    { x: 6000, y: 0 },
    { x: 6000, y: 3000 },
    { x: 0, y: 3000 },
  ];
  doc.transact("Walls", (tx) => pts.forEach((p, i) => createWall(tx, ids.wallTypes.interior, p, pts[(i + 1) % 4]!, ids.levels.ground, { topLevelId: ids.levels.first })));
  doc.transact("Sep", (tx) => createRoomSeparator(tx, doc, ids.levels.ground, { x: 2000, y: -500 }, { x: 2000, y: 3500 }));
  const [kitchen, living] = doc.transact("Rooms", (tx) => [
    createRoom(tx, doc, ids.levels.ground, { x: 1000, y: 1500 }, { name: "Kitchen" }),
    createRoom(tx, doc, ids.levels.ground, { x: 4000, y: 1500 }, { name: "Living" }),
  ]);
  doc.transact("Dept", (tx) => {
    tx.update<RoomParams>(kitchen!.id, { department: "Service" });
    tx.update<RoomParams>(living!.id, { department: "Living" });
  });
  const plan = floorPlanFor(doc, ids.levels.ground)!;
  return { doc, ids, plan, kitchen: doc.require(kitchen!.id), living: doc.require(living!.id) };
}

describe("colour schemes", () => {
  it("colour rooms by a value, with stable automatic colours and stored ones", () => {
    const { doc, kitchen, living } = setup();
    const s = doc.transact("S", (tx) => createColorScheme(tx, "By name", { by: "name" }));
    expect(schemeValue(s, kitchen)).toBe("Kitchen");
    expect(schemeColor(s, "Kitchen")).toBe(autoSchemeColor("Kitchen"));
    doc.transact("Colour", (tx) => setColorSchemeEntry(tx, doc, s.id, "Kitchen", { color: 0x123456 }));
    const s2 = doc.require(s.id) as ColorScheme;
    expect(schemeColor(s2, "Kitchen")).toBe(0x123456);
    // The legend: stored first, then new values sorted; hidden ones drop out.
    expect(schemeLegend(s2, ["Living", "Kitchen", "Bath", "Kitchen"]).map((e) => e.value)).toEqual(["Kitchen", "Bath", "Living"]);
    doc.transact("Hide", (tx) => setColorSchemeEntry(tx, doc, s.id, "Kitchen", { visible: false }));
    expect(schemeColor(doc.require(s.id) as ColorScheme, "Kitchen")).toBeNull();
    // Department and area ranges.
    const dept = doc.transact("D", (tx) => createColorScheme(tx, "By dept", { by: "department" }));
    expect(schemeValue(dept, living)).toBe("Living");
    const area = doc.transact("A", (tx) => createColorScheme(tx, "By area", { by: "area", rangeStep: 5 }));
    expect(schemeValue(area, living, 11.4)).toBe("10–15 m²");
  });

  it("plans fill rooms only with a scheme; the legend lists the view's values", () => {
    const { doc, plan, kitchen } = setup();
    const k = new SimpleKernel();
    const roomFills = (d: ReturnType<typeof viewDrawing>) => d.fills.filter((f) => f.id && doc.get(f.id)?.category === "Room");
    // Revit: no scheme, no fill.
    expect(roomFills(viewDrawing(doc, k, doc.require<ViewParams>(plan.id) as never))).toEqual([]);
    const s = doc.transact("S", (tx) => createColorScheme(tx, "By dept", { by: "department" }));
    doc.transact("Pick", (tx) => tx.update<ViewParams>(plan.id, { colorScheme: s.id }));
    const v = doc.require<ViewParams>(plan.id);
    expect(viewSchemeFill(doc, v, kitchen)).toBe(autoSchemeColor("Service"));
    const fills = roomFills(viewDrawing(doc, k, v as never));
    expect(fills.map((f) => f.color).sort()).toEqual([autoSchemeColor("Living"), autoSchemeColor("Service")].sort());
    const legend = doc.transact("L", (tx) => createColorFillLegend(tx, doc, plan.id, { x: 8000, y: 3000 }));
    const lines = k.buildLines(doc, legend, 100)!;
    expect(lines.labels.map((l) => l.text)).toEqual(["Department Legend", "Living", "Service"]);
    expect(lines.fills).toHaveLength(2);
    // A plan without a scheme can't take a legend.
    doc.transact("None", (tx) => tx.update<ViewParams>(plan.id, { colorScheme: null }));
    expect(() => doc.transact("L2", (tx) => createColorFillLegend(tx, doc, plan.id, { x: 0, y: 0 }))).toThrow(/colour scheme/);
  });
});
