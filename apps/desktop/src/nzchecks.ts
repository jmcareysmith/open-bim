import { H1_CLASS_LABELS, bracingCheck, bracingSettings, drainageCheck, fallLabel, h1Check, setBracingSettings, type Document } from "@open-bim/core";

// NZ Checks pane: H1 energy (schedule method), NZS 3604 bracing and G13 drainage, run over the open model.

export interface NzChecksHost {
  doc: Document;
  select(ids: string[]): void;
}

let tab: "h1" | "bracing" | "drainage" = "h1";

export const el = (tag: string, text = "", cls = ""): HTMLElement => {
  const e = document.createElement(tag);
  e.textContent = text;
  if (cls) e.className = cls;
  return e;
};

export const verdict = (pass: boolean) => el("span", pass ? "✓ Pass" : "✗ Fail", pass ? "pass" : "fail");

function nzTable(head: string[], rows: (string | Node)[][]): HTMLElement {
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

function h1Body(host: NzChecksHost): Node[] {
  const r = h1Check(host.doc);
  const out: Node[] = [
    el("p", `H1/AS1 schedule method, climate zone ${r.zone}. Construction R-values come from type properties; the zone and minimums are in Project Information. Minimums are provisional.`, "muted"),
  ];
  const head = el("p");
  head.append(el("strong", "Overall: "), verdict(r.pass));
  out.push(head);
  out.push(
    nzTable(
      ["Element", "Type", "Area m²", "R", "Min R", ""],
      r.items.map((i) => [H1_CLASS_LABELS[i.cls], i.typeName, i.area.toFixed(1), i.rValue === null ? "not set" : i.rValue.toFixed(2), i.required.toFixed(2), verdict(i.pass)]),
    ),
  );
  out.push(
    nzTable(
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

function bracingBody(host: NzChecksHost): Node[] {
  const { doc } = host;
  const r = bracingCheck(doc);
  const set = bracingSettings(doc);
  const out: Node[] = [
    el("p", `Wind zone ${set.windZone}, earthquake zone ${set.eqZone}. Demand is a provisional first-principles estimate unless you enter the NZS 3604 table value (BU) below. Lines group walls within ${set.lineTolerance} mm.`, "muted"),
  ];
  const head = el("p");
  head.append(el("strong", "Overall: "), verdict(r.pass));
  out.push(head);
  const overrideInput = (levelId: string, key: "windX" | "windY" | "eqX" | "eqY", value: number, overridden: boolean) => {
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.className = "narrow";
    input.placeholder = value.toFixed(0);
    input.value = overridden ? String(Math.round(value)) : "";
    input.title = "NZS 3604 tabulated demand (BU); blank = estimate";
    input.onchange = () => {
      const cur = { ...(set.overrides ?? {}) };
      const lv = { ...(cur[levelId] ?? {}) };
      if (input.value.trim() === "") delete lv[key];
      else lv[key] = Number(input.value);
      cur[levelId] = lv;
      doc.transact("Bracing demand", (tx) => setBracingSettings(tx, doc, { overrides: cur }));
    };
    return input;
  };
  for (const s of r.storeys) {
    const dir = s.direction.toUpperCase() as "X" | "Y";
    const o = set.overrides?.[s.levelId] ?? {};
    out.push(el("h3", `${s.levelName} — ${dir} direction`));
    out.push(
      nzTable(
        ["", "Wind BU", "EQ BU", ""],
        [
          ["Demand", overrideInput(s.levelId, `wind${dir}`, s.demandWind, o[`wind${dir}`] !== undefined), overrideInput(s.levelId, `eq${dir}`, s.demandEq, o[`eq${dir}`] !== undefined), ""],
          ["Capacity", s.capacityWind.toFixed(0), s.capacityEq.toFixed(0), verdict(s.capacityWind >= s.demandWind - 1e-6 && s.capacityEq >= s.demandEq - 1e-6)],
          ["Line spacing", `${(s.maxSpacing / 1000).toFixed(1)} m max`, `limit ${(set.maxLineSpacing / 1000).toFixed(1)} m`, verdict(s.spacingPass)],
        ],
      ),
    );
    const rows = s.lines.map((l, i) => {
      const name = el("a", `Line ${dir}${i + 1} @ ${(l.position / 1000).toFixed(2)} m`);
      name.style.cursor = "pointer";
      name.onclick = () => host.select(l.walls);
      return [name, l.wind.toFixed(0), l.eq.toFixed(0), `min ${l.required.toFixed(0)}`, verdict(l.pass)] as (string | Node)[];
    });
    if (rows.length) out.push(nzTable(["Line", "Wind", "EQ", "Required", ""], rows));
    else out.push(el("p", "No walls run in this direction.", "muted"));
  }
  if (r.notes.length) {
    const ul = el("ul");
    for (const n of r.notes) ul.append(el("li", n));
    out.push(ul);
  }
  return out;
}

/** G13/AS1 drainage: discharge units per drain, capacity, outlet sizes and falls. */
function drainageBody(host: NzChecksHost): Node[] {
  const r = drainageCheck(host.doc);
  const out: Node[] = [
    el("p", "Foul water drains after G13/AS1: discharge units come from the fixtures' sanitary connectors and are added up from each drain's outlet (its lowest open end). Capacities are provisional.", "muted"),
  ];
  const head = el("p");
  head.append(el("strong", "Overall: "), verdict(!r.issues.length));
  out.push(head);
  if (r.issues.length) {
    const ul = el("ul");
    for (const i of r.issues) {
      const a = el("a", i.message);
      a.style.cursor = "pointer";
      a.onclick = () => host.select(i.ids);
      const li = el("li");
      li.append(a);
      ul.append(li);
    }
    out.push(ul);
  }
  if (!r.pipes.length) {
    out.push(el("p", "No sanitary pipes yet: draw them with Systems \u2192 Pipe (system Sanitary).", "muted"));
    return out;
  }
  const rows = [...r.pipes]
    .sort((a, b) => b.units - a.units)
    .map((d) => {
      const name = el("a", `DN${d.dn}`);
      name.style.cursor = "pointer";
      name.onclick = () => host.select([d.pipeId]);
      return [name, d.vertical ? "stack" : fallLabel(d.fall), String(d.units), String(d.capacity), verdict(d.units <= d.capacity)] as (string | Node)[];
    });
  out.push(nzTable(["Drain", "Fall", "Units", "Takes", ""], rows));
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
  tabs.append(mk("h1", "H1 energy"), mk("bracing", "NZS 3604 bracing"), mk("drainage", "G13 drainage"));
  const rerun = el("button", "Re-run") as HTMLButtonElement;
  rerun.onclick = () => renderNzChecks(pane, host);
  const close = el("button", "Close") as HTMLButtonElement;
  close.onclick = () => (pane.hidden = true);
  tabs.append(rerun, close);
  let body: Node[];
  try {
    body = tab === "h1" ? h1Body(host) : tab === "bracing" ? bracingBody(host) : drainageBody(host);
  } catch (err) {
    body = [el("p", `⚠ ${(err as Error).message}`)];
  }
  pane.replaceChildren(el("h2", "NZ Checks"), tabs, ...body);
}
