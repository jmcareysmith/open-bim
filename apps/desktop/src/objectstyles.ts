import { DEFAULT_OBJECT_STYLES, LINE_PATTERNS, objectStyle, penWidth, setObjectStyle, type Document, type LinePattern } from "@open-bim/core";
import { openDialog } from "./dialog.ts";

// Object Styles (Revit: Manage → Object Styles): per category, the pen for projection and cut
// lines, a line colour and pattern. Views start from these; V/G overrides lay on top.

const LABELS: Record<string, string> = {
  Wall: "Walls",
  Floor: "Floors",
  Ceiling: "Ceilings",
  Roof: "Roofs",
  Door: "Doors",
  Window: "Windows",
  Stair: "Stairs",
  Railing: "Railings",
  Ramp: "Ramps",
  Column: "Structural Columns",
  Beam: "Structural Framing",
  PadFooting: "Pad Footings",
  StripFooting: "Strip Footings",
  Toposolid: "Toposolid",
  BuildingPad: "Building Pads",
  Duct: "Ducts",
  Pipe: "Pipes",
  Furniture: "Furniture",
  Casework: "Casework",
  GenericModel: "Generic Models",
  Mass: "Mass",
};

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

export function openObjectStyles(doc: Document, status: (s: string) => void): void {
  let dlg: { refresh(): void; close(): void } | null = null;
  const off = doc.on(() => dlg?.refresh());
  const set = (cat: string, which: "projection" | "cut", patch: Record<string, unknown>) => {
    try {
      doc.transact("Object style", (tx) => setObjectStyle(tx, doc, cat, { [which]: patch }));
    } catch (e) {
      status(`⚠ ${(e as Error).message}`);
    }
  };
  dlg = openDialog(
    "Object Styles",
    () => {
      const box = document.createElement("div");
      box.className = "os";
      const table = document.createElement("table");
      table.className = "os-table";
      table.innerHTML = "<tr><th>Category</th><th>Projection</th><th>Cut</th><th>Line colour</th><th>Pattern</th></tr>";
      const pen = (cat: string, which: "projection" | "cut", value: number) => {
        const s = document.createElement("select");
        for (let i = 1; i <= 16; i++) s.append(new Option(`${i}  (${penWidth(i, 100)} mm)`, String(i), false, i === value));
        s.onchange = () => set(cat, which, { weight: Number(s.value) });
        return s;
      };
      for (const cat of Object.keys(DEFAULT_OBJECT_STYLES)) {
        const os = objectStyle(doc, cat);
        const tr = document.createElement("tr");
        const td = (n: Node | string) => {
          const c = document.createElement("td");
          c.append(n);
          tr.append(c);
        };
        td(LABELS[cat] ?? cat);
        td(pen(cat, "projection", os.projection.weight));
        td(pen(cat, "cut", (os.cut ?? os.projection).weight));
        const col = Object.assign(document.createElement("input"), { type: "color", value: hex(os.projection.color ?? 0) });
        col.onchange = () => {
          const c = parseInt(col.value.slice(1), 16);
          set(cat, "projection", { color: c || null });
          set(cat, "cut", { color: c || null });
        };
        td(col);
        const pat = document.createElement("select");
        for (const p of LINE_PATTERNS) pat.append(new Option(p === "solid" ? "Solid" : p, p, false, p === (os.projection.pattern ?? "solid")));
        pat.onchange = () => set(cat, "projection", { pattern: pat.value === "solid" ? null : (pat.value as LinePattern) });
        td(pat);
        table.append(tr);
      }
      box.append(
        table,
        Object.assign(document.createElement("p"), { className: "muted", textContent: "Pens are paper widths that get finer at smaller scales (shown at 1:100). Thin Lines (TL) shows every line at 1 px." }),
      );
      return box;
    },
    () => off(),
  );
}
