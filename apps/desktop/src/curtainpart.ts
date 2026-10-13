import type { ElementId } from "@open-bim/core";

// The picked part of a selected curtain wall (Revit: Tab to a mullion or panel): its wall and part
// key — "v:k:j" / "h:k:i" for mullion segments, "p:i,j" for panels. Cleared when the selection changes.

export type CurtainPart = { id: ElementId; key: string };

let part: CurtainPart | null = null;
const listeners = new Set<() => void>();

export function curtainPart(): CurtainPart | null {
  return part;
}

export function setCurtainPart(p: CurtainPart | null): void {
  if (p?.id === part?.id && p?.key === part?.key) return;
  part = p;
  for (const fn of listeners) fn();
}

export function onCurtainPart(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** "Mullion" or "Curtain Panel", with its place, for headings and the status bar. */
export function partLabel(key: string): string {
  const [kind, a, b] = key.split(/[:,]/);
  if (kind === "v") return `Vertical mullion (line ${Number(a) + 1}, row ${Number(b) + 1})`;
  if (kind === "h") return `Horizontal mullion (line ${Number(a) + 1}, bay ${Number(b) + 1})`;
  return `Curtain panel (bay ${Number(a) + 1}, row ${Number(b) + 1})`;
}
