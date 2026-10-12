import type { DocumentJSON } from "@open-bim/core";

const FILTERS = [{ name: "Open-BIM Project", extensions: ["obim"] }];

export const isTauri = (): boolean => "__TAURI_INTERNALS__" in window;

/** Returns the saved path (desktop) or file name (browser), or null if cancelled. */
export async function saveProject(json: DocumentJSON, currentPath: string | null): Promise<string | null> {
  const text = JSON.stringify(json, null, 2);
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const path = currentPath ?? (await save({ filters: FILTERS, defaultPath: "Project.obim" }));
    if (!path) return null;
    await writeTextFile(path, text);
    return path;
  }
  const name = currentPath ?? "Project.obim";
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
  return name;
}

export async function openProject(): Promise<{ path: string; json: DocumentJSON } | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await open({ filters: FILTERS, multiple: false, directory: false });
    if (!path) return null;
    return { path, json: JSON.parse(await readTextFile(path)) as DocumentJSON };
  }
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: ".obim,.json" });
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      resolve({ path: file.name, json: JSON.parse(await file.text()) as DocumentJSON });
    };
    input.click();
  });
}

/** Read a project file at a known path (desktop only; null in the browser). */
export async function readProjectAt(path: string): Promise<DocumentJSON | null> {
  if (!isTauri()) return null;
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  return JSON.parse(await readTextFile(path)) as DocumentJSON;
}

/** Save PDF bytes. Returns the path (desktop) or file name (browser), or null if cancelled. */
export async function savePdf(bytes: Uint8Array, defaultName: string): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({ filters: [{ name: "PDF", extensions: ["pdf"] }], defaultPath: defaultName });
    if (!path) return null;
    await writeFile(path, bytes);
    return path;
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: defaultName });
  a.click();
  URL.revokeObjectURL(url);
  return defaultName;
}

/** Save binary bytes (e.g. an .xlsx). */
export async function saveBytes(bytes: Uint8Array, defaultName: string, filter: { name: string; extensions: string[] }, mime: string): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({ filters: [filter], defaultPath: defaultName });
    if (!path) return null;
    await writeFile(path, bytes);
    return path;
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = Object.assign(document.createElement("a"), { href: url, download: defaultName });
  a.click();
  URL.revokeObjectURL(url);
  return defaultName;
}

/** Save a text file (e.g. a type catalog). */
export async function saveText(text: string, defaultName: string, filter: { name: string; extensions: string[] }): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({ filters: [filter], defaultPath: defaultName });
    if (!path) return null;
    await writeTextFile(path, text);
    return path;
  }
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: defaultName });
  a.click();
  URL.revokeObjectURL(url);
  return defaultName;
}

/** Pick and read a binary file (e.g. an .ifc). Returns its bytes and name. */
export async function openBytes(filter: { name: string; extensions: string[] }): Promise<{ bytes: Uint8Array; name: string } | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const path = await open({ filters: [filter], multiple: false, directory: false });
    return path ? { bytes: await readFile(path), name: path.split(/[\\/]/).pop() ?? path } : null;
  }
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: filter.extensions.map((e) => `.${e}`).join(",") });
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { bytes: new Uint8Array(await f.arrayBuffer()), name: f.name } : null);
    };
    input.click();
  });
}

/** Pick and read a text file. */
export async function openText(filter: { name: string; extensions: string[] }): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await open({ filters: [filter], multiple: false, directory: false });
    return path ? readTextFile(path) : null;
  }
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: filter.extensions.map((e) => `.${e}`).join(",") });
    input.onchange = async () => resolve(input.files?.[0] ? await input.files[0].text() : null);
    input.click();
  });
}

// ---- DWG (desktop only, through an external converter; see src-tauri/src/cad.rs) ----------

const CONVERTER_STORE = "open-bim.dwgConverter";

/** User-set converter path (ODA File Converter, or LibreDWG's dwg2dxf), if any. */
export function dwgConverterPath(): string | undefined {
  try {
    return localStorage.getItem(CONVERTER_STORE) || undefined;
  } catch {
    return undefined;
  }
}

export function setDwgConverterPath(path: string): void {
  try {
    if (path.trim()) localStorage.setItem(CONVERTER_STORE, path.trim());
    else localStorage.removeItem(CONVERTER_STORE);
  } catch {
    /* not remembered */
  }
}


/** Pick a DXF or DWG drawing and return it as DXF text (DWG is converted first). */
export async function openCad(): Promise<{ name: string; dxf: string } | null> {
  const filter = { name: "CAD drawing", extensions: isTauri() ? ["dxf", "dwg"] : ["dxf"] };
  if (!isTauri()) {
    const f = await openBytes(filter);
    return f ? { name: f.name, dxf: new TextDecoder().decode(f.bytes) } : null;
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({ filters: [filter], multiple: false, directory: false });
  if (!path) return null;
  const name = path.split(/[\/]/).pop() ?? path;
  if (/\.dwg$/i.test(path)) {
    const { invoke } = await import("@tauri-apps/api/core");
    return { name, dxf: await invoke<string>("dwg_to_dxf", { path, converter: dwgConverterPath() ?? null }) };
  }
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  return { name, dxf: await readTextFile(path) };
}

/** Save DXF text as .dxf, or as .dwg when the chosen name ends in .dwg (desktop). */
export async function saveCad(dxf: string, defaultName: string): Promise<string | null> {
  if (!isTauri()) return saveText(dxf, defaultName, { name: "DXF", extensions: ["dxf"] });
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({ filters: [{ name: "DXF", extensions: ["dxf"] }, { name: "DWG (via converter)", extensions: ["dwg"] }], defaultPath: defaultName });
  if (!path) return null;
  if (/\.dwg$/i.test(path)) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("dxf_to_dwg", { dxf, path, converter: dwgConverterPath() ?? null });
  } else {
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(path, dxf);
  }
  return path;
}


