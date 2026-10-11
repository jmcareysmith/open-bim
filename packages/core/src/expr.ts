// Formula language for family parameters and dimensions (Revit-style): arithmetic, comparisons,
// and/or/not, if(), min/max/abs/sqrt/round, degree-based trig. Parameter names may contain spaces;
// they're matched against the known names, longest first. No `eval`.

export type Values = Record<string, number>;

type Token =
  | { t: "num"; v: number }
  | { t: "name"; v: string }
  | { t: "op"; v: string }
  | { t: "lp" }
  | { t: "rp" }
  | { t: "comma" };

const FUNCS = new Set(["if", "min", "max", "abs", "sqrt", "round", "roundup", "rounddown", "sin", "cos", "tan", "pi", "not"]);
const WORD_OPS = new Set(["and", "or", "not"]);

export class FormulaError extends Error {}

function tokenize(src: string, names: string[]): Token[] {
  const sorted = [...names].sort((a, b) => b.length - a.length);
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const name = sorted.find((n) => src.startsWith(n, i) && !/[A-Za-z0-9_]/.test(src[i + n.length] ?? ""));
    if (name) {
      out.push({ t: "name", v: name });
      i += name.length;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) {
      out.push({ t: "num", v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (word) {
      const w = word[0].toLowerCase();
      if (WORD_OPS.has(w) && w !== "not") out.push({ t: "op", v: w });
      else if (FUNCS.has(w)) out.push({ t: "name", v: `#${w}` });
      else throw new FormulaError(`Unknown name "${word[0]}"`);
      i += word[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["<=", ">=", "<>", "=="].includes(two)) {
      out.push({ t: "op", v: two === "==" ? "=" : two });
      i += 2;
      continue;
    }
    if ("+-*/^<>=".includes(c)) out.push({ t: "op", v: c });
    else if (c === "(") out.push({ t: "lp" });
    else if (c === ")") out.push({ t: "rp" });
    else if (c === ",") out.push({ t: "comma" });
    else throw new FormulaError(`Unexpected "${c}"`);
    i++;
  }
  return out;
}

type Node =
  | { k: "num"; v: number }
  | { k: "ref"; name: string }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[] };

function parse(tokens: Token[]): Node {
  let p = 0;
  const peek = () => tokens[p];
  const isOp = (...ops: string[]) => {
    const t = peek();
    return t?.t === "op" && ops.includes(t.v);
  };
  const expect = (t: Token["t"]) => {
    if (peek()?.t !== t) throw new FormulaError(t === "rp" ? "Missing )" : "Syntax error");
    p++;
  };
  const binary = (next: () => Node, ...ops: string[]) => () => {
    let a = next();
    while (isOp(...ops)) {
      const op = (tokens[p++] as { v: string }).v;
      a = { k: "bin", op, a, b: next() };
    }
    return a;
  };
  const atom = (): Node => {
    const t = tokens[p++];
    if (!t) throw new FormulaError("Formula ends too soon");
    if (t.t === "num") return { k: "num", v: t.v };
    if (t.t === "lp") {
      const e = or();
      expect("rp");
      return e;
    }
    if (t.t === "name" && t.v.startsWith("#")) {
      const fn = t.v.slice(1);
      expect("lp");
      const args: Node[] = [];
      if (peek()?.t !== "rp") {
        args.push(or());
        while (peek()?.t === "comma") {
          p++;
          args.push(or());
        }
      }
      expect("rp");
      return { k: "call", fn, args };
    }
    if (t.t === "name") return { k: "ref", name: t.v };
    throw new FormulaError("Syntax error");
  };
  const unary = (): Node => {
    if (isOp("-")) {
      p++;
      return { k: "un", op: "-", a: unary() };
    }
    if (isOp("+")) {
      p++;
      return unary();
    }
    const a = atom();
    if (isOp("^")) {
      p++;
      return { k: "bin", op: "^", a, b: unary() };
    }
    return a;
  };
  const mul = binary(unary, "*", "/");
  const add = binary(mul, "+", "-");
  const cmp = (): Node => {
    const a = add();
    if (isOp("<", ">", "<=", ">=", "=", "<>")) {
      const op = (tokens[p++] as { v: string }).v;
      return { k: "bin", op, a, b: add() };
    }
    return a;
  };
  const and = binary(cmp, "and");
  const or = binary(and, "or");
  const root = or();
  if (p < tokens.length) throw new FormulaError("Syntax error");
  return root;
}

const RAD = Math.PI / 180;

function evalNode(n: Node, values: Values): number {
  switch (n.k) {
    case "num":
      return n.v;
    case "ref": {
      const v = values[n.name];
      if (v === undefined) throw new FormulaError(`"${n.name}" has no value`);
      return v;
    }
    case "un":
      return -evalNode(n.a, values);
    case "bin": {
      const a = evalNode(n.a, values);
      const b = evalNode(n.b, values);
      switch (n.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          if (b === 0) throw new FormulaError("Division by zero");
          return a / b;
        case "^":
          return a ** b;
        case "<":
          return +(a < b);
        case ">":
          return +(a > b);
        case "<=":
          return +(a <= b);
        case ">=":
          return +(a >= b);
        case "=":
          return +(Math.abs(a - b) < 1e-9);
        case "<>":
          return +(Math.abs(a - b) >= 1e-9);
        case "and":
          return +(a !== 0 && b !== 0);
        case "or":
          return +(a !== 0 || b !== 0);
      }
      throw new FormulaError(`Unknown operator ${n.op}`);
    }
    case "call": {
      const args = (count: number) => {
        if (n.args.length !== count) throw new FormulaError(`${n.fn}() takes ${count} argument${count === 1 ? "" : "s"}`);
        return n.args;
      };
      const ev = (a: Node) => evalNode(a, values);
      switch (n.fn) {
        case "if": {
          const [c, a, b] = args(3);
          return ev(c!) !== 0 ? ev(a!) : ev(b!);
        }
        case "not":
          return +(ev(args(1)[0]!) === 0);
        case "min":
        case "max": {
          if (!n.args.length) throw new FormulaError(`${n.fn}() needs arguments`);
          const vs = n.args.map(ev);
          return n.fn === "min" ? Math.min(...vs) : Math.max(...vs);
        }
        case "abs":
          return Math.abs(ev(args(1)[0]!));
        case "sqrt": {
          const v = ev(args(1)[0]!);
          if (v < 0) throw new FormulaError("sqrt() of a negative number");
          return Math.sqrt(v);
        }
        case "round":
          return Math.round(ev(args(1)[0]!));
        case "roundup":
          return Math.ceil(ev(args(1)[0]!));
        case "rounddown":
          return Math.floor(ev(args(1)[0]!));
        case "sin":
          return Math.sin(ev(args(1)[0]!) * RAD);
        case "cos":
          return Math.cos(ev(args(1)[0]!) * RAD);
        case "tan":
          return Math.tan(ev(args(1)[0]!) * RAD);
        case "pi":
          args(0);
          return Math.PI;
      }
      throw new FormulaError(`Unknown function ${n.fn}()`);
    }
  }
}

function refs(n: Node, out = new Set<string>()): Set<string> {
  if (n.k === "ref") out.add(n.name);
  else if (n.k === "un") refs(n.a, out);
  else if (n.k === "bin") {
    refs(n.a, out);
    refs(n.b, out);
  } else if (n.k === "call") n.args.forEach((a) => refs(a, out));
  return out;
}

/** A number, or a formula string evaluated against parameter values. */
export type Num = number | string;

/** Evaluate a number or formula. */
export function evaluate(f: Num, values: Values): number {
  if (typeof f === "number") return f;
  const trimmed = f.trim();
  if (trimmed === "") throw new FormulaError("Empty formula");
  if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(trimmed)) return Number(trimmed);
  return evalNode(parse(tokenize(trimmed, Object.keys(values))), values);
}

/** Names a formula refers to (given the known names). */
export function formulaRefs(f: Num, names: string[]): string[] {
  if (typeof f === "number") return [];
  return [...refs(parse(tokenize(f, names)))];
}

export interface ParamDef {
  name: string;
  /** Formula; when set the parameter is computed rather than typed in. */
  formula?: string | null;
}

/**
 * Values for a set of parameters: plain values from `given`, formulas evaluated in dependency
 * order. Throws on circular formulas or references to unknown parameters.
 */
export function evaluateParameters(defs: ParamDef[], given: Values): Values {
  const names = defs.map((d) => d.name);
  const byName = new Map(defs.map((d) => [d.name, d]));
  const out: Values = {};
  const state = new Map<string, "busy" | "done">();
  const visit = (name: string): number => {
    if (state.get(name) === "done") return out[name]!;
    if (state.get(name) === "busy") throw new FormulaError(`Circular formula involving "${name}"`);
    const d = byName.get(name);
    if (!d) throw new FormulaError(`Unknown parameter "${name}"`);
    state.set(name, "busy");
    let v: number;
    if (d.formula) {
      for (const r of formulaRefs(d.formula, names)) visit(r);
      v = evaluate(d.formula, Object.fromEntries(names.filter((n) => n in out).map((n) => [n, out[n]!])));
    } else {
      v = given[name] ?? 0;
    }
    out[name] = v;
    state.set(name, "done");
    return v;
  };
  for (const n of names) visit(n);
  return out;
}
