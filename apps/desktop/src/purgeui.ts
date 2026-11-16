import { purgeUnused, unusedElements, type Document } from "@open-bim/core";
import { openDialog } from "./dialog.ts";

// Purge Unused (Revit: Manage → Purge Unused): what nothing uses, by category, ticked; Purge removes
// the ticked ones in one undo step. Run it again to catch what the first purge freed.

export function openPurgeDialog(doc: Document, status: (s: string) => void, changed: () => void): void {
  let picked = new Set<string>();
  let fresh = true;
  const dlg = openDialog("Purge Unused", () => {
    const box = document.createElement("div");
    box.className = "purge";
    const unused = unusedElements(doc);
    if (fresh) picked = new Set(unused.map((e) => e.id));
    fresh = false;
    if (!unused.length) {
      box.textContent = "Nothing unused: every type, material, family, template and filter is in use.";
      return box;
    }
    const byCat = new Map<string, typeof unused>();
    for (const e of unused) byCat.set(e.category, [...(byCat.get(e.category) ?? []), e]);
    for (const [cat, list] of [...byCat].sort(([a], [b]) => a.localeCompare(b))) {
      const det = document.createElement("details");
      det.open = true;
      const sum = document.createElement("summary");
      sum.textContent = `${cat} (${list.length})`;
      det.append(sum);
      for (const e of list) {
        const lab = document.createElement("label");
        lab.className = "purge-row";
        const cb = Object.assign(document.createElement("input"), { type: "checkbox", checked: picked.has(e.id) });
        cb.onchange = () => (cb.checked ? picked.add(e.id) : picked.delete(e.id));
        lab.append(cb, ` ${e.name ?? e.id}`);
        det.append(lab);
      }
      box.append(det);
    }
    const go = Object.assign(document.createElement("button"), { textContent: "Purge ticked" });
    go.onclick = () => {
      try {
        const n = doc.transact("Purge unused", (tx) => purgeUnused(tx, doc, [...picked]));
        status(`Purged ${n} unused item(s). Ctrl+Z to undo; run it again to catch what this freed.`);
        changed();
      } catch (e) {
        status(`⚠ ${(e as Error).message}`);
      }
      fresh = true;
      dlg.refresh();
    };
    box.append(go);
    return box;
  });
}
