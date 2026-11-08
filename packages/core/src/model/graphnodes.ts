import type { Document } from "../document.ts";
import type { Element, ElementId, ParamValue, Vec2 } from "../element.ts";
import { evaluate } from "../expr.ts";
import { Cat, createFloor, createWall, levels, type LevelParams } from "./architecture.ts";
import { placeFamilyInstance } from "./components.ts";
import { registerNode, type NodeDef, type PortDef } from "./graphs.ts";
import { createGrid } from "./grids.ts";
import { createRoom } from "./rooms.ts";
import { createColumn } from "./structure.ts";

// The node library: inputs, maths, lists, geometry (plan points, lines, polygons in mm),
// selection (levels, types, elements, parameters) and element creation. Elements travel between
// nodes as their ids.

type Line = { start: Vec2; end: Vec2 };

const num = (name: string, def?: number): PortDef => ({ name, type: "number", ...(def !== undefined ? { default: def } : {}) });
const pt = (name: string): PortDef => ({ name, type: "point" });
const out = (name: string, type: PortDef["type"]): PortDef => ({ name, type });

const asNum = (v: unknown, what = "a number"): number => {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new Error(`Expected ${what}`);
  return n;
};
const asPoint = (v: unknown): Vec2 => {
  const p = v as Vec2;
  if (!p || typeof p.x !== "number" || typeof p.y !== "number") throw new Error("Expected a point");
  return p;
};
const asLine = (v: unknown): Line => {
  const l = v as Line;
  if (!l?.start || !l?.end) throw new Error("Expected a line");
  return { start: asPoint(l.start), end: asPoint(l.end) };
};
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : [v]);
const asElement = (doc: Document, v: unknown): Element => {
  if (typeof v !== "string" || !doc.has(v)) throw new Error("Expected an element");
  return doc.require(v);
};

function def(d: NodeDef): void {
  registerNode(d);
}

// ---- Input ----
def({ type: "number", label: "Number", category: "Input", inputs: [], outputs: [out("value", "number")], settings: [{ name: "value", type: "number" }], run: (_i, _c, n) => ({ value: asNum(n.values?.value ?? 0) }) });
def({
  type: "slider",
  label: "Number Slider",
  category: "Input",
  inputs: [],
  outputs: [out("value", "number")],
  settings: [
    { name: "value", type: "number" },
    { name: "min", type: "number" },
    { name: "max", type: "number" },
    { name: "step", type: "number" },
  ],
  run: (_i, _c, n) => {
    const v = n.values ?? {};
    const min = asNum(v.min ?? 0);
    const max = asNum(v.max ?? 10000);
    const step = asNum(v.step ?? 100) || 1;
    const x = Math.min(max, Math.max(min, asNum(v.value ?? min)));
    return { value: min + Math.round((x - min) / step) * step };
  },
});
def({ type: "string", label: "String", category: "Input", inputs: [], outputs: [out("value", "string")], settings: [{ name: "value", type: "string" }], run: (_i, _c, n) => ({ value: String(n.values?.value ?? "") }) });
def({ type: "boolean", label: "Boolean", category: "Input", inputs: [], outputs: [out("value", "boolean")], settings: [{ name: "value", type: "boolean" }], run: (_i, _c, n) => ({ value: !!n.values?.value }) });
def({
  type: "range",
  label: "Range",
  category: "Input",
  inputs: [num("start", 0), num("end", 10), num("step", 1)],
  outputs: [out("list", "number")],
  run: ({ start, end, step }) => {
    const a = asNum(start);
    const b = asNum(end);
    const s = Math.abs(asNum(step)) || 1;
    const outList: number[] = [];
    for (let x = a; a <= b ? x <= b + 1e-9 : x >= b - 1e-9; x += a <= b ? s : -s) {
      outList.push(Math.round(x * 1e9) / 1e9);
      if (outList.length > 10000) throw new Error("Range is too long (over 10 000)");
    }
    return { list: outList };
  },
});
def({
  type: "sequence",
  label: "Sequence",
  category: "Input",
  inputs: [num("start", 0), num("count", 5), num("step", 1)],
  outputs: [out("list", "number")],
  run: ({ start, count, step }) => {
    const n = Math.floor(asNum(count));
    if (n < 0 || n > 10000) throw new Error("Count must be 0 to 10 000");
    return { list: Array.from({ length: n }, (_, i) => asNum(start) + i * asNum(step)) };
  },
});

// ---- Maths ----
const binary = (type: string, label: string, f: (a: number, b: number) => number) =>
  def({ type, label, category: "Maths", inputs: [num("a", 0), num("b", 0)], outputs: [out("result", "number")], run: ({ a, b }) => ({ result: f(asNum(a), asNum(b)) }) });
binary("add", "Add (+)", (a, b) => a + b);
binary("subtract", "Subtract (−)", (a, b) => a - b);
binary("multiply", "Multiply (×)", (a, b) => a * b);
binary("divide", "Divide (÷)", (a, b) => {
  if (b === 0) throw new Error("Divide by zero");
  return a / b;
});
binary("power", "Power", (a, b) => a ** b);
const unary = (type: string, label: string, f: (a: number) => number) =>
  def({ type, label, category: "Maths", inputs: [num("a", 0)], outputs: [out("result", "number")], run: ({ a }) => ({ result: f(asNum(a)) }) });
unary("round", "Round", Math.round);
unary("sqrt", "Square Root", Math.sqrt);
unary("sin", "Sin (degrees)", (d) => Math.sin((d * Math.PI) / 180));
unary("cos", "Cos (degrees)", (d) => Math.cos((d * Math.PI) / 180));
def({
  type: "formula",
  label: "Formula",
  category: "Maths",
  inputs: [num("a", 0), num("b", 0), num("c", 0), num("d", 0)],
  outputs: [out("result", "number")],
  settings: [{ name: "formula", type: "string" }],
  run: (i, _c, n) => ({ result: evaluate(String(n.values?.formula ?? "a"), { a: asNum(i.a), b: asNum(i.b), c: asNum(i.c), d: asNum(i.d) }) }),
});

// ---- Lists ----
def({
  type: "listCreate",
  label: "List Create",
  category: "Lists",
  inputs: ["item0", "item1", "item2", "item3"].map((name) => ({ name, type: "any" as const, list: true, default: null })),
  outputs: [out("list", "any")],
  run: (i) => ({ list: [i.item0, i.item1, i.item2, i.item3].filter((x) => x !== null && x !== undefined) }),
});
def({ type: "count", label: "Count", category: "Lists", inputs: [{ name: "list", type: "any", list: true }], outputs: [out("count", "number")], run: ({ list }) => ({ count: asList(list).length }) });
def({
  type: "getItem",
  label: "Get Item at Index",
  category: "Lists",
  inputs: [{ name: "list", type: "any", list: true }, num("index", 0)],
  outputs: [out("item", "any")],
  run: ({ list, index }) => {
    const l = asList(list);
    const i = Math.floor(asNum(index));
    const k = i < 0 ? l.length + i : i;
    if (k < 0 || k >= l.length) throw new Error(`No item ${i} (the list has ${l.length})`);
    return { item: l[k] };
  },
});
def({ type: "first", label: "First Item", category: "Lists", inputs: [{ name: "list", type: "any", list: true }], outputs: [out("item", "any")], run: ({ list }) => ({ item: asList(list)[0] ?? null }) });
def({ type: "last", label: "Last Item", category: "Lists", inputs: [{ name: "list", type: "any", list: true }], outputs: [out("item", "any")], run: ({ list }) => ({ item: asList(list).at(-1) ?? null }) });
def({ type: "reverse", label: "Reverse", category: "Lists", inputs: [{ name: "list", type: "any", list: true }], outputs: [out("list", "any")], run: ({ list }) => ({ list: [...asList(list)].reverse() }) });
def({ type: "flatten", label: "Flatten", category: "Lists", inputs: [{ name: "list", type: "any", list: true }], outputs: [out("list", "any")], run: ({ list }) => ({ list: asList(list).flat(Infinity) }) });
def({ type: "sum", label: "Sum", category: "Lists", inputs: [{ name: "list", type: "number", list: true }], outputs: [out("sum", "number")], run: ({ list }) => ({ sum: asList(list).reduce<number>((s, x) => s + asNum(x), 0) }) });

// ---- Geometry (plan, mm) ----
def({ type: "point", label: "Point by Coordinates", category: "Geometry", inputs: [num("x", 0), num("y", 0)], outputs: [out("point", "point")], run: ({ x, y }) => ({ point: { x: asNum(x), y: asNum(y) } }) });
def({
  type: "pointAdd",
  label: "Point Translate",
  category: "Geometry",
  inputs: [pt("point"), num("dx", 0), num("dy", 0)],
  outputs: [out("point", "point")],
  run: ({ point, dx, dy }) => {
    const p = asPoint(point);
    return { point: { x: p.x + asNum(dx), y: p.y + asNum(dy) } };
  },
});
def({ type: "pointXY", label: "Point X / Y", category: "Geometry", inputs: [pt("point")], outputs: [out("x", "number"), out("y", "number")], run: ({ point }) => ({ x: asPoint(point).x, y: asPoint(point).y }) });
def({ type: "line", label: "Line by Start and End", category: "Geometry", inputs: [pt("start"), pt("end")], outputs: [out("line", "line")], run: ({ start, end }) => ({ line: { start: asPoint(start), end: asPoint(end) } }) });
def({
  type: "lineLength",
  label: "Line Length",
  category: "Geometry",
  inputs: [{ name: "line", type: "line" }],
  outputs: [out("length", "number")],
  run: ({ line }) => {
    const l = asLine(line);
    return { length: Math.hypot(l.end.x - l.start.x, l.end.y - l.start.y) };
  },
});
def({
  type: "pointsOnLine",
  label: "Points along Line",
  category: "Geometry",
  inputs: [{ name: "line", type: "line" }, num("count", 5)],
  outputs: [out("points", "point")],
  run: ({ line, count }) => {
    const l = asLine(line);
    const n = Math.floor(asNum(count));
    if (n < 2 || n > 10000) throw new Error("Count must be 2 to 10 000");
    return { points: Array.from({ length: n }, (_, i) => ({ x: l.start.x + ((l.end.x - l.start.x) * i) / (n - 1), y: l.start.y + ((l.end.y - l.start.y) * i) / (n - 1) })) };
  },
});
def({
  type: "offsetLine",
  label: "Offset Line",
  category: "Geometry",
  inputs: [{ name: "line", type: "line" }, num("distance", 1000)],
  outputs: [out("line", "line")],
  run: ({ line, distance }) => {
    const l = asLine(line);
    const len = Math.hypot(l.end.x - l.start.x, l.end.y - l.start.y) || 1;
    const d = asNum(distance);
    const n = { x: (-(l.end.y - l.start.y) / len) * d, y: ((l.end.x - l.start.x) / len) * d };
    return { line: { start: { x: l.start.x + n.x, y: l.start.y + n.y }, end: { x: l.end.x + n.x, y: l.end.y + n.y } } };
  },
});
def({
  type: "rectangle",
  label: "Rectangle",
  category: "Geometry",
  inputs: [pt("centre"), num("width", 4000), num("depth", 3000)],
  outputs: [out("polygon", "polygon")],
  run: ({ centre, width, depth }) => {
    const c = asPoint(centre);
    const w = asNum(width) / 2;
    const h = asNum(depth) / 2;
    return {
      polygon: [
        { x: c.x - w, y: c.y - h },
        { x: c.x + w, y: c.y - h },
        { x: c.x + w, y: c.y + h },
        { x: c.x - w, y: c.y + h },
      ],
    };
  },
});
def({
  type: "polygonCircle",
  label: "Regular Polygon",
  category: "Geometry",
  inputs: [pt("centre"), num("radius", 3000), num("sides", 6)],
  outputs: [out("polygon", "polygon")],
  run: ({ centre, radius, sides }) => {
    const c = asPoint(centre);
    const n = Math.floor(asNum(sides));
    if (n < 3 || n > 360) throw new Error("Sides must be 3 to 360");
    const r = asNum(radius);
    return { polygon: Array.from({ length: n }, (_, i) => ({ x: c.x + r * Math.cos((2 * Math.PI * i) / n), y: c.y + r * Math.sin((2 * Math.PI * i) / n) })) };
  },
});
def({
  type: "polygonLines",
  label: "Polygon Edges",
  category: "Geometry",
  inputs: [{ name: "polygon", type: "polygon", list: true }],
  outputs: [out("lines", "line"), out("points", "point")],
  run: ({ polygon }) => {
    const p = asList(polygon).map(asPoint);
    return { lines: p.map((a, i) => ({ start: a, end: p[(i + 1) % p.length]! })), points: p };
  },
});
def({
  type: "pointGrid",
  label: "Grid of Points",
  category: "Geometry",
  inputs: [pt("origin"), num("countX", 3), num("countY", 3), num("spacingX", 3000), num("spacingY", 3000)],
  outputs: [out("points", "point")],
  run: ({ origin, countX, countY, spacingX, spacingY }) => {
    const o = asPoint(origin);
    const nx = Math.floor(asNum(countX));
    const ny = Math.floor(asNum(countY));
    if (nx * ny > 10000) throw new Error("Too many points (over 10 000)");
    const pts: Vec2[] = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pts.push({ x: o.x + i * asNum(spacingX), y: o.y + j * asNum(spacingY) });
    return { points: pts };
  },
});

// ---- Selection ----
const CATEGORIES = [Cat.Wall, Cat.Floor, Cat.Roof, Cat.Ceiling, Cat.Door, Cat.Window, Cat.Room, Cat.Grid, Cat.Level, Cat.Column, Cat.Beam, Cat.FamilyInstance];
const TYPE_CATEGORIES = [Cat.WallType, Cat.FloorType, Cat.RoofType, Cat.CeilingType, Cat.DoorType, Cat.WindowType, Cat.StructuralType];
def({
  type: "levels",
  label: "Levels",
  category: "Selection",
  volatile: true,
  inputs: [],
  outputs: [out("levels", "element"), out("elevations", "number")],
  run: (_i, { doc }) => {
    const ls = levels(doc);
    return { levels: ls.map((l) => l.id), elevations: ls.map((l) => l.params.elevation) };
  },
});
def({
  type: "levelByName",
  label: "Level by Name",
  category: "Selection",
  volatile: true,
  inputs: [{ name: "name", type: "string", default: "" }],
  outputs: [out("level", "element")],
  run: ({ name }, { doc }) => {
    const l = levels(doc).find((x) => x.name === name);
    if (!l) throw new Error(`No level called "${String(name)}"`);
    return { level: l.id };
  },
});
def({
  type: "types",
  label: "Types",
  category: "Selection",
  volatile: true,
  inputs: [],
  outputs: [out("types", "element"), out("names", "string")],
  settings: [{ name: "category", type: "select", options: TYPE_CATEGORIES }],
  run: (_i, { doc }, n) => {
    const ts = doc.byCategory(String(n.values?.category ?? Cat.WallType));
    return { types: ts.map((t) => t.id), names: ts.map((t) => t.name ?? "") };
  },
});
def({
  type: "elementsOfCategory",
  label: "All Elements of Category",
  category: "Selection",
  volatile: true,
  inputs: [],
  outputs: [out("elements", "element")],
  settings: [{ name: "category", type: "select", options: CATEGORIES }],
  run: (_i, { doc }, n) => ({ elements: doc.byCategory(String(n.values?.category ?? Cat.Wall)).map((e) => e.id) }),
});
def({ type: "selection", label: "Select Model Elements", category: "Selection", volatile: true, inputs: [], outputs: [out("elements", "element")], run: (_i, { selection }) => ({ elements: [...selection] }) });
def({
  type: "getParameter",
  label: "Get Parameter",
  category: "Selection",
  volatile: true,
  inputs: [{ name: "element", type: "element" }, { name: "name", type: "string", default: "name" }],
  outputs: [out("value", "any")],
  run: ({ element, name }, { doc }) => {
    const el = asElement(doc, element);
    const key = String(name);
    if (key === "name") return { value: el.name ?? "" };
    if (key === "category") return { value: el.category };
    if (key === "type") return { value: el.typeId ?? null };
    if (!(key in (el.params as object))) throw new Error(`${el.category} has no parameter ${key}`);
    return { value: (el.params as Record<string, unknown>)[key] ?? null };
  },
});
def({
  type: "setParameter",
  label: "Set Parameter",
  category: "Selection",
  effect: true,
  inputs: [{ name: "element", type: "element" }, { name: "name", type: "string", default: "name" }, { name: "value", type: "any" }],
  outputs: [out("element", "element")],
  run: ({ element, name, value }, { doc, tx }) => {
    const el = asElement(doc, element);
    const key = String(name);
    if (key === "name") tx.setName(el.id, value === null || value === "" ? undefined : String(value));
    else {
      if (!(key in (el.params as object))) throw new Error(`${el.category} has no parameter ${key}`);
      const cur = (el.params as Record<string, unknown>)[key];
      tx.update(el.id, { [key]: (typeof cur === "number" ? asNum(value) : value) as ParamValue });
    }
    return { element: el.id };
  },
});
def({
  type: "location",
  label: "Element Location",
  category: "Selection",
  volatile: true,
  inputs: [{ name: "element", type: "element" }],
  outputs: [out("point", "point"), out("line", "line")],
  run: ({ element }, { doc }) => {
    const p = asElement(doc, element).params as { start?: Vec2; end?: Vec2; point?: Vec2; position?: Vec2 };
    if (p.start && p.end) return { line: { start: p.start, end: p.end }, point: { x: (p.start.x + p.end.x) / 2, y: (p.start.y + p.end.y) / 2 } };
    const q = p.point ?? p.position;
    if (!q) throw new Error("That element has no location point or line");
    return { point: q, line: null };
  },
});

// ---- Elements (made by the graph, updated on each run) ----
const levelOr = (doc: Document, v: unknown): ElementId => {
  if (v !== null && v !== undefined && v !== "") {
    const l = asElement(doc, v);
    if (l.category !== Cat.Level) throw new Error("Expected a level");
    return l.id;
  }
  const first = levels(doc)[0];
  if (!first) throw new Error("The project has no levels");
  return first.id;
};
const typeOr = (doc: Document, v: unknown, cat: string): ElementId => {
  if (v !== null && v !== undefined && v !== "") {
    const t = asElement(doc, v);
    if (t.category !== cat) throw new Error(`Expected a ${cat}`);
    return t.id;
  }
  const first = doc.byCategory(cat)[0];
  if (!first) throw new Error(`The project has no ${cat}s`);
  return first.id;
};
def({
  type: "wallByLine",
  label: "Wall by Line",
  category: "Elements",
  effect: true,
  inputs: [{ name: "line", type: "line" }, { name: "level", type: "element", default: null }, { name: "type", type: "element", default: null }, num("height", 2400)],
  outputs: [out("wall", "element")],
  run: ({ line, level, type, height }, ctx) => {
    const l = asLine(line);
    const w = ctx.bind(0, () => createWall(ctx.tx, typeOr(ctx.doc, type, Cat.WallType), l.start, l.end, levelOr(ctx.doc, level), { height: asNum(height), topLevelId: null }));
    return { wall: w.id };
  },
});
def({
  type: "floorByOutline",
  label: "Floor by Outline",
  category: "Elements",
  effect: true,
  inputs: [{ name: "polygon", type: "polygon", list: true }, { name: "level", type: "element", default: null }, { name: "type", type: "element", default: null }],
  outputs: [out("floor", "element")],
  run: ({ polygon, level, type }, ctx) => {
    const p = asList(polygon).map(asPoint);
    const f = ctx.bind(0, () => createFloor(ctx.tx, typeOr(ctx.doc, type, Cat.FloorType), levelOr(ctx.doc, level), p));
    return { floor: f.id };
  },
});
def({
  type: "gridByLine",
  label: "Grid by Line",
  category: "Elements",
  effect: true,
  inputs: [{ name: "line", type: "line" }, { name: "name", type: "string", default: "" }],
  outputs: [out("grid", "element")],
  run: ({ line, name }, ctx) => {
    const l = asLine(line);
    const g = ctx.bind(0, () => createGrid(ctx.tx, ctx.doc, l.start, l.end, name ? String(name) : undefined), { keepName: !name });
    return { grid: g.id };
  },
});
def({
  type: "roomByPoint",
  label: "Room by Point",
  category: "Elements",
  effect: true,
  inputs: [pt("point"), { name: "level", type: "element", default: null }, { name: "name", type: "string", default: "Room" }],
  outputs: [out("room", "element")],
  run: ({ point, level, name }, ctx) => {
    const r = ctx.bind(0, () => createRoom(ctx.tx, ctx.doc, levelOr(ctx.doc, level), asPoint(point), { name: String(name) }), { keep: ["number"] });
    return { room: r.id };
  },
});
def({
  type: "columnByPoint",
  label: "Column by Point",
  category: "Elements",
  effect: true,
  inputs: [pt("point"), { name: "base", type: "element", default: null }, { name: "top", type: "element", default: null }, { name: "type", type: "element", default: null }],
  outputs: [out("column", "element")],
  run: ({ point, base, top, type }, ctx) => {
    const b = levelOr(ctx.doc, base);
    let t: ElementId;
    if (top) t = levelOr(ctx.doc, top);
    else {
      // Default top: the next level up.
      const ls = levels(ctx.doc);
      const above = ls.find((l) => l.params.elevation > ctx.doc.require<LevelParams>(b).params.elevation);
      if (!above) throw new Error("Give the column a top level");
      t = above.id;
    }
    const c = ctx.bind(0, () => createColumn(ctx.tx, ctx.doc, typeOr(ctx.doc, type, Cat.StructuralType), b, t, asPoint(point)));
    return { column: c.id };
  },
});
def({
  type: "familyByPoint",
  label: "Family Instance by Point",
  category: "Elements",
  effect: true,
  inputs: [{ name: "family", type: "element" }, { name: "typeName", type: "string", default: "" }, pt("point"), { name: "level", type: "element", default: null }, num("rotation", 0)],
  outputs: [out("instance", "element")],
  run: ({ family, typeName, point, level, rotation }, ctx) => {
    const f = asElement(ctx.doc, family);
    const i = ctx.bind(0, () => placeFamilyInstance(ctx.tx, ctx.doc, f.id, String(typeName), { levelId: levelOr(ctx.doc, level), position: asPoint(point), rotation: (asNum(rotation) * Math.PI) / 180 }));
    return { instance: i.id };
  },
});

// ---- Display ----
def({ type: "watch", label: "Watch", category: "Display", inputs: [{ name: "value", type: "any", list: true }], outputs: [out("value", "any")], run: ({ value }) => ({ value }) });
