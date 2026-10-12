import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { applyAwarenessUpdate, encodeAwarenessUpdate, type Awareness } from "y-protocols/awareness";
import * as sync from "y-protocols/sync";
import type * as Y from "yjs";

// Wire protocol, compatible with y-websocket: each binary message starts with a type.
export const MSG_SYNC = 0;
export const MSG_AWARENESS = 1;

export function syncStep1(ydoc: Y.Doc): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MSG_SYNC);
  sync.writeSyncStep1(e, ydoc);
  return encoding.toUint8Array(e);
}

export function updateMessage(update: Uint8Array): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MSG_SYNC);
  sync.writeUpdate(e, update);
  return encoding.toUint8Array(e);
}

export function awarenessMessage(awareness: Awareness, clients: number[]): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MSG_AWARENESS);
  encoding.writeVarUint8Array(e, encodeAwarenessUpdate(awareness, clients));
  return encoding.toUint8Array(e);
}

/**
 * Handle one incoming message. Returns the reply (if any) and the sync message type read (so a
 * client knows when it has received the full state: sync step 2).
 */
export function handleMessage(
  data: Uint8Array,
  ydoc: Y.Doc,
  awareness: Awareness,
  origin: unknown,
): { reply?: Uint8Array; syncType?: number } {
  const d = decoding.createDecoder(data);
  const type = decoding.readVarUint(d);
  if (type === MSG_SYNC) {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, MSG_SYNC);
    const syncType = sync.readSyncMessage(d, e, ydoc, origin);
    return { reply: encoding.length(e) > 1 ? encoding.toUint8Array(e) : undefined, syncType };
  }
  if (type === MSG_AWARENESS) applyAwarenessUpdate(awareness, decoding.readVarUint8Array(d), origin);
  return {};
}

export const SYNC_STEP2 = sync.messageYjsSyncStep2;
