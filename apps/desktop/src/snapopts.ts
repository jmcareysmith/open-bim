import { openDialog } from "./dialog.ts";

// Snaps (Revit: Manage → Snaps; SO turns snapping off): which snaps are on, the length increment,
// and how close (on screen) the cursor must be. Remembered per browser.

const KEY = "open-bim.snaps";

export interface SnapOptions {
  /** All snapping (SO toggles). */
  on: boolean;
  endpoints: boolean;
  midpoints: boolean;
  intersections: boolean;
  /** Grid and reference plane lines. */
  gridLines: boolean;
  /** Point cloud points. */
  scans: boolean;
  /** Horizontal/vertical from the previous point. */
  ortho: boolean;
  /** Length increment, mm (0: none). */
  increment: number;
  /** Snap distance, screen pixels. */
  pixels: number;
}

const DEFAULTS: SnapOptions = { on: true, endpoints: true, midpoints: true, intersections: true, gridLines: true, scans: true, ortho: true, increment: 50, pixels: 12 };

function load(): SnapOptions {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<SnapOptions>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export const snapOptions: SnapOptions = load();

export function saveSnapOptions(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(snapOptions));
  } catch {
    /* not remembered */
  }
}

export function openSnapsDialog(status: (s: string) => void): void {
  const dlg = openDialog("Snaps", () => {
    const box = document.createElement("div");
    box.className = "purge";
    const check = (k: keyof SnapOptions, label: string) => {
      const lab = document.createElement("label");
      lab.className = "purge-row";
      const cb = Object.assign(document.createElement("input"), { type: "checkbox", checked: snapOptions[k] as boolean });
      cb.onchange = () => {
        (snapOptions[k] as boolean) = cb.checked;
        saveSnapOptions();
        if (k === "on") dlg.refresh();
      };
      lab.append(cb, ` ${label}`);
      box.append(lab);
    };
    const num = (k: "increment" | "pixels", label: string) => {
      const lab = document.createElement("label");
      lab.className = "purge-row";
      const input = Object.assign(document.createElement("input"), { type: "number", value: String(snapOptions[k]), min: "0", style: "width: 6em" });
      input.onchange = () => {
        const v = Number(input.value);
        if (Number.isFinite(v) && v >= 0) {
          snapOptions[k] = v;
          saveSnapOptions();
        } else input.value = String(snapOptions[k]);
      };
      lab.append(`${label} `, input);
      box.append(lab);
    };
    check("on", "Snaps on (SO toggles)");
    check("endpoints", "Endpoints");
    check("midpoints", "Midpoints");
    check("intersections", "Grid intersections");
    check("gridLines", "Grid and reference plane lines");
    check("scans", "Point cloud points");
    check("ortho", "Horizontal/vertical from the last point");
    num("increment", "Length increment (mm, 0 = none)");
    num("pixels", "Snap distance (pixels on screen)");
    const reset = Object.assign(document.createElement("button"), { textContent: "Restore defaults" });
    reset.onclick = () => {
      Object.assign(snapOptions, DEFAULTS);
      saveSnapOptions();
      status("Snaps restored to the defaults.");
      dlg.refresh();
    };
    box.append(reset);
    return box;
  });
}
