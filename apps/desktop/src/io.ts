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
