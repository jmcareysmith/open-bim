import { describe, expect, it } from "vitest";
import {
  Cat,
  Document,
  applyResidentialTemplate,
  createGraph,
  linkNodes,
  nodeDefs,
  removeNodes,
  runGraph,
  type GraphNode,
  type GraphParams,
  type ParamValue,
} from "../src/index.ts";

function setup() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const g = doc.transact("Graph", (tx) => createGraph(tx, "Test"));
  let params: GraphParams = { nodes: [], links: [] };
  const node = (id: string, type: string, values: Record<string, ParamValue> = {}): GraphNode => {
    const n = { id, type, x: 0, y: 0, values };
    params = { ...params, nodes: [...params.nodes, n] };
    return n;
  };
  const link = (from: string, fp: string, to: string, tp: string) => {
    params = linkNodes(params, { node: from, port: fp }, { node: to, port: tp });
  };
  const save = () => doc.transact("Edit graph", (tx) => tx.update<GraphParams>(g.id, { nodes: params.nodes, links: params.links }));
  const setValues = (id: string, values: Record<string, ParamValue>) => {
    params = { ...params, nodes: params.nodes.map((n) => (n.id === id ? { ...n, values: { ...n.values, ...values } } : n)) };
  };
  return { doc, ids, g, node, link, save, setValues, get: () => params, set: (p: GraphParams) => (params = p) };
}

describe("visual programming", () => {
  it("has a node library across the groups", () => {
    const cats = new Set(nodeDefs().map((d) => d.category));
    for (const c of ["Input", "Maths", "Lists", "Geometry", "Selection", "Elements", "Display"]) expect(cats.has(c)).toBe(true);
  });

  it("evaluates in order and re-runs only what changed", () => {
    const t = setup();
    t.node("a", "number", { value: 2 });
    t.node("b", "slider", { value: 3, min: 0, max: 10, step: 1 });
    t.node("sum", "add");
    t.node("f", "formula", { formula: "a * 10 + b" });
    t.link("a", "value", "sum", "a");
    t.link("b", "value", "sum", "b");
    t.link("sum", "result", "f", "a");
    t.link("b", "value", "f", "b");
    t.save();
    let r = runGraph(t.doc, t.g.id);
    expect(r.get("sum")!.outputs.result).toBe(5);
    expect(r.get("f")!.outputs.result).toBe(53);
    // Unchanged: nothing re-runs.
    r = runGraph(t.doc, t.g.id);
    expect(r.get("sum")!.ran).toBe(false);
    expect(r.get("f")!.outputs.result).toBe(53);
    // Change a: sum and formula re-run.
    t.setValues("a", { value: 4 });
    t.save();
    r = runGraph(t.doc, t.g.id);
    expect(r.get("sum")!.ran).toBe(true);
    expect(r.get("f")!.outputs.result).toBe(73);
  });

  it("laces lists through single-value inputs", () => {
    const t = setup();
    t.node("xs", "range", {});
    t.setValues("xs", { start: 0, end: 3000, step: 1000 });
    t.node("p", "point");
    t.link("xs", "list", "p", "x");
    t.node("n", "count");
    t.link("p", "point", "n", "list");
    t.save();
    const r = runGraph(t.doc, t.g.id);
    expect(r.get("xs")!.outputs.list).toEqual([0, 1000, 2000, 3000]);
    expect((r.get("p")!.outputs.point as unknown[]).length).toBe(4);
    expect(r.get("n")!.outputs.count).toBe(4);
  });

  it("binds the elements it makes: re-runs update them, fewer means surplus go", () => {
    const t = setup();
    // Walls along y = 0, 2000, 4000 (count from a slider), each 5000 long.
    t.node("count", "slider", { value: 3, min: 1, max: 10, step: 1 });
    t.node("ys", "sequence", { step: 2000 });
    t.setValues("ys", { start: 0, step: 2000 });
    t.link("count", "value", "ys", "count");
    t.node("a", "point");
    t.node("b", "point", {});
    t.setValues("b", { x: 5000 });
    t.link("ys", "list", "a", "y");
    t.link("ys", "list", "b", "y");
    t.node("l", "line");
    t.link("a", "point", "l", "start");
    t.link("b", "point", "l", "end");
    t.node("w", "wallByLine");
    t.link("l", "line", "w", "line");
    t.save();
    let r = runGraph(t.doc, t.g.id);
    expect(r.get("w")!.error).toBeUndefined();
    const walls = () => t.doc.byCategory(Cat.Wall);
    expect(walls()).toHaveLength(3);
    const first = r.get("w")!.outputs.wall as string[];
    // Run again: still three, same ids.
    r = runGraph(t.doc, t.g.id);
    expect(walls()).toHaveLength(3);
    expect(r.get("w")!.outputs.wall).toEqual(first);
    // Two now: the first two keep their ids, the third goes.
    t.setValues("count", { value: 2 });
    t.setValues("b", { x: 6000 });
    t.save();
    r = runGraph(t.doc, t.g.id);
    expect(walls()).toHaveLength(2);
    expect(r.get("w")!.outputs.wall).toEqual(first.slice(0, 2));
    expect((t.doc.require(first[0]!).params as { end: { x: number } }).end.x).toBe(6000);
    // One undo takes the whole run back.
    t.doc.undo();
    expect(walls()).toHaveLength(3);
    // Deleting the node deletes its walls on the next run.
    t.set(removeNodes(t.get(), ["w"]));
    t.save();
    runGraph(t.doc, t.g.id);
    expect(walls()).toHaveLength(0);
  });

  it("reports errors, passes them downstream, and refuses loops", () => {
    const t = setup();
    t.node("d", "divide", { a: 1, b: 0 });
    t.node("m", "multiply", { b: 2 });
    t.link("d", "result", "m", "a");
    t.save();
    const r = runGraph(t.doc, t.g.id);
    expect(r.get("d")!.error).toMatch(/Divide by zero/);
    expect(r.get("m")!.error).toMatch(/input node/);
    expect(() => t.link("m", "result", "d", "a")).toThrow(/loop/);
  });

  it("reads and sets parameters of selected elements", () => {
    const t = setup();
    t.node("sel", "selection");
    t.node("s", "string", { value: "Renamed" });
    t.node("set", "setParameter", { name: "name" });
    t.link("sel", "elements", "set", "element");
    t.link("s", "value", "set", "value");
    t.save();
    const lv = t.doc.byCategory(Cat.Level)[0]!;
    runGraph(t.doc, t.g.id, { selection: [lv.id] });
    expect(t.doc.require(lv.id).name).toBe("Renamed");
  });
});

describe("custom nodes", () => {
  it("uses a graph as a node: its Inputs and Outputs are the ports, its elements stay bound", () => {
    const doc = new Document();
    applyResidentialTemplate(doc);
    // Custom node: Wall at X — a 3 m wall along y at the given x; outputs the wall and x doubled.
    const def = doc.transact("Def", (tx) => createGraph(tx, "Wall at X"));
    let d: GraphParams = {
      nodes: [
        { id: "i", type: "graphInput", x: 0, y: 0, values: { name: "x" } },
        { id: "y", type: "number", x: 0, y: 0, values: { value: 3000 } },
        { id: "a", type: "point", x: 0, y: 0 },
        { id: "b", type: "point", x: 0, y: 0 },
        { id: "l", type: "line", x: 0, y: 0 },
        { id: "w", type: "wallByLine", x: 0, y: 0 },
        { id: "two", type: "formula", x: 0, y: 0, values: { formula: "a * 2" } },
        { id: "o1", type: "graphOutput", x: 0, y: 0, values: { name: "wall" } },
        { id: "o2", type: "graphOutput", x: 0, y: 0, values: { name: "double" } },
      ],
      links: [],
      custom: true,
    };
    const ln = (f: string, fp: string, t: string, tp: string) => (d = linkNodes(d, { node: f, port: fp }, { node: t, port: tp }, doc));
    ln("i", "value", "a", "x");
    ln("i", "value", "b", "x");
    ln("y", "value", "b", "y");
    ln("a", "point", "l", "start");
    ln("b", "point", "l", "end");
    ln("l", "line", "w", "line");
    ln("w", "wall", "o1", "value");
    ln("i", "value", "two", "a");
    ln("two", "result", "o2", "value");
    doc.transact("Save", (tx) => tx.update<GraphParams>(def.id, d));
    expect(nodeDefs(doc).some((n) => n.type === `custom:${def.id}` && n.category === "Custom")).toBe(true);

    // Use it with a list of x: two walls.
    const use = doc.transact("Use", (tx) => createGraph(tx, "Use"));
    let u: GraphParams = {
      nodes: [
        { id: "xs", type: "range", x: 0, y: 0, values: { start: 10000, end: 12000, step: 2000 } },
        { id: "c", type: `custom:${def.id}`, x: 0, y: 0 },
      ],
      links: [],
    };
    u = linkNodes(u, { node: "xs", port: "list" }, { node: "c", port: "x" }, doc);
    doc.transact("Save", (tx) => tx.update<GraphParams>(use.id, u));
    const walls = () => doc.byCategory(Cat.Wall).filter((w) => (w.params as { start: { x: number } }).start.x >= 10000);
    let r = runGraph(doc, use.id);
    expect(r.get("c")!.error).toBeUndefined();
    expect(r.get("c")!.outputs.double).toEqual([20000, 24000]);
    expect(walls()).toHaveLength(2);
    const ids = walls().map((w) => w.id).sort();
    // Running again updates the same walls, not more.
    r = runGraph(doc, use.id, { full: true });
    expect(walls().map((w) => w.id).sort()).toEqual(ids);
  });
});

describe("script node", () => {
  it("runs JavaScript over its inputs and reports errors on the node", () => {
    const t = setup();
    t.node("a", "number", { value: 21 });
    t.node("s", "script", { code: "return IN[0] * 2 + doc.byCategory('Level').length * 0;" });
    t.link("a", "value", "s", "IN0");
    t.node("bad", "script", { code: "return (" });
    t.save();
    const r = runGraph(t.doc, t.g.id);
    expect(r.get("s")!.outputs.OUT).toBe(42);
    expect(r.get("bad")!.error).toMatch(/^Script:/);
  });
});
