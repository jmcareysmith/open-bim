import { describe, expect, it } from "vitest";
import * as core from "../src/index.ts";
import { Document, applyResidentialTemplate, createRoom, pluginFromModule, type PluginCommand } from "../src/index.ts";

// The example plugin shipped in examples/plugins (plain JS), run against a minimal API.
const EXAMPLE: string = "../../../examples/plugins/room-numbering.js";

describe("example plugin", () => {
  it("renumbers rooms on the active level in reading order", async () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    const [a, b, c] = doc.transact("Rooms", (tx) => [
      createRoom(tx, doc, ids.levels.first, { x: 5000, y: 5000 }, { number: "x" }),
      createRoom(tx, doc, ids.levels.first, { x: 1000, y: 5000 }, { number: "y" }),
      createRoom(tx, doc, ids.levels.first, { x: 1000, y: 1000 }, { number: "z" }),
    ]);
    const commands: PluginCommand[] = [];
    const statuses: string[] = [];
    const plugin = pluginFromModule((await import(/* @vite-ignore */ EXAMPLE)) as Record<string, unknown>);
    await plugin.activate({
      core,
      doc,
      transact: doc.transact.bind(doc),
      activeLevel: () => doc.get(ids.levels.first),
      addCommand: (cmd: PluginCommand) => commands.push(cmd),
      status: (s: string) => statuses.push(s),
    });
    expect(plugin.name).toBe("Room numbering");
    await commands[0]!.run();
    const num = (id: string) => (doc.require(id).params as { number: string }).number;
    expect([num(b!.id), num(a!.id), num(c!.id)]).toEqual(["101", "102", "103"]);
    expect(statuses[0]).toMatch(/Renumbered 3/);
  });
});
