import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, ParamValue, Params } from "../element.ts";
import { Cat } from "./architecture.ts";

// Visual programming (Revit: Dynamo). A graph is a project element holding nodes (each an instance
// of a registered node type, with literal values for unconnected inputs) and links from outputs to
// inputs. Running it evaluates the nodes in dependency order inside one transaction:
// - a node is re-run only when its inputs changed since the last run (or it reads the model);
// - a list given to a single-value input runs the node once per item (Dynamo's lacing);
// - elements a node creates stay bound to it, so the next run updates them instead of adding more.

export type GraphNode = {
  id: string;
  type: string;
  x: number;
  y: number;
  /** Literal values for inputs with no link (and node settings, e.g. a slider's value). */
  values?: Record<string, ParamValue>;
};

export type GraphLink = { from: { node: string; port: string }; to: { node: string; port: string } };

export type GraphParams = {
  nodes: GraphNode[];
  links: GraphLink[];
  /** Elements made by each node at the last run, in order (kept between runs). */
  bindings?: Record<string, ElementId[]>;
  /** Run whenever the graph or the model changes (Dynamo's Automatic). */
  automatic?: boolean;
};
export type Graph = Element<GraphParams>;

registerCategory({ name: Cat.Graph, dependencies: () => [], cascadeDelete: false, isType: false });

// ---- node types ---------------------------------------------------------------------------

export type PortType = "number" | "string" | "boolean" | "point" | "line" | "polygon" | "element" | "any";

export type PortDef = {
  name: string;
  type: PortType;
  /** Takes a whole list (no lacing). */
  list?: boolean;
  /** Used when nothing is linked and no value is set. */
  default?: unknown;
};

export interface NodeContext {
  doc: Document;
  tx: Transaction;
  /** The UI's selection (Select Model Elements). */
  selection: ElementId[];
  /**
   * Make or update this node's `index`-th element: `create` builds a fresh one; when the node made
   * one in that slot last time, it takes the new one's params, type and name and keeps its id.
   */
  bind(index: number, create: () => Element, opts?: BindOptions): Element;
}

/** What a re-made element keeps from the one it replaces (auto-numbered names, room numbers). */
export type BindOptions = { keepName?: boolean; keep?: string[] };

export type NodeDef = {
  type: string;
  label: string;
  /** Library group: Input, Maths, Lists, Geometry, Selection, Elements, Display. */
  category: string;
  inputs: PortDef[];
  outputs: PortDef[];
  /** Reads the model, so always re-runs. */
  volatile?: boolean;
  /** Makes or changes elements. */
  effect?: boolean;
  /** Settings shown on the node (not ports), e.g. a slider's range: names of `values` keys. */
  settings?: { name: string; type: "number" | "string" | "boolean" | "select"; options?: string[] }[];
  run(inputs: Record<string, unknown>, ctx: NodeContext, node: GraphNode): Record<string, unknown>;
};

const defs = new Map<string, NodeDef>();

export function registerNode(def: NodeDef): void {
  defs.set(def.type, def);
}

export function nodeDef(type: string): NodeDef | undefined {
  return defs.get(type);
}

export function nodeDefs(): NodeDef[] {
  return [...defs.values()];
}

// ---- running --------------------------------------------------------------------------------

export type NodeResult = { outputs: Record<string, unknown>; error?: string; ran: boolean };

/** Last results per graph (for incremental re-runs and the editor's watch values). */
const caches = new Map<ElementId, Map<string, { key: string; outputs: Record<string, unknown> }>>();

/** Nodes in dependency order; throws on a cycle. */
export function graphOrder(g: GraphParams): GraphNode[] {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const out: GraphNode[] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (n: GraphNode) => {
    const s = state.get(n.id);
    if (s === 2) return;
    if (s === 1) throw new Error("The graph has a loop: a node feeds back into itself");
    state.set(n.id, 1);
    for (const l of g.links) if (l.to.node === n.id && byId.has(l.from.node)) visit(byId.get(l.from.node)!);
    state.set(n.id, 2);
    out.push(n);
  };
  for (const n of g.nodes) visit(n);
  return out;
}

const keyOf = (v: unknown) => {
  try {
    return JSON.stringify(v);
  } catch {
    return String(Math.random());
  }
};

/** Run one node, lacing lists into single-value inputs (shortest list wins). */
function runLaced(def: NodeDef, inputs: Record<string, unknown>, ctx: NodeContext, node: GraphNode): Record<string, unknown> {
  const laced = def.inputs.filter((p) => !p.list && Array.isArray(inputs[p.name]));
  if (!laced.length) return def.run(inputs, ctx, node);
  const n = Math.min(...laced.map((p) => (inputs[p.name] as unknown[]).length));
  const results: Record<string, unknown>[] = [];
  let slot = 0;
  for (let i = 0; i < n; i++) {
    const one = { ...inputs };
    for (const p of laced) one[p.name] = (inputs[p.name] as unknown[])[i];
    // Each item binds its own elements: offset the slots per item.
    const base = slot;
    let used = 0;
    const itemCtx: NodeContext = {
      ...ctx,
      bind: (index, create, o) => {
        used = Math.max(used, index + 1);
        return ctx.bind(base + index, create, o);
      },
    };
    results.push(runLaced(def, one, itemCtx, node));
    slot += used;
  }
  const out: Record<string, unknown> = {};
  for (const o of def.outputs) out[o.name] = results.map((r) => r[o.name]);
  return out;
}

/**
 * Run a graph: evaluates every node (re-running only what changed) and applies element changes in
 * one transaction ("Run <graph name>"). Returns each node's outputs or error.
 */
export function runGraph(doc: Document, graphId: ElementId, opts: { selection?: ElementId[]; full?: boolean } = {}): Map<string, NodeResult> {
  const graph = doc.require<GraphParams>(graphId) as Graph;
  if (graph.category !== Cat.Graph) throw new Error("Not a graph");
  const results = new Map<string, NodeResult>();
  let cache = caches.get(graphId);
  if (!cache || opts.full) caches.set(graphId, (cache = new Map()));
  const g = graph.params;
  doc.transact(`Run ${graph.name ?? "graph"}`, (tx) => {
    const bindings: Record<string, ElementId[]> = {};
    const order = graphOrder(g);
    for (const node of order) {
      const def = defs.get(node.type);
      if (!def) {
        results.set(node.id, { outputs: {}, error: `Unknown node type ${node.type}`, ran: false });
        continue;
      }
      // Inputs: linked outputs, else the node's literal values, else defaults.
      const inputs: Record<string, unknown> = {};
      let upstreamError: string | null = null;
      for (const p of def.inputs) {
        const link = g.links.find((l) => l.to.node === node.id && l.to.port === p.name);
        if (link) {
          const r = results.get(link.from.node);
          if (r?.error) upstreamError = "An input node has an error";
          inputs[p.name] = r?.outputs[link.from.port];
        } else inputs[p.name] = node.values?.[p.name] ?? p.default;
      }
      if (upstreamError) {
        results.set(node.id, { outputs: {}, error: upstreamError, ran: false });
        bindings[node.id] = g.bindings?.[node.id] ?? [];
        continue;
      }
      const missing = def.inputs.find((p) => inputs[p.name] === undefined);
      if (missing) {
        results.set(node.id, { outputs: {}, error: `Needs ${missing.name}`, ran: false });
        bindings[node.id] = g.bindings?.[node.id] ?? [];
        continue;
      }
      const key = keyOf({ inputs, settings: node.values });
      const hit = cache.get(node.id);
      if (hit && hit.key === key && !def.volatile && !def.effect) {
        results.set(node.id, { outputs: hit.outputs, ran: false });
        continue;
      }
      const old = g.bindings?.[node.id] ?? [];
      const made: ElementId[] = [];
      const ctx: NodeContext = {
        doc,
        tx,
        selection: opts.selection ?? [],
        bind(index, create, o = {}) {
          const fresh = create();
          const prev = old[index] ? doc.get(old[index]!) : undefined;
          if (prev && prev.category === fresh.category && !made.includes(prev.id)) {
            // Keep the old element's id: it takes the new one's params, type and name.
            const patch: Params = { ...fresh.params };
            for (const k of o.keep ?? []) patch[k] = prev.params[k]!;
            tx.update(prev.id, patch);
            if (fresh.typeId && fresh.typeId !== prev.typeId) tx.setType(prev.id, fresh.typeId);
            if (!o.keepName && fresh.name !== prev.name) tx.setName(prev.id, fresh.name);
            tx.delete(fresh.id);
            made[index] = prev.id;
            return doc.require(prev.id);
          }
          made[index] = fresh.id;
          return fresh;
        },
      };
      try {
        const outputs = runLaced(def, inputs, ctx, node);
        cache.set(node.id, { key, outputs });
        results.set(node.id, { outputs, ran: true });
        // Elements made last time but not this time go.
        for (const id of old) if (!made.includes(id) && doc.has(id)) tx.delete(id);
        bindings[node.id] = made.filter(Boolean);
      } catch (e) {
        results.set(node.id, { outputs: {}, error: (e as Error).message, ran: true });
        bindings[node.id] = old.filter((id) => doc.has(id));
      }
    }
    // Nodes deleted from the graph take their elements with them.
    for (const [nodeId, ids] of Object.entries(g.bindings ?? {})) {
      if (g.nodes.some((n) => n.id === nodeId)) continue;
      for (const id of ids) if (doc.has(id)) tx.delete(id);
    }
    const kept = Object.fromEntries(Object.entries(bindings).filter(([, ids]) => ids.length));
    if (keyOf(kept) !== keyOf(g.bindings ?? {})) tx.update<GraphParams>(graphId, { bindings: kept });
  });
  return results;
}

// ---- editing --------------------------------------------------------------------------------

export function createGraph(tx: Transaction, name: string): Graph {
  return tx.create<GraphParams>(Cat.Graph, { nodes: [], links: [], bindings: {}, automatic: false }, { name }) as Graph;
}

let seq = 0;
/** A new node id, unique within a graph. */
export function newNodeId(g: GraphParams): string {
  let id: string;
  do id = `n${Date.now().toString(36)}${(seq++).toString(36)}`;
  while (g.nodes.some((n) => n.id === id));
  return id;
}

/** Add a link (replacing any link into the same input); refuses loops and unknown ports. */
export function linkNodes(g: GraphParams, from: { node: string; port: string }, to: { node: string; port: string }): GraphParams {
  const a = g.nodes.find((n) => n.id === from.node);
  const b = g.nodes.find((n) => n.id === to.node);
  if (!a || !b) throw new Error("Link a node to another node");
  if (!defs.get(a.type)?.outputs.some((p) => p.name === from.port)) throw new Error(`No output ${from.port}`);
  if (!defs.get(b.type)?.inputs.some((p) => p.name === to.port)) throw new Error(`No input ${to.port}`);
  const next = { ...g, links: [...g.links.filter((l) => !(l.to.node === to.node && l.to.port === to.port)), { from, to }] };
  graphOrder(next);
  return next;
}

/** Remove nodes and their links (their bound elements stay until the graph runs). */
export function removeNodes(g: GraphParams, ids: string[]): GraphParams {
  const gone = new Set(ids);
  return { ...g, nodes: g.nodes.filter((n) => !gone.has(n.id)), links: g.links.filter((l) => !gone.has(l.from.node) && !gone.has(l.to.node)) };
}

export function graphs(doc: Document): Graph[] {
  return doc.byCategory<GraphParams>(Cat.Graph) as Graph[];
}
