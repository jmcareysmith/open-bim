import type { DocumentJSON } from "@open-bim/core";

// Autosave and recovery (Revit's "Save Reminder" / recovery): while a project has unsaved changes it
// is written every few minutes to IndexedDB (works in the browser and the desktop webview, with
// room for large projects). Saving clears it; at start-up a leftover autosave offers recovery.

export const AUTOSAVE_MINUTES = 3;

export interface Autosave {
  json: DocumentJSON;
  /** The file it belongs to (desktop path or browser file name), if it had been saved. */
  path: string | null;
  /** When it was written (ms since 1970). */
  time: number;
}

const DB = "open-bim";
const STORE = "autosave";
const KEY = "current";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function writeAutosave(a: Autosave): Promise<void> {
  await run("readwrite", (s) => s.put(a, KEY));
}

export async function readAutosave(): Promise<Autosave | null> {
  try {
    return ((await run("readonly", (s) => s.get(KEY))) as Autosave | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function clearAutosave(): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(KEY));
  } catch {
    /* nothing to clear */
  }
}

/**
 * Autosave every AUTOSAVE_MINUTES while `state()` says there are unsaved changes (and it isn't a
 * family being edited). Returns a stop function.
 */
export function startAutosave(state: () => { dirty: boolean; json: () => DocumentJSON; path: string | null } | null, onSaved?: (time: number) => void): () => void {
  const timer = setInterval(async () => {
    const s = state();
    if (!s || !s.dirty) return;
    try {
      const time = Date.now();
      await writeAutosave({ json: s.json(), path: s.path, time });
      onSaved?.(time);
    } catch {
      /* storage full or unavailable: try again next time */
    }
  }, AUTOSAVE_MINUTES * 60_000);
  return () => clearInterval(timer);
}
