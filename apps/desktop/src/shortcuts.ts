import { openDialog } from "./dialog.ts";

// Keyboard shortcuts (Revit: View → User Interface → Keyboard Shortcuts, or KS). One or two
// letters per command; single letters fire at once and a second letter within a second can take
// over (M → dimension, MV → move). Your changes are kept on this machine.

export type ShortcutAction = `tool:${string}` | `cmd:${string}`;

interface Command {
  action: ShortcutAction;
  label: string;
  /** Default keys, e.g. "W", "MV", "Shift+H"; several separated by spaces. "" = none. */
  keys: string;
}

export const COMMANDS: Command[] = [
  { action: "tool:wall", label: "Wall", keys: "W" },
  { action: "tool:door", label: "Door", keys: "D" },
  { action: "tool:window", label: "Window", keys: "N" },
  { action: "tool:component", label: "Component", keys: "C" },
  { action: "tool:floor", label: "Floor", keys: "" },
  { action: "tool:ceiling", label: "Ceiling", keys: "" },
  { action: "tool:roof", label: "Roof", keys: "" },
  { action: "tool:opening", label: "Wall Opening", keys: "" },
  { action: "tool:stair", label: "Stair", keys: "" },
  { action: "tool:ramp", label: "Ramp", keys: "" },
  { action: "tool:railing", label: "Railing", keys: "" },
  { action: "tool:room", label: "Room", keys: "RM" },
  { action: "tool:roomseparator", label: "Room Separator", keys: "" },
  { action: "tool:area", label: "Area", keys: "" },
  { action: "tool:column", label: "Column", keys: "" },
  { action: "tool:beam", label: "Beam", keys: "" },
  { action: "tool:footing", label: "Footing", keys: "" },
  { action: "tool:grid", label: "Grid", keys: "G GR" },
  { action: "tool:refplane", label: "Reference Plane", keys: "R RP" },
  { action: "tool:section", label: "Section", keys: "S" },
  { action: "tool:callout", label: "Callout", keys: "" },
  { action: "tool:elevation", label: "Elevation", keys: "" },
  { action: "tool:camera", label: "Camera", keys: "" },
  { action: "tool:dimension", label: "Aligned Dimension", keys: "M DI" },
  { action: "tool:detailline", label: "Detail Line", keys: "L DL" },
  { action: "tool:region", label: "Filled Region", keys: "" },
  { action: "tool:text", label: "Text", keys: "T TX" },
  { action: "tool:tag", label: "Tag", keys: "TG" },
  { action: "tool:keynote", label: "Keynote", keys: "" },
  { action: "tool:cloud", label: "Revision Cloud", keys: "" },
  { action: "tool:move", label: "Move", keys: "MV" },
  { action: "tool:copy", label: "Copy", keys: "CO CC" },
  { action: "tool:rotate", label: "Rotate", keys: "RO" },
  { action: "tool:mirror", label: "Mirror (draw axis)", keys: "MM DM" },
  { action: "tool:array", label: "Array", keys: "AR" },
  { action: "tool:align", label: "Align", keys: "AL" },
  { action: "tool:offset", label: "Offset", keys: "OF" },
  { action: "tool:trim", label: "Trim/Extend", keys: "TR" },
  { action: "tool:split", label: "Split", keys: "SL" },
  { action: "tool:demolish", label: "Demolish", keys: "" },
  { action: "cmd:visibilityGraphics", label: "Visibility/Graphics", keys: "VV VG" },
  { action: "cmd:fit", label: "Zoom to Fit", keys: "F ZF" },
  { action: "cmd:hide", label: "Temporary Hide Element", keys: "H" },
  { action: "cmd:hideCategory", label: "Temporary Hide Category", keys: "Shift+H" },
  { action: "cmd:isolate", label: "Temporary Isolate Element", keys: "I" },
  { action: "cmd:isolateCategory", label: "Temporary Isolate Category", keys: "Shift+I" },
  { action: "cmd:resetVisibility", label: "Reset Temporary Hide/Isolate", keys: "U" },
  { action: "cmd:view3d", label: "Default 3D View", keys: "" },
  { action: "cmd:render", label: "Render", keys: "" },
  { action: "cmd:keyboardShortcuts", label: "Keyboard Shortcuts", keys: "KS" },
];

const KEY = "open-bim.shortcuts";

function overrides(): Record<string, string> {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    return o && typeof o === "object" ? (o as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveOverrides(o: Record<string, string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    /* storage unavailable: changes last this session only */
  }
}

/** Normalise typed keys: "mv, co" → "MV CO"; "shift+h" → "Shift+H". */
export function normaliseKeys(text: string): string {
  return text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((k) => (/^shift\+/i.test(k) ? `Shift+${k.slice(6).toUpperCase()}` : k.toUpperCase()))
    .filter((k) => /^(Shift\+)?[A-Z0-9]{1,2}$/.test(k))
    .join(" ");
}

/** Keys for each command: your changes over the defaults. */
export function shortcutKeys(): Map<ShortcutAction, string> {
  const o = overrides();
  return new Map(COMMANDS.map((c) => [c.action, o[c.action] ?? c.keys]));
}

/** Key sequence → action ("W", "MV", "Shift+H"). */
export function shortcutTable(): Map<string, ShortcutAction> {
  const t = new Map<string, ShortcutAction>();
  for (const [action, keys] of shortcutKeys()) for (const k of keys.split(" ").filter(Boolean)) if (!t.has(k)) t.set(k, action);
  return t;
}

export function openShortcutEditor(onChange: () => void): void {
  let filter = "";
  const dlg = openDialog("Keyboard Shortcuts", () => {
    const keys = shortcutKeys();
    const box = document.createElement("div");
    box.className = "ks";
    const search = Object.assign(document.createElement("input"), { type: "search", placeholder: "Search commands", value: filter });
    search.oninput = () => {
      filter = search.value;
      for (const row of list.children) (row as HTMLElement).hidden = !row.textContent?.toLowerCase().includes(filter.toLowerCase()) && !(row.querySelector("input") as HTMLInputElement).value.toLowerCase().includes(filter.toLowerCase());
    };
    const list = document.createElement("div");
    list.className = "ks-list";
    // Which key sequences are used more than once (shown in red).
    const uses = new Map<string, number>();
    for (const k of keys.values()) for (const s of k.split(" ").filter(Boolean)) uses.set(s, (uses.get(s) ?? 0) + 1);
    for (const c of COMMANDS) {
      const row = document.createElement("label");
      row.className = "ks-row";
      const input = Object.assign(document.createElement("input"), { value: keys.get(c.action) ?? "", placeholder: "none", title: "One or two letters; several separated by spaces (e.g. MV M); Shift+H" });
      if ((keys.get(c.action) ?? "").split(" ").some((s) => s && (uses.get(s) ?? 0) > 1)) input.classList.add("invalid");
      input.onchange = () => {
        const o = overrides();
        const v = normaliseKeys(input.value);
        if (v === c.keys) delete o[c.action];
        else o[c.action] = v;
        saveOverrides(o);
        onChange();
        dlg.refresh();
      };
      row.append(Object.assign(document.createElement("span"), { textContent: c.label }), input);
      row.hidden = !!filter && !c.label.toLowerCase().includes(filter.toLowerCase());
      list.append(row);
    }
    const reset = Object.assign(document.createElement("button"), { textContent: "Reset to defaults" });
    reset.onclick = () => {
      saveOverrides({});
      onChange();
      dlg.refresh();
    };
    const note = Object.assign(document.createElement("p"), {
      className: "muted",
      textContent: "Type a shortcut, then press Enter or Tab. Red = the same keys on more than one command (the first listed wins).",
    });
    box.append(search, list, note, reset);
    return box;
  });
}
