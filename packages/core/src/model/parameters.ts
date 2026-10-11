import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, ParamValue } from "../element.ts";
import { evaluateParameters, type Values } from "../expr.ts";
import { Cat } from "./architecture.ts";

// Project parameters (user fields on categories), shared parameters (the same fields identified by
// GUID across projects, via Revit's shared parameter file) and global parameters (project-wide
// values that can drive element parameters).

export type ParamDataType = "text" | "length" | "number" | "area" | "yesno";

export type ProjectParameterParams = {
  dataType: ParamDataType;
  /** Categories that get the parameter. */
  categories: string[];
  /** Instance: each element has its own value; type: stored on the element's type. */
  binding: "instance" | "type";
  /** Shared parameter GUID, when it came from (or was written to) a shared parameter file. */
  guid: string | null;
  group: string;
};
export type ProjectParameter = Element<ProjectParameterParams>;

export type GlobalParameterParams = {
  kind: "length" | "number";
  value: number;
  formula: string | null;
};
export type GlobalParameter = Element<GlobalParameterParams>;

registerCategory({ name: Cat.ProjectParameter, dependencies: () => [], cascadeDelete: false, isType: false });
// Changing a global regenerates the elements it drives (their values are rewritten by the hook).
registerCategory({ name: Cat.GlobalParameter, dependencies: () => [], cascadeDelete: false, isType: false });

/** Where custom values live on an element. */
const CUSTOM = "custom";
/** Where an element's global-parameter associations live: { paramKey: globalName }. */
const GLOBALS = "globals";

export function projectParameters(doc: Document): ProjectParameter[] {
  return doc.byCategory<ProjectParameterParams>(Cat.ProjectParameter);
}

/** Project parameters that apply to an element's category. */
export function parametersFor(doc: Document, category: string): ProjectParameter[] {
  return projectParameters(doc).filter((p) => p.params.categories.includes(category));
}

const nameTaken = (doc: Document, cat: string, name: string, except?: ElementId) =>
  doc.byCategory(cat).some((p) => p.name === name && p.id !== except);

export function createProjectParameter(
  tx: Transaction,
  doc: Document,
  name: string,
  opts: Partial<ProjectParameterParams> = {},
): ProjectParameter {
  if (!name.trim()) throw new Error("Parameters need a name");
  if (nameTaken(doc, Cat.ProjectParameter, name)) throw new Error(`A project parameter called "${name}" already exists`);
  if (opts.guid && projectParameters(doc).some((p) => p.params.guid === opts.guid)) throw new Error(`Shared parameter ${opts.guid} is already in this project`);
  return tx.create<ProjectParameterParams>(
    Cat.ProjectParameter,
    {
      dataType: opts.dataType ?? "text",
      categories: opts.categories ?? [],
      binding: opts.binding ?? "instance",
      guid: opts.guid ?? null,
      group: opts.group ?? "Identity Data",
    },
    { name },
  );
}

/** The element that holds a parameter's value: the element itself, or its type for type bindings. */
function holder(doc: Document, el: Element, p: ProjectParameter): Element | undefined {
  return p.params.binding === "type" ? (el.typeId ? doc.get(el.typeId) : undefined) : el;
}

/** A project parameter's value for an element (undefined if unset or not applicable). */
export function customValue(doc: Document, el: Element, name: string): ParamValue | undefined {
  const p = projectParameters(doc).find((x) => x.name === name);
  if (!p || !p.params.categories.includes(el.category)) return undefined;
  const h = holder(doc, el, p);
  const custom = h?.params[CUSTOM] as Record<string, ParamValue> | undefined;
  return custom?.[name];
}

function coerce(p: ProjectParameter, v: ParamValue): ParamValue {
  switch (p.params.dataType) {
    case "text":
      return String(v ?? "");
    case "yesno":
      return v === true || v === "true" || v === 1 || v === "1" || v === "Yes";
    default: {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) throw new Error(`${p.name} needs a number`);
      return n;
    }
  }
}

/** Set a project parameter's value on an element (or on its type, for type bindings). */
export function setCustomValue(tx: Transaction, doc: Document, el: Element, name: string, value: ParamValue): void {
  const p = projectParameters(doc).find((x) => x.name === name);
  if (!p) throw new Error(`No project parameter called "${name}"`);
  if (!p.params.categories.includes(el.category)) throw new Error(`${name} doesn't apply to ${el.category}`);
  const h = holder(doc, el, p);
  if (!h) throw new Error(`${name} is a type parameter and this element has no type`);
  const custom = { ...((h.params[CUSTOM] as Record<string, ParamValue> | undefined) ?? {}), [name]: coerce(p, value) };
  tx.update(h.id, { [CUSTOM]: custom });
}

// ---- shared parameter file (Revit .txt) -------------------------------------------------

export interface SharedParameterDef {
  guid: string;
  name: string;
  dataType: ParamDataType;
  group: string;
}

const REVIT_TYPE: Record<ParamDataType, string> = { text: "TEXT", length: "LENGTH", number: "NUMBER", area: "AREA", yesno: "YESNO" };
const FROM_REVIT: Record<string, ParamDataType> = { TEXT: "text", LENGTH: "length", NUMBER: "number", INTEGER: "number", AREA: "area", YESNO: "yesno" };

/** Parse a Revit shared parameter file (tab-separated *META / *GROUP / *PARAM sections). */
export function parseSharedParameters(text: string): SharedParameterDef[] {
  const groups = new Map<string, string>();
  const out: SharedParameterDef[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.startsWith("#") || raw.startsWith("*")) continue;
    const cols = raw.split("\t");
    if (cols[0] === "GROUP") groups.set(cols[1]!, cols[2] ?? "");
    else if (cols[0] === "PARAM") {
      const [, guid, name, type, , groupId] = cols;
      if (!guid || !name) throw new Error(`Bad PARAM line: "${raw}"`);
      out.push({ guid, name, dataType: FROM_REVIT[(type ?? "TEXT").toUpperCase()] ?? "text", group: groups.get(groupId ?? "") ?? "Shared" });
    }
  }
  return out;
}

/** Write shared parameter definitions as a Revit shared parameter file. */
export function writeSharedParameters(defs: SharedParameterDef[]): string {
  const groups = [...new Set(defs.map((d) => d.group))];
  const lines = [
    "# This is a Revit shared parameter file.",
    "# Do not edit manually.",
    "*META\tVERSION\tMINVERSION",
    "META\t2\t1",
    "*GROUP\tID\tNAME",
    ...groups.map((g, i) => `GROUP\t${i + 1}\t${g}`),
    "*PARAM\tGUID\tNAME\tDATATYPE\tDATACATEGORY\tGROUP\tVISIBLE\tDESCRIPTION\tUSERMODIFIABLE\tHIDEWHENNOVALUE",
    ...defs.map((d) => `PARAM\t${d.guid}\t${d.name}\t${REVIT_TYPE[d.dataType]}\t\t${groups.indexOf(d.group) + 1}\t1\t\t1\t0`),
  ];
  return lines.join("\r\n") + "\r\n";
}

/** Give every project parameter a GUID (making it shareable) and list them as shared definitions. */
export function shareProjectParameters(tx: Transaction, doc: Document): SharedParameterDef[] {
  return projectParameters(doc).map((p) => {
    let guid = p.params.guid;
    if (!guid) {
      guid = crypto.randomUUID();
      tx.update<ProjectParameterParams>(p.id, { guid });
    }
    return { guid, name: p.name ?? "", dataType: p.params.dataType, group: p.params.group };
  });
}

// ---- global parameters -------------------------------------------------------------------

export function globalParameters(doc: Document): GlobalParameter[] {
  return doc.byCategory<GlobalParameterParams>(Cat.GlobalParameter);
}

export function createGlobalParameter(
  tx: Transaction,
  doc: Document,
  name: string,
  opts: Partial<GlobalParameterParams> = {},
): GlobalParameter {
  if (!/^[A-Za-z][A-Za-z0-9_ ]*$/.test(name.trim())) throw new Error("Global parameter names start with a letter and use letters, digits, spaces or _");
  if (nameTaken(doc, Cat.GlobalParameter, name)) throw new Error(`A global parameter called "${name}" already exists`);
  return tx.create<GlobalParameterParams>(Cat.GlobalParameter, { kind: opts.kind ?? "length", value: opts.value ?? 0, formula: opts.formula ?? null }, { name });
}

/** All global parameter values (formulas evaluated in dependency order). */
export function globalValues(doc: Document): Values {
  const gs = globalParameters(doc);
  return evaluateParameters(
    gs.map((g) => ({ name: g.name ?? "", formula: g.params.formula })),
    Object.fromEntries(gs.map((g) => [g.name ?? "", g.params.value])),
  );
}

/** Drive a numeric element parameter from a global parameter (null removes the association). */
export function associateGlobal(tx: Transaction, doc: Document, elId: ElementId, key: string, globalName: string | null): void {
  const el = doc.require(elId);
  if (typeof el.params[key] !== "number") throw new Error(`${key} isn't a numeric parameter of this ${el.category}`);
  if (globalName && !globalParameters(doc).some((g) => g.name === globalName)) throw new Error(`No global parameter called "${globalName}"`);
  const assoc = { ...((el.params[GLOBALS] as Record<string, string> | undefined) ?? {}) };
  if (globalName) assoc[key] = globalName;
  else delete assoc[key];
  tx.update(elId, { [GLOBALS]: assoc });
}

export function globalAssociations(el: Element): Record<string, string> {
  return (el.params[GLOBALS] as Record<string, string> | undefined) ?? {};
}

/** Write global values into every associated element parameter (run as a commit hook). */
export function applyGlobalParameters(tx: Transaction, doc: Document): void {
  const driven = doc.all().filter((e) => Object.keys(globalAssociations(e)).length);
  if (!driven.length) return;
  const values = globalValues(doc);
  for (const el of driven) {
    const patch: Record<string, number> = {};
    for (const [key, name] of Object.entries(globalAssociations(el))) {
      const v = values[name];
      if (v === undefined) continue; // global deleted: keep the last value
      if (el.params[key] !== v) patch[key] = v;
    }
    if (Object.keys(patch).length) tx.update(el.id, patch);
  }
}

/** Keep global-parameter-driven values up to date after every edit. */
export function enableGlobalParameters(doc: Document): () => void {
  return doc.addCommitHook((tx) => applyGlobalParameters(tx, doc));
}
