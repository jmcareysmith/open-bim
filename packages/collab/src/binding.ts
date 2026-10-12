import * as Y from "yjs";
import type { ChangeSet, Document, Element, ElementId } from "@open-bim/core";

// Binds an Open-BIM Document to a Yjs document so several people can edit one model. The Y.Doc
// holds a map of element id → element, where each element is a Y.Map (category, name, typeId) and
// its params a nested Y.Map. Concurrent edits to different params of one element merge; edits to
// the same param resolve last-writer-wins, as Yjs does. Local transactions (and undo/redo) are
// written to the Y.Doc; remote updates come back through `doc.applyRemote`, which keeps them out
// of the local undo history.

/** Transaction origin for edits made by this binding (so its own updates aren't re-applied). */
export const LOCAL_ORIGIN = Symbol("open-bim-local");

type YElement = Y.Map<unknown>;

export interface BindingOptions {
  /** Called when merged edits leave elements with missing dependencies. Default: delete them. */
  onOrphans?: (ids: ElementId[]) => void;
}

export interface Binding {
  /** Stop syncing (the Y.Doc and Document stay as they are). */
  destroy(): void;
}

const json = (v: unknown): unknown => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Read one element out of its Y.Map. */
export function readElement(id: ElementId, y: YElement): Element {
  const params = y.get("params");
  const el: Element = { id, category: y.get("category") as string, params: params instanceof Y.Map ? (params.toJSON() as Element["params"]) : {} };
  const name = y.get("name");
  const typeId = y.get("typeId");
  if (typeof name === "string") el.name = name;
  if (typeof typeId === "string") el.typeId = typeId;
  return el;
}

/** Write an element into the map, touching only the fields and params that changed. */
function writeElement(root: Y.Map<YElement>, el: Element): void {
  let y = root.get(el.id);
  if (!y) {
    y = new Y.Map<unknown>();
    y.set("category", el.category);
    y.set("params", new Y.Map<unknown>());
    root.set(el.id, y);
  }
  if (y.get("category") !== el.category) y.set("category", el.category);
  for (const key of ["name", "typeId"] as const) {
    const v = el[key];
    if (v === undefined) {
      if (y.has(key)) y.delete(key);
    } else if (y.get(key) !== v) y.set(key, v);
  }
  let params = y.get("params") as Y.Map<unknown> | undefined;
  if (!(params instanceof Y.Map)) y.set("params", (params = new Y.Map<unknown>()));
  const next = el.params as Record<string, unknown>;
  for (const key of [...params.keys()]) if (next[key] === undefined) params.delete(key);
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) continue;
    if (!same(params.get(key), value)) params.set(key, json(value));
  }
}

/** Every element currently in the Y.Doc. */
export function elementsOf(ydoc: Y.Doc): Element[] {
  const root = ydoc.getMap<YElement>("elements");
  return [...root.entries()].map(([id, y]) => readElement(id, y));
}

/**
 * Bind `doc` to `ydoc`. If the Y.Doc already holds a model (joining a session), `doc` is replaced
 * by it; otherwise `doc`'s elements are written into the Y.Doc (starting one).
 */
export function bindDocument(doc: Document, ydoc: Y.Doc, opts: BindingOptions = {}): Binding {
  const root = ydoc.getMap<YElement>("elements");

  if (root.size) doc.load({ format: "open-bim", version: 1, elements: elementsOf(ydoc) });
  else ydoc.transact(() => doc.all().forEach((el) => writeElement(root, el)), LOCAL_ORIGIN);

  const repair = (ids: ElementId[]) => {
    if (opts.onOrphans) return opts.onOrphans(ids);
    doc.transact("Remove orphaned elements", (tx) => ids.forEach((id) => doc.has(id) && tx.delete(id)));
  };

  // Local → Y.Doc.
  const offDoc = doc.on((c: ChangeSet) => {
    if (c.remote) return;
    ydoc.transact(() => {
      for (const id of c.removed) if (!doc.has(id)) root.delete(id);
      for (const id of [...c.added, ...c.modified]) {
        const el = doc.get(id);
        if (el) writeElement(root, el);
      }
    }, LOCAL_ORIGIN);
  });

  // Y.Doc → local.
  const onRemote = (events: Y.YEvent<Y.AbstractType<unknown>>[], tr: Y.Transaction) => {
    if (tr.origin === LOCAL_ORIGIN) return;
    const ids = new Set<ElementId>();
    for (const ev of events) {
      if (ev.target === root) for (const key of ev.changes.keys.keys()) ids.add(key);
      else if (typeof ev.path[0] === "string") ids.add(ev.path[0]);
    }
    const put: Element[] = [];
    const remove: ElementId[] = [];
    for (const id of ids) {
      const y = root.get(id);
      if (y) put.push(readElement(id, y));
      else if (doc.has(id)) remove.push(id);
    }
    doc.applyRemote("Remote edit", put, remove);
    const orphans = doc.orphans();
    // Repair after Yjs finishes this transaction's observers.
    if (orphans.length) queueMicrotask(() => repair(doc.orphans()));
  };
  root.observeDeep(onRemote);

  return {
    destroy() {
      offDoc();
      root.unobserveDeep(onRemote);
    },
  };
}
