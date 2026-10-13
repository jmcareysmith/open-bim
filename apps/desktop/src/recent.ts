// Recent files for the File menu (desktop: full paths that can be reopened). Kept in this
// machine's local storage; a convenience only, so failures are ignored.

const KEY = "open-bim.recent";
const MAX = 8;

export function recentFiles(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** Put `path` at the top of the list. */
export function addRecentFile(path: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([path, ...recentFiles().filter((p) => p !== path)].slice(0, MAX)));
  } catch {
    /* storage unavailable */
  }
}

export function removeRecentFile(path: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(recentFiles().filter((p) => p !== path)));
  } catch {
    /* storage unavailable */
  }
}

/** File name from a path, for the menu. */
export const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path;
