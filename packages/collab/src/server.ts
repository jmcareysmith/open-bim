import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { Awareness, removeAwarenessStates } from "y-protocols/awareness";
import * as Y from "yjs";
import { awarenessMessage, handleMessage, syncStep1, updateMessage } from "./protocol.ts";

// Open-BIM sync server: one Yjs document per room (project), relayed between connected clients and
// saved to disk, so a project lives on the server between sessions (the "cloud" copy). Self-hosted:
// run `npm run serve -w @open-bim/collab` on any machine people can reach. Access is one shared
// token per server (OPEN_BIM_TOKEN); put it behind TLS (wss://) when exposed to the internet.

export interface ServerOptions {
  port?: number;
  host?: string;
  /** Directory rooms are saved in (`<room>.ybin`). Omit to keep rooms in memory only. */
  dataDir?: string;
  /** Required access token; omit for an open server (local network / testing). */
  token?: string;
  /** Milliseconds to wait after an edit before saving. */
  saveDelay?: number;
}

interface Room {
  name: string;
  ydoc: Y.Doc;
  awareness: Awareness;
  conns: Map<WebSocket, Set<number>>;
  saveTimer?: ReturnType<typeof setTimeout>;
}

export interface SyncServer {
  port: number;
  /** Rooms currently loaded. */
  rooms(): string[];
  /** Save every room now. */
  flush(): void;
  close(): Promise<void>;
}

export const validRoom = (name: string) => /^[A-Za-z0-9_.-]{1,100}$/.test(name) && !name.startsWith(".");

export function startServer(opts: ServerOptions = {}): Promise<SyncServer> {
  const rooms = new Map<string, Room>();
  const saveDelay = opts.saveDelay ?? 1000;
  if (opts.dataDir) mkdirSync(opts.dataDir, { recursive: true });

  const save = (room: Room) => {
    clearTimeout(room.saveTimer);
    room.saveTimer = undefined;
    if (!opts.dataDir) return;
    const file = join(opts.dataDir, `${room.name}.ybin`);
    writeFileSync(`${file}.tmp`, Y.encodeStateAsUpdate(room.ydoc));
    renameSync(`${file}.tmp`, file);
  };

  const getRoom = (name: string): Room => {
    let room = rooms.get(name);
    if (room) return room;
    const ydoc = new Y.Doc();
    if (opts.dataDir) {
      const file = join(opts.dataDir, `${name}.ybin`);
      if (existsSync(file)) Y.applyUpdate(ydoc, readFileSync(file));
    }
    const r: Room = { name, ydoc, awareness: new Awareness(ydoc), conns: new Map() };
    r.awareness.setLocalState(null);
    ydoc.on("update", (update: Uint8Array, origin: unknown) => {
      const msg = updateMessage(update);
      for (const ws of r.conns.keys()) if (ws !== origin) ws.send(msg);
      if (!r.saveTimer) r.saveTimer = setTimeout(() => save(r), saveDelay);
    });
    r.awareness.on("update", ({ added, updated, removed }: Record<string, number[]>, origin: unknown) => {
      const changed = [...added!, ...updated!, ...removed!];
      const ids = origin ? r.conns.get(origin as WebSocket) : undefined;
      if (ids) {
        for (const id of added!) ids.add(id);
        for (const id of removed!) ids.delete(id);
      }
      const msg = awarenessMessage(r.awareness, changed);
      for (const ws of r.conns.keys()) ws.send(msg);
    });
    rooms.set(name, r);
    return r;
  };

  const http: Server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Open-BIM sync server\n");
  });
  const wss = new WebSocketServer({ server: http });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", "http://x");
    const name = decodeURIComponent(url.pathname.slice(1));
    if (opts.token && url.searchParams.get("token") !== opts.token) return ws.close(4401, "Access token refused");
    if (!validRoom(name)) return ws.close(4400, "Bad room name");
    const room = getRoom(name);
    room.conns.set(ws, new Set());
    ws.binaryType = "arraybuffer";
    ws.on("message", (data: ArrayBuffer) => {
      try {
        const { reply } = handleMessage(new Uint8Array(data), room.ydoc, room.awareness, ws);
        if (reply) ws.send(reply);
      } catch {
        ws.close(4400, "Bad message");
      }
    });
    ws.on("close", () => {
      const ids = room.conns.get(ws);
      room.conns.delete(ws);
      if (ids?.size) removeAwarenessStates(room.awareness, [...ids], null);
      if (!room.conns.size) {
        save(room);
        room.ydoc.destroy();
        rooms.delete(name);
      }
    });
    ws.send(syncStep1(room.ydoc));
    const others = [...room.awareness.getStates().keys()];
    if (others.length) ws.send(awarenessMessage(room.awareness, others));
  });

  return new Promise((resolve) => {
    http.listen(opts.port ?? 0, opts.host ?? "0.0.0.0", () => {
      const addr = http.address();
      resolve({
        port: typeof addr === "object" && addr ? addr.port : (opts.port ?? 0),
        rooms: () => [...rooms.keys()],
        flush: () => rooms.forEach(save),
        close: () =>
          new Promise<void>((done) => {
            rooms.forEach(save);
            for (const ws of wss.clients) ws.terminate();
            wss.close(() => http.close(() => done()));
          }),
      });
    });
  });
}
