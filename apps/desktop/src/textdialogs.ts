import { Cat, findText, replaceText, type Document, type ElementId, type TextNoteParams } from "@open-bim/core";
import { openDialog } from "./dialog.ts";

// Annotate → Text: Find/Replace across text notes, and Check Spelling (the system spell checker,
// NZ English, underlines mistakes in each note; fix them in place).

export interface TextDialogHost {
  doc: Document;
  activeViewId(): ElementId | undefined;
  setActiveView(id: ElementId): void;
  setSelection(ids: ElementId[]): void;
  status(text: string): void;
}

const field = (label: string, input: HTMLElement) => {
  const l = document.createElement("label");
  l.className = "dlg-field";
  l.append(Object.assign(document.createElement("span"), { textContent: label }), input);
  return l;
};
const check = (label: string) => {
  const i = Object.assign(document.createElement("input"), { type: "checkbox" });
  const l = document.createElement("label");
  l.className = "dlg-check";
  l.append(i, ` ${label}`);
  return [l, i] as const;
};
const viewName = (doc: Document, id: ElementId) => doc.get(id)?.name ?? "view";

export function openFindReplace(host: TextDialogHost): void {
  const { doc } = host;
  const find = Object.assign(document.createElement("input"), { type: "text", placeholder: "Find what" });
  const repl = Object.assign(document.createElement("input"), { type: "text", placeholder: "Replace with" });
  const [caseL, caseI] = check("Match case");
  const [wordL, wordI] = check("Whole words only");
  const [viewL, viewI] = check("This view only");
  const results = document.createElement("div");
  results.className = "dlg-results";
  const opts = () => ({ matchCase: caseI.checked, wholeWord: wordI.checked, ...(viewI.checked && host.activeViewId() ? { viewId: host.activeViewId()! } : {}) });
  const list = () => {
    const hits = findText(doc, find.value, opts());
    results.replaceChildren(
      Object.assign(document.createElement("div"), { className: "muted", textContent: find.value ? `${hits.reduce((n, h) => n + h.count, 0)} match(es) in ${hits.length} note(s)` : "Type something to find." }),
      ...hits.map((h) => {
        const row = document.createElement("div");
        row.className = "list-item";
        row.title = "Show this note";
        row.append(Object.assign(document.createElement("span"), { textContent: h.text }), Object.assign(document.createElement("span"), { className: "muted", textContent: viewName(doc, h.viewId) }));
        row.onclick = () => {
          host.setActiveView(h.viewId);
          host.setSelection([h.id]);
        };
        return row;
      }),
    );
  };
  for (const i of [find, caseI, wordI, viewI]) i.oninput = list;
  const all = Object.assign(document.createElement("button"), { textContent: "Replace All", className: "primary" });
  all.onclick = () => {
    if (!find.value) return;
    try {
      const n = doc.transact("Find/Replace", (tx) => replaceText(tx, doc, find.value, repl.value, opts()));
      host.status(`Replaced ${n} match(es).`);
    } catch (e) {
      host.status(`⚠ ${(e as Error).message}`);
    }
    list();
  };
  const body = document.createElement("div");
  body.className = "dlg-form";
  body.append(field("Find", find), field("Replace with", repl), Object.assign(document.createElement("div"), { className: "dlg-row" }), results);
  body.children[2]!.append(caseL, wordL, viewL, all);
  openDialog("Find/Replace (text notes)", () => body);
  list();
  find.focus();
}

export function openSpelling(host: TextDialogHost): void {
  const { doc } = host;
  const render = () => {
    const notes = doc.byCategory<TextNoteParams>(Cat.TextNote);
    const box = document.createElement("div");
    box.className = "dlg-form";
    box.append(
      Object.assign(document.createElement("p"), {
        className: "muted",
        textContent: notes.length ? "Misspelt words are underlined (system spell checker, NZ English). Right-click a word for suggestions; changes save when you leave the box." : "There are no text notes in this project.",
      }),
    );
    for (const n of notes) {
      const ta = document.createElement("textarea");
      ta.spellcheck = true;
      ta.lang = "en-NZ";
      ta.value = n.params.text;
      ta.rows = Math.min(6, Math.max(2, n.params.text.split("\n").length));
      ta.onkeydown = (ev) => ev.stopPropagation();
      ta.onchange = () => {
        if (ta.value === n.params.text) return;
        if (!ta.value.trim()) return host.status("⚠ Text can't be empty.");
        doc.transact("Edit text (spelling)", (tx) => tx.update<TextNoteParams>(n.id, { text: ta.value }));
      };
      const show = Object.assign(document.createElement("button"), { textContent: viewName(doc, n.params.viewId), title: "Show this note" });
      show.onclick = () => {
        host.setActiveView(n.params.viewId);
        host.setSelection([n.id]);
      };
      const row = document.createElement("div");
      row.className = "dlg-note";
      row.append(ta, show);
      box.append(row);
    }
    return box;
  };
  openDialog("Check Spelling", render);
}
