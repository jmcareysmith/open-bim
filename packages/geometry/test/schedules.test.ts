import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createDoor,
  createRoom,
  createSchedule,
  createWall,
  tableCsv,
  tableXlsx,
  wallThickness,
  type ScheduleParams,
  type Schedule,
  type Vec2,
} from "@open-bim/core";
import { scheduleFields, scheduleTable } from "../src/index.ts";

function house() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const pts: Vec2[] = [
    { x: 0, y: 0 },
    { x: 6000, y: 0 },
    { x: 6000, y: 4000 },
    { x: 0, y: 4000 },
  ];
  const walls = doc.transact("Walls", (tx) =>
    pts.map((p, i) => createWall(tx, ids.wallTypes.exterior, p, pts[(i + 1) % 4]!, ids.levels.ground, { topLevelId: ids.levels.first })),
  );
  doc.transact("Mid", (tx) =>
    createWall(tx, ids.wallTypes.interior, { x: 3000, y: 0 }, { x: 3000, y: 4000 }, ids.levels.ground, { topLevelId: ids.levels.first }),
  );
  doc.transact("Doors", (tx) => {
    createDoor(tx, doc, ids.doorTypes.single810, walls[0]!.id, 1500);
    createDoor(tx, doc, ids.doorTypes.single810, walls[0]!.id, 4500);
    createDoor(tx, doc, ids.doorTypes.single860, walls[2]!.id, 3000);
  });
  doc.transact("Rooms", (tx) => {
    createRoom(tx, doc, ids.levels.ground, { x: 1500, y: 2000 }, { name: "Kitchen" });
    createRoom(tx, doc, ids.levels.ground, { x: 4500, y: 2000 }, { name: "Living" });
  });
  return { doc, ids, walls };
}

const update = (doc: Document, s: Schedule, patch: Partial<ScheduleParams>) => {
  doc.transact("Edit schedule", (tx) => tx.update<ScheduleParams>(s.id, patch));
  return doc.require(s.id) as Schedule;
};

describe("schedules", () => {
  it("room schedules list rooms with live areas, sorted, with a grand total", () => {
    const { doc } = house();
    let s = doc.transact("S", (tx) => createSchedule(tx, doc, "Room"));
    s = update(doc, s, { sort: [{ field: "name", descending: true, header: false, footer: false }], grandTotals: true });
    const t = scheduleTable(doc, s);
    expect(t.headings).toEqual(["Number", "Name", "Level", "Area"]);
    expect(t.rows.map((r) => r.cells[1])).toEqual(["Living", "Kitchen", ""]);
    const total = t.rows.at(-1)!;
    expect(total.kind).toBe("total");
    expect(total.values[3]).toBeCloseTo((t.rows[0]!.values[3] as number) + (t.rows[1]!.values[3] as number));
  });

  it("door schedules group by type with counts, and filters apply", () => {
    const { doc } = house();
    let s = doc.transact("S", (tx) => createSchedule(tx, doc, "Door", { fields: ["type", "width", "count"] }));
    s = update(doc, s, { sort: [{ field: "type", descending: false, header: false, footer: false }], itemize: false });
    const t = scheduleTable(doc, s);
    expect(t.rows.map((r) => [r.cells[0], r.values[2]])).toEqual([
      ["Door - Single 810 x 1980", 2],
      ["Door - Single 860 x 1980", 1],
    ]);
    s = update(doc, s, { filters: [{ field: "width", op: "gt", value: "880" }] });
    expect(scheduleTable(doc, s).rows).toHaveLength(1);
  });

  it("wall areas are net of openings; headers and subtotals group rows", () => {
    const { doc, walls } = house();
    let s = doc.transact("S", (tx) => createSchedule(tx, doc, "Wall", { fields: ["type", "length", "area", "count"] }));
    s = update(doc, s, { sort: [{ field: "type", descending: false, header: true, footer: true }] });
    const t = scheduleTable(doc, s);
    expect(t.rows.map((r) => r.kind)).toEqual(["header", "row", "row", "row", "row", "subtotal", "header", "row", "subtotal"]);
    const south = t.rows.find((r) => r.ids[0] === walls[0]!.id)!;
    // 6 m x 2.7 m less two doors.
    expect(south.values[2]).toBeLessThan(6 * 2.7);
    expect(t.rows[5]!.values[3]).toBe(4);
  });

  it("material takeoffs give a row per layer with area and volume", () => {
    const { doc, ids, walls } = house();
    const s = doc.transact("S", (tx) => createSchedule(tx, doc, "Wall", { kind: "takeoff" }));
    const t = scheduleTable(doc, s);
    const layers = (doc.require(ids.wallTypes.exterior).params as { layers: unknown[] }).layers.length;
    const rows = t.rows.filter((r) => r.ids[0] === walls[1]!.id);
    expect(rows).toHaveLength(layers);
    const vol = rows.reduce((a, r) => a + (r.values[3] as number), 0);
    expect(vol).toBeCloseTo(((rows[0]!.values[2] as number) * wallThickness(doc, walls[1]!)) / 1000, 2);
    expect(() => doc.transact("X", (tx) => createSchedule(tx, doc, "Door", { kind: "takeoff" }))).toThrow(/layered/);
  });

  it("exports CSV and a valid XLSX zip", () => {
    const { doc } = house();
    const s = doc.transact("S", (tx) => createSchedule(tx, doc, "Room"));
    const t = scheduleTable(doc, s);
    const csv = tableCsv(t);
    expect(csv.split("\r\n")[0]).toBe("Room Schedule");
    expect(csv).toContain("Number,Name,Level,Area");
    const x = tableXlsx(t);
    expect([x[0], x[1], x[2], x[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    let text = "";
    for (const b of x) text += String.fromCharCode(b);
    expect(text).toContain("xl/worksheets/sheet1.xml");
    expect(text).toContain("<t>Kitchen</t>");
  });

  it("project parameters become fields", async () => {
    const { createProjectParameter } = await import("@open-bim/core");
    const { doc } = house();
    doc.transact("P", (tx) => createProjectParameter(tx, doc, "Finish", { categories: ["Room"] }));
    expect(scheduleFields(doc, { category: "Room", kind: "schedule" }).some((f) => f.key === "param:Finish")).toBe(true);
  });
});
