import { activeWorkset, createWorkset, deleteWorkset, enableWorksets, setActiveWorkset, worksets, type Document } from "@open-bim/core";
import { openDialog } from "./dialog.ts";

// Worksets dialog (Revit: Collaborate → Worksets): turn worksets on, add, rename and delete them
// (moving their elements), and choose the active one (where new elements go).

export function openWorksetsDialog(doc: Document, status: (s: string) => void, changed: () => void): void {
  const run = (name: string, fn: Parameters<Document["transact"]>[1]) => {
    try {
      doc.transact(name, fn);
      changed();
    } catch (e) {
      status(`⚠ ${(e as Error).message}`);
    }
    dlg.refresh();
  };
  const dlg = openDialog("Worksets", () => {
    const box = document.createElement("div");
    box.className = "worksets";
    const list = worksets(doc);
    if (!list.length) {
      const p = document.createElement("p");
      p.textContent = "Worksets divide the model so people can take parts of it, and views can hide them. Turning them on puts levels and grids in “Shared Levels and Grids” and everything else in “Workset1”.";
      const on = Object.assign(document.createElement("button"), { textContent: "Enable worksets" });
      on.onclick = () => run("Enable worksets", (tx) => void enableWorksets(tx, doc));
      box.append(p, on);
      return box;
    }
    const act = activeWorkset(doc);
    const counts = new Map<string, number>();
    for (const el of doc.all()) {
      const w = (el.params as { worksetId?: string }).worksetId;
      if (w) counts.set(w, (counts.get(w) ?? 0) + 1);
    }
    const table = document.createElement("table");
    table.className = "worksets-table";
    table.innerHTML = "<tr><th>Active</th><th>Name</th><th>Elements</th><th></th></tr>";
    for (const w of list) {
      const tr = document.createElement("tr");
      const radio = Object.assign(document.createElement("input"), { type: "radio", name: "active-workset", checked: w.id === act });
      radio.onchange = () => {
        setActiveWorkset(doc, w.id);
        changed();
        status(`Active workset: ${w.name}. New elements go into it.`);
      };
      const name = Object.assign(document.createElement("input"), { value: w.name ?? "" });
      name.onchange = () => run("Rename workset", (tx) => tx.setName(w.id, name.value.trim() || w.name));
      const del = Object.assign(document.createElement("button"), { textContent: "Delete…", disabled: list.length < 2 });
      del.onclick = () => {
        const others = list.filter((o) => o.id !== w.id);
        const to = others.find((o) => o.id === act) ?? others[0]!;
        if (!confirm(`Delete “${w.name}” and move its ${counts.get(w.id) ?? 0} element(s) to “${to.name}”?`)) return;
        run("Delete workset", (tx) => deleteWorkset(tx, doc, w.id, to.id));
      };
      const cells = [radio, name, document.createTextNode(String(counts.get(w.id) ?? 0)), del];
      for (const c of cells) {
        const td = document.createElement("td");
        td.append(c);
        tr.append(td);
      }
      table.append(tr);
    }
    const add = Object.assign(document.createElement("button"), { textContent: "New workset" });
    add.onclick = () => {
      const n = prompt("Name of the new workset:", `Workset${list.length}`);
      if (n) run("New workset", (tx) => void createWorkset(tx, doc, n));
    };
    box.append(table, add);
    return box;
  });
}
