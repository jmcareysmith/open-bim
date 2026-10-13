import { Cat, PATTERNS, createMaterial, materials, type Document, type ElementId, type MaterialParams, type PatternName } from "@open-bim/core";
import { openDialog } from "./dialog.ts";

// Material Browser (Revit: Manage → Materials): the project's materials on the left; the picked
// one's graphics (shading colour, surface and cut patterns) and appearance (roughness, metalness,
// transparency, used by renders) on the right. New and Duplicate add materials.

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

export function openMaterialBrowser(doc: Document, status: (s: string) => void, pick?: ElementId): void {
  let current: ElementId | undefined = pick ?? materials(doc)[0]?.id;
  let dlg: { refresh(): void; close(): void } | null = null;
  const edit = (name: string, patch: Partial<MaterialParams>) => {
    if (!current) return;
    const id = current;
    try {
      doc.transact(name, (tx) => tx.update<MaterialParams>(id, patch));
    } catch (e) {
      status(`⚠ ${(e as Error).message}`);
    }
  };
  const unique = (base: string) => {
    let name = base;
    for (let i = 2; materials(doc).some((m) => m.name === name); i++) name = `${base} ${i}`;
    return name;
  };
  const render = () => {
    const box = document.createElement("div");
    box.className = "mb";
    const list = document.createElement("div");
    list.className = "mb-list";
    for (const m of [...materials(doc)].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))) {
      const row = document.createElement("div");
      row.className = `list-item${m.id === current ? " selected" : ""}`;
      const sw = document.createElement("span");
      sw.className = "swatch";
      sw.style.background = hex(m.params.color);
      row.append(Object.assign(document.createElement("span"), { textContent: m.name ?? m.id }), sw);
      row.onclick = () => {
        current = m.id;
        dlg?.refresh();
      };
      list.append(row);
    }
    const add = Object.assign(document.createElement("button"), { textContent: "New material" });
    add.onclick = () => {
      try {
        current = doc.transact("New material", (tx) => createMaterial(tx, doc, unique("New Material"))).id;
        dlg?.refresh();
      } catch (e) {
        status(`⚠ ${(e as Error).message}`);
      }
    };
    const dup = Object.assign(document.createElement("button"), { textContent: "Duplicate" });
    dup.onclick = () => {
      const m = current ? doc.get<MaterialParams>(current) : undefined;
      if (!m) return;
      current = doc.transact("Duplicate material", (tx) => {
        const copy = createMaterial(tx, doc, unique(`${m.name ?? "Material"} copy`));
        tx.update<MaterialParams>(copy.id, { ...m.params });
        return copy.id;
      });
      dlg?.refresh();
    };
    const listBox = document.createElement("div");
    listBox.className = "mb-side";
    const buttons = document.createElement("div");
    buttons.className = "buttons";
    buttons.append(add, dup);
    listBox.append(list, buttons);

    const form = document.createElement("div");
    form.className = "mb-form";
    const m = current ? doc.get<MaterialParams>(current) : undefined;
    if (!m || m.category !== Cat.Material) {
      form.append(Object.assign(document.createElement("p"), { className: "muted", textContent: "No materials yet." }));
    } else {
      const row = (label: string, control: HTMLElement) => {
        const l = document.createElement("label");
        l.className = "ovr-row";
        l.append(Object.assign(document.createElement("span"), { textContent: label }), control);
        form.append(l);
      };
      const name = Object.assign(document.createElement("input"), { value: m.name ?? "" });
      name.onchange = () => {
        if (!name.value.trim()) return;
        doc.transact("Rename material", (tx) => tx.setName(m.id, name.value.trim()));
        dlg?.refresh();
      };
      row("Name", name);
      form.append(Object.assign(document.createElement("div"), { className: "ovr-sub", textContent: "Graphics" }));
      const col = Object.assign(document.createElement("input"), { type: "color", value: hex(m.params.color) });
      col.onchange = () => edit("Material colour", { color: parseInt(col.value.slice(1), 16) });
      row("Shading colour", col);
      const pat = (value: PatternName, key: "surfacePattern" | "cutPattern") => {
        const s = document.createElement("select");
        for (const p of PATTERNS) s.append(new Option(p === "none" ? "None" : p === "solid" ? "Solid fill" : p, p, false, p === value));
        s.onchange = () => edit("Material pattern", { [key]: s.value as PatternName });
        return s;
      };
      row("Surface pattern", pat(m.params.surfacePattern, "surfacePattern"));
      row("Cut pattern", pat(m.params.cutPattern, "cutPattern"));
      form.append(Object.assign(document.createElement("div"), { className: "ovr-sub", textContent: "Appearance (renders)" }));
      const slider = (label: string, key: "roughness" | "metalness" | "transparency", value: number) => {
        const r = Object.assign(document.createElement("input"), { type: "range", min: "0", max: "100", value: String(Math.round(value * 100)) });
        const out = Object.assign(document.createElement("span"), { className: "muted", textContent: `${r.value}%` });
        r.oninput = () => (out.textContent = `${r.value}%`);
        r.onchange = () => edit(`Material ${key}`, { [key]: Number(r.value) / 100 });
        const wrap = document.createElement("span");
        wrap.className = "mb-slider";
        wrap.append(r, out);
        row(label, wrap);
      };
      slider("Roughness", "roughness", m.params.roughness ?? 0.85);
      slider("Metalness", "metalness", m.params.metalness ?? 0);
      slider("Transparency", "transparency", m.params.transparency ?? 0);
    }
    box.append(listBox, form);
    return box;
  };
  // Keep the list in step with the model while it's open.
  let off: (() => void) | null = null;
  dlg = openDialog("Material Browser", render, () => off?.());
  off = doc.on(() => dlg?.refresh());
}
