import { describe, expect, it } from "vitest";
import {
  Cat,
  Document,
  applyResidentialTemplate,
  createKeySchedule,
  createProjectParameter,
  createRoom,
  customValue,
  keyUsers,
  keyedBy,
  setCustomValue,
  type KeyScheduleParams,
} from "../src/index.ts";

describe("key schedules", () => {
  it("give keyed parameters their values from the element's key", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    doc.transact("P", (tx) => {
      createProjectParameter(tx, doc, "Floor Finish", { categories: [Cat.Room] });
      createProjectParameter(tx, doc, "Wall Finish", { categories: [Cat.Room] });
    });
    const ks = doc.transact("K", (tx) => createKeySchedule(tx, doc, Cat.Room, "Room Style"));
    expect(ks.name).toBe("Room Style Schedule");
    doc.transact("Rows", (tx) =>
      tx.update<KeyScheduleParams>(ks.id, {
        fields: ["Floor Finish"],
        rows: [
          { key: "Office", values: { "Floor Finish": "Carpet tiles" } },
          { key: "Wet area", values: { "Floor Finish": "Vinyl" } },
        ],
      }),
    );
    const room = doc.transact("R", (tx) => createRoom(tx, doc, ids.levels.ground, { x: 1000, y: 1000 }));
    expect(customValue(doc, room, "Floor Finish")).toBeUndefined();
    doc.transact("Key", (tx) => setCustomValue(tx, doc, room, "Room Style", "Wet area"));
    const r = doc.require(room.id);
    expect(customValue(doc, r, "Room Style")).toBe("Wet area");
    expect(customValue(doc, r, "Floor Finish")).toBe("Vinyl");
    expect(keyedBy(doc, r, "Floor Finish")?.id).toBe(ks.id);
    expect(keyUsers(doc, doc.require(ks.id) as never, "Wet area")).toEqual([room.id]);
    // Keyed parameters are read-only on the element; unkeyed ones aren't.
    expect(() => doc.transact("X", (tx) => setCustomValue(tx, doc, r, "Floor Finish", "Tiles"))).toThrow(/key schedule/);
    doc.transact("W", (tx) => setCustomValue(tx, doc, r, "Wall Finish", "Paint"));
    expect(customValue(doc, doc.require(room.id), "Wall Finish")).toBe("Paint");
    // Changing the key's row changes every element with that key.
    doc.transact("Edit", (tx) => tx.update<KeyScheduleParams>(ks.id, { rows: [{ key: "Wet area", values: { "Floor Finish": "Tiles" } }] }));
    expect(customValue(doc, doc.require(room.id), "Floor Finish")).toBe("Tiles");
    expect(() => doc.transact("Dup", (tx) => createKeySchedule(tx, doc, Cat.Room, "Room Style"))).toThrow();
  });
});
