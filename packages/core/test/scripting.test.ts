import { describe, expect, it } from "vitest";
import { Cat, Document, applyResidentialTemplate, createWall, inspect, pluginFromModule, runScript } from "../src/index.ts";

describe("scripting", () => {
  it("runs expressions and statement scripts with the given scope, including model edits", async () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    expect(await runScript("doc.byCategory('Level').length", { doc })).toBe(3);
    const n = await runScript(
      `doc.transact("Script walls", (tx) => {
         for (let i = 0; i < 3; i++) createWall(tx, ids.wallTypes.interior, { x: i * 1000, y: 0 }, { x: i * 1000, y: 3000 }, ids.levels.ground, {});
       });
       return doc.byCategory("Wall").length;`,
      { doc, ids, createWall },
    );
    expect(n).toBe(3);
    // One undo step for the whole script.
    doc.undo();
    expect(doc.byCategory(Cat.Wall)).toHaveLength(0);
    expect(await runScript("await Promise.resolve(42)", {})).toBe(42);
    await expect(runScript("throw new Error('nope')", {})).rejects.toThrow("nope");
  });

  it("accepts the plugin module shapes", () => {
    const activate = () => {};
    expect(pluginFromModule({ default: { name: "A", activate } }).name).toBe("A");
    expect(pluginFromModule({ default: activate }, "file.js").name).toBe("file.js");
    expect(pluginFromModule({ name: "B", activate }).name).toBe("B");
    expect(() => pluginFromModule({ default: {} })).toThrow(/activate/);
  });

  it("inspects values for the console", () => {
    expect(inspect([1, "a", { id: "0123456789", category: "Wall", name: "W" }])).toBe('[1, "a", Wall "W" (01234567)]');
    expect(inspect(new Error("x"))).toBe("Error: x");
  });
});
