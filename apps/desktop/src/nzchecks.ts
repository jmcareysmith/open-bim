import { H1_CLASS_LABELS, h1Check, type Document } from "@open-bim/core";

// NZ Checks pane: H1 energy (schedule method) and NZS 3604 bracing, run over the open model.

export interface NzChecksHost {
  doc: Document;
  select(ids: string[]): void;
}

let tab: "h1" | "bracing" = "h1";
const extraTabs = new Map<string, (host: NzChecksHost) => Node[]>();

/** Register another tab's body (bracing adds itself). */
export function registerNzTab(name: "bracing", render: (host: NzChecksHost) => Node[]): void {
  extraTabs.set(name, render);
}

export const el = (tag: string, text = "", cls = ""): HTMLElement => {
  const e = document.createElement(tag);
  e.textContent = text;
  if (cls) e.className = cls;
  return e;
};

export const verdict = (pass: boolean) => el("span", pass ? "✓ Pass" : "✗ Fail", pass ? "pass" : "fail");

function table(head: string[], rows: (string | Node)[][]): HTMLElement {
  const t = el("table");
  const hr = el("tr");
  for (const h of head) hr.append(el("th", h));
  t.append(hr);
  for (const r of rows) {
    const tr = el("tr");
    for (const c of r) {
      const td = el("td");
      td.append(c);
      tr.append(td);
    }
    t.append(tr);
  }
  return t;
}
export { table as nzTable };

function h1Body(host: NzChecksHost): Node[] {
  const r = h1Check(host.doc);
  const out: Node[] = [
    el("p", `H1/AS1 schedule method, climate zone ${r.zone}. Construction R-values come from type properties; the zone and minimums are in Project Information. Minimums are provisional.`, "muted"),
  ];
  const head = el("p");
  head.append(el("strong", "Overall: "), verdict(r.pass));
  out.push(head);
  out.push(
    table(
      ["Element", "Type", "Area m²", "R", "Min R", ""],
      r.items.map((i) => [H1_CLASS_LABELS[i.cls], i.typeName, i.area.toFixed(1), i.rValue === null ? "not set" : i.rValue.toFixed(2), i.required.toFixed(2), verdict(i.pass)]),
    ),
  );
  out.push(
    table(
      ["Glazing", "", ""],
      [
        ["Exterior wall area", `${r.wallArea.toFixed(1)} m²`, ""],
        ["Glazing area", `${r.glazingArea.toFixed(1)} m²`, ""],
        ["Glazing share", `${(r.glazingRatio * 100).toFixed(1)}% (max ${(r.maxGlazingRatio * 100).toFixed(0)}%)`, verdict(r.glazingPass)],
      ],
    ),
  );
  if (r.notes.length) {
    const ul = el("ul");
    for (const n of r.notes) ul.append(el("li", n));
    out.push(ul);
  }
  return out;
}

export function renderNzChecks(pane: HTMLElement, host: NzChecksHost): void {
  const tabs = el("div", "", "buttons");
  const mk = (id: typeof tab, label: string) => {
    const b = el("button", label) as HTMLButtonElement;
    if (tab === id) b.className = "active";
    b.onclick = () => {
      tab = id;
      renderNzChecks(pane, host);
    };
    return b;
  };
  tabs.append(mk("h1", "H1 energy"), mk("bracing", "NZS 3604 bracing"));
  const rerun = el("button", "Re-run") as HTMLButtonElement;
  rerun.onclick = () => renderNzChecks(pane, host);
  const close = el("button", "Close") as HTMLButtonElement;
  close.onclick = () => (pane.hidden = true);
  tabs.append(rerun, close);
  let body: Node[];
  try {
    body = tab === "h1" ? h1Body(host) : (extraTabs.get(tab)?.(host) ?? [el("p", "Not available.")]);
  } catch (err) {
    body = [el("p", `⚠ ${(err as Error).message}`)];
  }
  pane.replaceChildren(el("h2", "NZ Checks"), tabs, ...body);
}
