// Scripting and plugins (Revit: macros / Dynamo / pyRevit, here in JavaScript). Scripts are run
// with a scope of named values (the app passes its plugin API); plugins are ES modules whose
// default export (or named exports) provide `name` and `activate(api)`.

// eslint-disable-next-line @typescript-eslint/no-empty-function
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...a: unknown[]) => Promise<unknown>;

/**
 * Run a script with `scope` in scope. A script that is a single expression returns its value;
 * otherwise use `return` to give a result. Errors carry the script's message.
 */
export async function runScript(code: string, scope: Record<string, unknown>): Promise<unknown> {
  const names = Object.keys(scope);
  const values = names.map((n) => scope[n]);
  let fn: (...a: unknown[]) => Promise<unknown>;
  try {
    // Expression first, so `doc.all().length` prints its value like a REPL.
    fn = new AsyncFunction(...names, `"use strict"; return (${code.trim().replace(/;+$/, "")}\n);`);
  } catch {
    fn = new AsyncFunction(...names, `"use strict";\n${code}`);
  }
  return fn(...values);
}

export interface PluginCommand {
  id: string;
  label: string;
  run(): void | Promise<void>;
}

export interface PluginDefinition<Api = unknown> {
  name: string;
  /** Called once when the plugin loads; register commands here. May return a cleanup function. */
  activate(api: Api): void | (() => void) | Promise<void | (() => void)>;
}

/** Accept `export default { name, activate }`, `export default function activate`, or named exports. */
export function pluginFromModule<Api>(mod: Record<string, unknown>, fallbackName = "Plugin"): PluginDefinition<Api> {
  const d = mod.default as unknown;
  const pick = (o: Record<string, unknown> | undefined) =>
    o && typeof o.activate === "function"
      ? { name: typeof o.name === "string" && o.name ? o.name : fallbackName, activate: o.activate as PluginDefinition<Api>["activate"] }
      : null;
  if (typeof d === "function") return { name: fallbackName, activate: d as PluginDefinition<Api>["activate"] };
  const found = pick(d as Record<string, unknown> | undefined) ?? pick(mod);
  if (!found) throw new Error("A plugin must export activate(api) (or a default { name, activate })");
  return found;
}

/** Display a value from the console: strings as-is, elements by category and name, others as JSON. */
export function inspect(v: unknown, depth = 0): string {
  if (v === undefined) return "undefined";
  if (v === null || typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "string") return depth ? JSON.stringify(v) : v;
  if (typeof v === "function") return `[function ${(v as { name?: string }).name || "anonymous"}]`;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (Array.isArray(v)) {
    if (depth > 1) return `[${v.length} items]`;
    const items = v.slice(0, 20).map((x) => inspect(x, depth + 1));
    return `[${items.join(", ")}${v.length > 20 ? `, … ${v.length - 20} more` : ""}]`;
  }
  const o = v as Record<string, unknown>;
  if (typeof o.id === "string" && typeof o.category === "string") return `${o.category} ${o.name ? `"${o.name}" ` : ""}(${o.id.slice(0, 8)})`;
  try {
    const s = JSON.stringify(v);
    return s.length > 2000 ? `${s.slice(0, 2000)}…` : s;
  } catch {
    return String(v);
  }
}
