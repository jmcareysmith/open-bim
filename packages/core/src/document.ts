import { getCategory } from "./categories.ts";
import { clone, newId, type Element, type ElementId, type Params } from "./element.ts";

/** One element's state before and after a transaction. `undefined` = did not exist. */
interface ElementChange {
  id: ElementId;
  before: Element | undefined;
  after: Element | undefined;
}

interface Committed {
  name: string;
  changes: ElementChange[];
}

export interface ChangeSet {
  /** Transaction name, or "Undo: x" / "Redo: x" / "Load". */
  name: string;
  added: ElementId[];
  modified: ElementId[];
  removed: ElementId[];
  /** Existing elements whose derived data (geometry) must be rebuilt: added + modified + dependents. */
  regenerate: ElementId[];
}

export type ChangeListener = (changes: ChangeSet) => void;

export interface CreateOptions {
  id?: ElementId;
  name?: string;
  typeId?: ElementId;
}

/** Editing handle passed to `doc.transact`. All model edits go through this. */
export interface Transaction {
  create<P extends Params>(category: string, params: P, opts?: CreateOptions): Element<P>;
  update<P extends Params>(id: ElementId, patch: Partial<P>): Element<P>;
  setName(id: ElementId, name: string | undefined): void;
  setType(id: ElementId, typeId: ElementId): void;
  delete(id: ElementId): void;
}

export interface DocumentJSON {
  format: "open-bim";
  version: 1;
  elements: Element[];
}

export class Document {
  private elements = new Map<ElementId, Element>();
  private undoStack: Committed[] = [];
  private redoStack: Committed[] = [];
  private listeners = new Set<ChangeListener>();
  private commitHooks = new Set<(tx: Transaction) => void>();
  private active: Map<ElementId, Element | undefined> | null = null;

  // ---- queries -----------------------------------------------------------

  get<P extends Params = Params>(id: ElementId): Element<P> | undefined {
    return this.elements.get(id) as Element<P> | undefined;
  }

  require<P extends Params = Params>(id: ElementId): Element<P> {
    const el = this.get<P>(id);
    if (!el) throw new Error(`Element not found: ${id}`);
    return el;
  }

  has(id: ElementId): boolean {
    return this.elements.has(id);
  }

  all(): Element[] {
    return [...this.elements.values()];
  }

  byCategory<P extends Params = Params>(category: string): Element<P>[] {
    return this.all().filter((e) => e.category === category) as Element<P>[];
  }

  get size(): number {
    return this.elements.size;
  }

  /** Elements that list `id` as a dependency (direct only). */
  dependents(id: ElementId): Element[] {
    return this.all().filter((e) => this.depsOf(e).includes(id));
  }

  // ---- events ------------------------------------------------------------

  on(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Run `hook` at the end of every transaction, before it commits, so its edits join the same
   * undo step (used by families to flex reference planes to their constraints). If it throws,
   * the whole transaction rolls back.
   */
  addCommitHook(hook: (tx: Transaction) => void): () => void {
    this.commitHooks.add(hook);
    return () => this.commitHooks.delete(hook);
  }

  // ---- transactions ------------------------------------------------------

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoName(): string | undefined {
    return this.undoStack.at(-1)?.name;
  }
  get redoName(): string | undefined {
    return this.redoStack.at(-1)?.name;
  }

  /**
   * Run `fn` as one undoable unit. If it throws, every edit is rolled back and the error rethrown.
   */
  transact<T>(name: string, fn: (tx: Transaction) => T): T {
    if (this.active) throw new Error("Nested transactions are not supported");
    const touched = new Map<ElementId, Element | undefined>();
    this.active = touched;
    let result: T;
    try {
      const tx = this.makeTx(touched);
      result = fn(tx);
      if (touched.size) for (const hook of this.commitHooks) hook(tx);
    } catch (err) {
      for (const [id, before] of touched) this.put(id, before);
      this.active = null;
      throw err;
    }
    this.active = null;

    const changes: ElementChange[] = [];
    for (const [id, before] of touched) {
      const after = this.elements.get(id);
      if (before === undefined && after === undefined) continue;
      changes.push({ id, before, after: after && clone(after) });
    }
    if (changes.length === 0) return result;
    this.undoStack.push({ name, changes });
    this.redoStack = [];
    this.emit(name, changes);
    return result;
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    for (const c of entry.changes) this.put(c.id, c.before && clone(c.before));
    this.redoStack.push(entry);
    this.emit(`Undo: ${entry.name}`, entry.changes.map(invert));
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    for (const c of entry.changes) this.put(c.id, c.after && clone(c.after));
    this.undoStack.push(entry);
    this.emit(`Redo: ${entry.name}`, entry.changes);
    return true;
  }

  // ---- serialisation -----------------------------------------------------

  toJSON(): DocumentJSON {
    return { format: "open-bim", version: 1, elements: this.all().map(clone) };
  }

  static fromJSON(json: DocumentJSON): Document {
    if (json.format !== "open-bim") throw new Error("Not an Open-BIM file");
    if (json.version !== 1) throw new Error(`Unsupported file version: ${json.version}`);
    const doc = new Document();
    for (const el of json.elements) {
      getCategory(el.category); // validate
      doc.elements.set(el.id, clone(el));
    }
    return doc;
  }

  /** Replace all content (e.g. after opening a file). Clears undo history. */
  load(json: DocumentJSON): void {
    const loaded = Document.fromJSON(json);
    const removed = [...this.elements.keys()];
    this.elements = loaded.elements;
    this.undoStack = [];
    this.redoStack = [];
    const added = [...this.elements.keys()];
    const set: ChangeSet = { name: "Load", added, modified: [], removed, regenerate: added };
    for (const l of this.listeners) l(set);
  }

  // ---- internals ---------------------------------------------------------

  private depsOf(el: Element): ElementId[] {
    // Group members depend on their group (deleting a group deletes its members).
    const group = (el.params as { groupId?: unknown }).groupId;
    const deps = getCategory(el.category).dependencies(el);
    return typeof group === "string" ? [...deps, group] : deps;
  }

  private put(id: ElementId, el: Element | undefined): void {
    if (el) this.elements.set(id, el);
    else this.elements.delete(id);
  }

  private makeTx(touched: Map<ElementId, Element | undefined>): Transaction {
    const remember = (id: ElementId) => {
      if (!touched.has(id)) {
        const cur = this.elements.get(id);
        touched.set(id, cur && clone(cur));
      }
    };
    const assertLive = () => {
      if (this.active !== touched) throw new Error("Transaction is no longer active");
    };

    const tx: Transaction = {
      create: <P extends Params>(category: string, params: P, opts: CreateOptions = {}) => {
        assertLive();
        getCategory(category);
        const id = opts.id ?? newId();
        if (this.elements.has(id)) throw new Error(`Duplicate element id: ${id}`);
        if (opts.typeId !== undefined) this.require(opts.typeId);
        remember(id);
        const el: Element<P> = { id, category, params: clone(params) };
        if (opts.name !== undefined) el.name = opts.name;
        if (opts.typeId !== undefined) el.typeId = opts.typeId;
        for (const dep of this.depsOf(el)) {
          if (!this.elements.has(dep)) throw new Error(`${category} depends on missing element ${dep}`);
        }
        this.elements.set(id, el);
        return el;
      },

      update: <P extends Params>(id: ElementId, patch: Partial<P>) => {
        assertLive();
        const el = this.require<P>(id);
        remember(id);
        el.params = { ...el.params, ...clone(patch) } as P;
        for (const dep of this.depsOf(el)) {
          if (!this.elements.has(dep)) throw new Error(`${el.category} depends on missing element ${dep}`);
        }
        return el;
      },

      setName: (id, name) => {
        assertLive();
        const el = this.require(id);
        remember(id);
        if (name === undefined) delete el.name;
        else el.name = name;
      },

      setType: (id, typeId) => {
        assertLive();
        const el = this.require(id);
        const type = this.require(typeId);
        if (!getCategory(type.category).isType) throw new Error(`${type.category} is not a type`);
        remember(id);
        el.typeId = typeId;
      },

      delete: (id) => {
        assertLive();
        if (!this.elements.has(id)) return;
        const blockers: Element[] = [];
        const toDelete = new Set<ElementId>();
        const visit = (cur: ElementId) => {
          if (toDelete.has(cur)) return;
          toDelete.add(cur);
          for (const dep of this.dependents(cur)) {
            if (getCategory(dep.category).cascadeDelete) visit(dep.id);
            else blockers.push(dep);
          }
        };
        visit(id);
        const realBlockers = blockers.filter((b) => !toDelete.has(b.id));
        if (realBlockers.length) {
          const names = realBlockers.map((b) => `${b.category} "${b.name ?? b.id}"`);
          throw new Error(`Cannot delete: still used by ${names.join(", ")}`);
        }
        for (const d of toDelete) {
          remember(d);
          this.elements.delete(d);
        }
      },
    };
    return tx;
  }

  private emit(name: string, changes: ElementChange[]): void {
    const added: ElementId[] = [];
    const modified: ElementId[] = [];
    const removed: ElementId[] = [];
    for (const c of changes) {
      if (!c.before && c.after) added.push(c.id);
      else if (c.before && !c.after) removed.push(c.id);
      else modified.push(c.id);
    }

    // Regenerate: changed elements plus everything transitively depending on them.
    const regen = new Set<ElementId>();
    const queue = [...added, ...modified, ...removed];
    const reverse = new Map<ElementId, ElementId[]>();
    for (const el of this.elements.values()) {
      for (const dep of this.depsOf(el)) {
        let list = reverse.get(dep);
        if (!list) reverse.set(dep, (list = []));
        list.push(el.id);
      }
    }
    while (queue.length) {
      const id = queue.pop()!;
      if (regen.has(id)) continue;
      regen.add(id);
      for (const d of reverse.get(id) ?? []) queue.push(d);
    }
    // One hop of spatial relations (wall joins), from both the old and new state of each element,
    // so a wall that moved away from a join still regenerates the wall it left.
    const related = new Set<ElementId>();
    const addRelated = (el: Element | undefined) => {
      if (!el) return;
      for (const r of getCategory(el.category).related?.(this, el) ?? []) related.add(r);
    };
    for (const c of changes) addRelated(c.before);
    for (const id of regen) addRelated(this.elements.get(id));
    for (const id of related) regen.add(id);
    const regenerate = [...regen].filter((id) => this.elements.has(id));

    const set: ChangeSet = { name, added, modified, removed, regenerate };
    for (const l of this.listeners) l(set);
  }
}

function invert(c: ElementChange): ElementChange {
  return { id: c.id, before: c.after, after: c.before };
}
