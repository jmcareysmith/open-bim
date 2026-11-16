import { Document, standardCategories, transferStandards } from "@open-bim/core";
import { openDialog } from "./dialog.ts";

// Transfer Project Standards (Revit: Manage): pick what to bring from another project (by
// category), whether same-named items are skipped or overwritten, then Copy (one undo step).

const LABEL = (c: string) => c.replace(/Type$/, " types").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^Material$/, "Materials").replace(/^View Filter$/, "View filters").replace(/^View Template$/, "View templates");

export function openTransferDialog(doc: Document, src: Document, from: string, status: (s: string) => void, changed: () => void): void {
  const cats = standardCategories(src);
  const picked = new Set(cats);
  let mode: "skip" | "overwrite" = "skip";
  const dlg = openDialog(`Transfer Project Standards from ${from}`, () => {
    const box = document.createElement("div");
    box.className = "purge";
    for (const c of cats) {
      const lab = document.createElement("label");
      lab.className = "purge-row";
      const cb = Object.assign(document.createElement("input"), { type: "checkbox", checked: picked.has(c) });
      cb.onchange = () => (cb.checked ? picked.add(c) : picked.delete(c));
      lab.append(cb, ` ${LABEL(c)} (${src.byCategory(c).length})`);
      box.append(lab);
    }
    const sel = document.createElement("select");
    sel.append(new Option("Same name here: keep ours (skip)", "skip"), new Option("Same name here: overwrite with theirs", "overwrite"));
    sel.value = mode;
    sel.onchange = () => (mode = sel.value as "skip" | "overwrite");
    const go = Object.assign(document.createElement("button"), { textContent: "Copy" });
    go.onclick = () => {
      try {
        const r = doc.transact("Transfer project standards", (tx) => transferStandards(tx, doc, src, [...picked], mode));
        status(`Transferred: ${r.added} added, ${r.overwritten} overwritten, ${r.skipped} skipped. Ctrl+Z to undo.`);
        changed();
        dlg.close();
      } catch (e) {
        status(`⚠ ${(e as Error).message}`);
      }
    };
    box.append(sel, go);
    return box;
  });
}
