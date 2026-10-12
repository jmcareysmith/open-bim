import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Document, applyResidentialTemplate, createWall, wallLength, type Wall, type WallParams } from "@open-bim/core";
import { bindDocument, elementsOf, SyncClient } from "../src/index.ts";
import { startServer, type SyncServer } from "../src/server.ts";

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 3000) {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error("timed out");
    await wait(10);
  }
}

/** Two Documents bound to two Y.Docs that exchange updates directly (no network). */
function pair() {
  const a = new Document();
  const ids = applyResidentialTemplate(a);
  const ya = new Y.Doc();
  const yb = new Y.Doc();
  ya.on("update", (u: Uint8Array, o: unknown) => o !== "net" && Y.applyUpdate(yb, u, "net"));
  yb.on("update", (u: Uint8Array, o: unknown) => o !== "net" && Y.applyUpdate(ya, u, "net"));
  bindDocument(a, ya);
  const b = new Document();
  bindDocument(b, yb);
  return { a, b, ya, yb, ids };
}

describe("document binding", () => {
  it("joins an existing session with the shared model", () => {
    const { a, b } = pair();
    expect(b.size).toBe(a.size);
    expect(b.canUndo).toBe(false);
  });

  it("sends edits both ways, outside the other user's undo", () => {
    const { a, b, ids } = pair();
    const w = a.transact("Wall", (tx) => createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 3000, y: 0 }, ids.levels.ground));
    expect(b.has(w.id)).toBe(true);
    expect(b.canUndo).toBe(false);
    b.transact("Lengthen", (tx) => tx.update<WallParams>(w.id, { end: { x: 6000, y: 0 } }));
    expect(wallLength(a.require(w.id) as Wall)).toBe(6000);
    // A's own "Wall" step touched that wall, so undo can no longer overwrite B's change.
    expect(a.undoName).not.toBe("Wall");
    b.undo();
    expect(wallLength(a.require(w.id) as Wall)).toBe(3000);
    b.transact("Delete", (tx) => tx.delete(w.id));
    expect(a.has(w.id)).toBe(false);
  });

  it("merges concurrent edits to different params of one element", () => {
    const a = new Document();
    const ids = applyResidentialTemplate(a);
    const w = a.transact("Wall", (tx) => createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 3000, y: 0 }, ids.levels.ground));
    const ya = new Y.Doc();
    bindDocument(a, ya);
    const yb = new Y.Doc();
    Y.applyUpdate(yb, Y.encodeStateAsUpdate(ya));
    const b = new Document();
    bindDocument(b, yb);
    // Offline, both edit the same wall.
    a.transact("Move end", (tx) => tx.update<WallParams>(w.id, { end: { x: 4000, y: 0 } }));
    b.transact("Offset", (tx) => tx.update<WallParams>(w.id, { baseOffset: 300 }));
    Y.applyUpdate(yb, Y.encodeStateAsUpdate(ya));
    Y.applyUpdate(ya, Y.encodeStateAsUpdate(yb));
    for (const d of [a, b]) {
      expect(d.require<WallParams>(w.id).params.end).toEqual({ x: 4000, y: 0 });
      expect(d.require<WallParams>(w.id).params.baseOffset).toBe(300);
    }
  });

  it("removes elements orphaned by a concurrent delete", async () => {
    const a = new Document();
    const ids = applyResidentialTemplate(a);
    const ya = new Y.Doc();
    bindDocument(a, ya);
    const yb = new Y.Doc();
    Y.applyUpdate(yb, Y.encodeStateAsUpdate(ya));
    const b = new Document();
    bindDocument(b, yb);
    // A adds a wall on the ground level's wall type while B deletes that type (unused for B).
    const w = a.transact("Wall", (tx) => createWall(tx, ids.wallTypes.interior, { x: 0, y: 0 }, { x: 3000, y: 0 }, ids.levels.ground));
    b.transact("Delete type", (tx) => tx.delete(ids.wallTypes.interior));
    Y.applyUpdate(yb, Y.encodeStateAsUpdate(ya));
    Y.applyUpdate(ya, Y.encodeStateAsUpdate(yb));
    await wait(0);
    expect(a.has(w.id)).toBe(false);
    expect(a.orphans()).toEqual([]);
    expect(elementsOf(ya).some((e) => e.id === w.id)).toBe(false);
  });
});

describe("sync server", () => {
  let server: SyncServer | undefined;
  const clients: SyncClient[] = [];
  afterEach(async () => {
    clients.splice(0).forEach((c) => c.close());
    await server?.close();
    server = undefined;
  });
  const enter = async (room: string, name: string, token?: string) => {
    const ydoc = new Y.Doc();
    const c = new SyncClient(ydoc, `ws://127.0.0.1:${server!.port}`, room, { token, user: { name, colour: "#f00" } });
    clients.push(c);
    await c.synced;
    return c;
  };

  it("syncs two users through a room, with presence", async () => {
    server = await startServer({ token: "s3cret" });
    const c1 = await enter("house", "Aroha", "s3cret");
    const a = new Document();
    const ids = applyResidentialTemplate(a);
    bindDocument(a, c1.ydoc);
    const c2 = await enter("house", "Wiremu", "s3cret");
    const b = new Document();
    bindDocument(b, c2.ydoc);
    expect(b.size).toBe(a.size);
    const w = b.transact("Wall", (tx) => createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 3000, y: 0 }, ids.levels.ground));
    await until(() => a.has(w.id));
    c2.setSelection([w.id]);
    await until(() => c1.peers().some((p) => p.name === "Wiremu" && p.selection?.[0] === w.id));
    c2.close();
    await until(() => c1.peers().length === 0);
  });

  it("refuses a wrong token", async () => {
    server = await startServer({ token: "s3cret" });
    await expect(enter("house", "Eve", "nope")).rejects.toThrow(/token/);
  });

  it("keeps rooms on disk between sessions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "obim-sync-"));
    server = await startServer({ dataDir: dir, saveDelay: 10 });
    const c1 = await enter("site", "Aroha");
    const a = new Document();
    applyResidentialTemplate(a);
    bindDocument(a, c1.ydoc);
    await wait(50);
    c1.close();
    await until(() => server!.rooms().length === 0);
    expect(existsSync(join(dir, "site.ybin"))).toBe(true);
    await server.close();
    server = await startServer({ dataDir: dir });
    const c2 = await enter("site", "Wiremu");
    const b = new Document();
    bindDocument(b, c2.ydoc);
    expect(b.size).toBe(a.size);
  });
});
