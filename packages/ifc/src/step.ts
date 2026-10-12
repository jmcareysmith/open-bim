// ISO 10303-21 (STEP physical file) writing for IFC: entities are added as `#n=IFCNAME(args);`.

/** A value in an entity's argument list. */
export type StepArg = Ref | Enum | Typed | Real | Derived | string | number | boolean | null | StepArg[];

export class Ref {
  constructor(readonly id: number) {}
}
/** `.VALUE.` */
export class Enum {
  constructor(readonly value: string) {}
}
/** `IFCLABEL('x')` — a typed value in a SELECT. */
export class Typed {
  constructor(
    readonly type: string,
    readonly value: StepArg,
  ) {}
}
/** A number that must be written as a real (with a decimal point), even when whole. */
export class Real {
  constructor(readonly value: number) {}
}
/** `*` */
export class Derived {}

export const ref = (id: number) => new Ref(id);
export const en = (v: string) => new Enum(v);
export const typed = (type: string, value: StepArg) => new Typed(type, value);
export const real = (v: number) => new Real(v);
export const DERIVED = new Derived();

/** STEP real: always with a decimal point, exponent in capitals ("1.5", "2.", "1.E-05"). */
export function formatReal(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`Can't write ${v} to IFC`);
  if (Object.is(v, -0)) v = 0;
  const s = Math.abs(v) >= 1e15 || (v !== 0 && Math.abs(v) < 1e-6) ? v.toExponential() : String(Math.round(v * 1e9) / 1e9);
  const [mant, exp] = s.toUpperCase().split("E");
  const m = mant!.includes(".") ? mant! : `${mant}.`;
  return exp ? `${m}E${exp.startsWith("-") ? "-" : ""}${exp.replace(/^[+-]/, "").padStart(2, "0")}` : m;
}

/** STEP string: quotes doubled, backslashes doubled, non-ASCII as \X2\hhhh\X0\. */
export function formatString(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === "'") out += "''";
    else if (ch === "\\") out += "\\\\";
    else if (c >= 0x20 && c < 0x7f) out += ch;
    else if (c <= 0xffff) out += `\\X2\\${c.toString(16).toUpperCase().padStart(4, "0")}\\X0\\`;
    else out += `\\X4\\${c.toString(16).toUpperCase().padStart(8, "0")}\\X0\\`;
  }
  return `'${out}'`;
}

export function formatArg(a: StepArg): string {
  if (a === null || a === undefined) return "$";
  if (a instanceof Ref) return `#${a.id}`;
  if (a instanceof Enum) return `.${a.value}.`;
  if (a instanceof Derived) return "*";
  if (a instanceof Real) return formatReal(a.value);
  if (a instanceof Typed) return `${a.type}(${formatArg(a.value)})`;
  if (typeof a === "boolean") return a ? ".T." : ".F.";
  if (typeof a === "number") return Number.isInteger(a) ? String(a) : formatReal(a);
  if (typeof a === "string") return formatString(a);
  return `(${a.map(formatArg).join(",")})`;
}

export class StepWriter {
  private lines: string[] = [];
  private next = 1;

  add(type: string, ...args: StepArg[]): Ref {
    const id = this.next++;
    this.lines.push(`#${id}=${type.toUpperCase()}(${args.map(formatArg).join(",")});`);
    return ref(id);
  }

  get count(): number {
    return this.lines.length;
  }

  /** The whole file. */
  toString(header: { name: string; description: string; timestamp: string; author?: string; organisation?: string; schema?: string }): string {
    const h = [
      "ISO-10303-21;",
      "HEADER;",
      `FILE_DESCRIPTION((${formatString(header.description)}),'2;1');`,
      `FILE_NAME(${formatString(header.name)},${formatString(header.timestamp)},(${formatString(header.author ?? "")}),(${formatString(header.organisation ?? "")}),'Open-BIM','Open-BIM','');`,
      `FILE_SCHEMA(('${header.schema ?? "IFC4"}'));`,
      "ENDSEC;",
      "DATA;",
    ];
    return [...h, ...this.lines, "ENDSEC;", "END-ISO-10303-21;", ""].join("\n");
  }
}
