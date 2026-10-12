import { Awareness, removeAwarenessStates } from "y-protocols/awareness";
import * as Y from "yjs";
import { SYNC_STEP2, awarenessMessage, handleMessage, syncStep1, updateMessage } from "./protocol.ts";

// Client side of the sync server: keeps a Y.Doc in step with a room over a WebSocket, reconnecting
// after drops (edits made while offline are sent on reconnect). Presence (who's in the room and
// what they have selected) travels as Yjs awareness state.

export type SyncStatus = "connecting" | "connected" | "offline";

export interface Presence {
  name: string;
  colour: string;
  selection?: string[];
}

export interface SyncClientOptions {
  /** Shared access token, if the server needs one. */
  token?: string;
  user: Presence;
  /** WebSocket constructor (defaults to the global one). */
  WebSocket?: typeof WebSocket;
}

export class SyncClient {
  readonly awareness: Awareness;
  /** Resolves once the room's full state has arrived (first connection). */
  readonly synced: Promise<void>;
  status: SyncStatus = "connecting";
  private ws: WebSocket | null = null;
  private closed = false;
  private retry = 500;
  private resolveSynced!: () => void;
  private statusListeners = new Set<(s: SyncStatus) => void>();
  private rejectSynced!: (err: Error) => void;
  private everSynced = false;

  constructor(
    readonly ydoc: Y.Doc,
    readonly url: string,
    readonly room: string,
    private opts: SyncClientOptions,
  ) {
    this.awareness = new Awareness(ydoc);
    this.awareness.setLocalState(opts.user);
    this.synced = new Promise((res, rej) => {
      this.resolveSynced = res;
      this.rejectSynced = rej;
    });
    ydoc.on("update", this.onUpdate);
    this.awareness.on("update", this.onAwareness);
    this.connect();
  }

  onStatus(fn: (s: SyncStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  /** Other people in the room. */
  peers(): Presence[] {
    const me = this.ydoc.clientID;
    return [...this.awareness.getStates()].filter(([id, s]) => id !== me && s && (s as Presence).name).map(([, s]) => s as Presence);
  }

  setSelection(ids: string[]): void {
    this.awareness.setLocalStateField("selection", ids);
  }

  close(): void {
    this.closed = true;
    removeAwarenessStates(this.awareness, [this.ydoc.clientID], "close");
    this.ydoc.off("update", this.onUpdate);
    this.awareness.off("update", this.onAwareness);
    this.ws?.close();
    this.setStatus("offline");
    if (!this.everSynced) this.rejectSynced(new Error("Closed before syncing"));
  }

  private setStatus(s: SyncStatus): void {
    if (s === this.status) return;
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }

  private connect(): void {
    const Ctor = this.opts.WebSocket ?? WebSocket;
    const q = this.opts.token ? `?token=${encodeURIComponent(this.opts.token)}` : "";
    const ws = new Ctor(`${this.url.replace(/\/$/, "")}/${encodeURIComponent(this.room)}${q}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    this.setStatus("connecting");
    ws.onopen = () => {
      this.retry = 500;
      ws.send(syncStep1(this.ydoc));
      ws.send(awarenessMessage(this.awareness, [this.ydoc.clientID]));
    };
    ws.onmessage = (ev) => {
      const { reply, syncType } = handleMessage(new Uint8Array(ev.data as ArrayBuffer), this.ydoc, this.awareness, this);
      if (reply) ws.send(reply);
      if (syncType === SYNC_STEP2) {
        this.setStatus("connected");
        if (!this.everSynced) {
          this.everSynced = true;
          this.resolveSynced();
        }
      }
    };
    ws.onclose = (ev) => {
      this.ws = null;
      // Others' presence is stale once we're cut off.
      const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.ydoc.clientID);
      removeAwarenessStates(this.awareness, others, this);
      if (this.closed) return;
      this.setStatus("offline");
      if (ev.code === 4401) {
        this.closed = true;
        if (!this.everSynced) this.rejectSynced(new Error("Access token refused"));
        return;
      }
      setTimeout(() => !this.closed && this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 10000);
    };
  }

  private send(msg: Uint8Array): void {
    if (this.ws?.readyState === 1) this.ws.send(msg);
  }

  private onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== this) this.send(updateMessage(update));
  };

  private onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === this) return;
    this.send(awarenessMessage(this.awareness, [...added, ...updated, ...removed]));
  };
}

/** A fresh Y.Doc (re-exported so the app needn't depend on yjs directly). */
export const newYDoc = () => new Y.Doc();
