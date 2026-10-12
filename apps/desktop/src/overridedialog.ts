import {
  LINE_PATTERNS,
  PATTERNS,
  setCategoryOverride,
  setElementOverrides,
  type Document,
  type ElementId,
  type FillOverride,
  type GraphicOverride,
  type LineOverride,
  type PatternOverride,
  type ViewGraphicsParams,
  type ViewParams,
} from "@open-bim/core";
import { openDialog } from "./dialog.ts";

// Override Graphics in View (Revit): by element or by category. Visible, halftone, transparency,
// projection/cut lines (pattern, colour, weight) and surface/cut patterns (foreground and
// background: visible, pattern, colour). Blank fields leave the setting as it is ("<By Category>").

export interface OverrideTarget {
  kind: "element" | "category";
  viewId: ElementId;
  /** Elements (By Element) or the category name (By Category). */
  ids?: ElementId[];
  category?: string;
}

const LINE_LABEL: Record<string, string> = { solid: "Solid", dash: "Dashed", dot: "Dotted", dashDot: "Dash-dot", longDash: "Long dash" };
const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** A select whose first option means "not overridden". */
function pick(options: [string, string][], value: string | null | undefined, onChange: (v: string | null) => void, none = "<By Category>"): HTMLSelectElement {
  const s = document.createElement("select");
  s.append(new Option(none, ""));
  for (const [v, l] of options) s.append(new Option(l, v, false, v === value));
  if (value === null || value === undefined) s.value = "";
  s.onchange = () => onChange(s.value || null);
  return s;
}

/** Colour swatch with a "clear" button. */
function colour(value: number | null | undefined, onChange: (v: number | null) => void): HTMLElement {
  const box = el("span", "ovr-colour");
  const input = document.createElement("input");
  input.type = "color";
  input.value = value !== null && value !== undefined ? hex(value) : "#000000";
  input.classList.toggle("unset", value === null || value === undefined);
  input.oninput = () => {
    input.classList.remove("unset");
    onChange(parseInt(input.value.slice(1), 16));
  };
  const clear = el("button", "ovr-clear", "×");
  clear.title = "By category";
  clear.onclick = () => {
    input.classList.add("unset");
    onChange(null);
  };
  box.append(input, clear);
  return box;
}

function tri(label: string, value: boolean | undefined, onChange: (v: boolean | undefined) => void): HTMLElement {
  // Three states: unset (by category), on, off.
  const s = pick(
    [
      ["on", "Yes"],
      ["off", "No"],
    ],
    value === undefined ? null : value ? "on" : "off",
    (v) => onChange(v === null ? undefined : v === "on"),
  );
  const row = el("label", "ovr-row");
  row.append(el("span", "", label), s);
  return row;
}

function lineGroup(title: string, o: LineOverride | undefined, set: (o: LineOverride | undefined) => void): HTMLElement {
  const cur: LineOverride = { ...(o ?? {}) };
  const commit = () => set(Object.values(cur).some((v) => v !== undefined) ? cur : undefined);
  const g = el("fieldset", "ovr-group");
  g.append(el("legend", "", title));
  const row = (label: string, control: HTMLElement) => {
    const r = el("label", "ovr-row");
    r.append(el("span", "", label), control);
    g.append(r);
  };
  row("Pattern", pick(LINE_PATTERNS.map((p) => [p, LINE_LABEL[p]!]), cur.pattern, (v) => ((cur.pattern = (v as LineOverride["pattern"]) ?? undefined), commit())));
  row("Colour", colour(cur.color, (v) => ((cur.color = v ?? undefined), commit())));
  row("Weight", pick(Array.from({ length: 16 }, (_, i) => [String(i + 1), String(i + 1)]), cur.weight ? String(cur.weight) : null, (v) => ((cur.weight = v ? Number(v) : undefined), commit())));
  return g;
}

function fillLayer(title: string, o: FillOverride | undefined, set: (o: FillOverride | undefined) => void): HTMLElement {
  const cur: FillOverride = { ...(o ?? {}) };
  const commit = () => set(Object.values(cur).some((v) => v !== undefined) ? cur : undefined);
  const g = el("div", "ovr-layer");
  g.append(el("div", "ovr-sub", title));
  g.append(tri("Visible", cur.visible, (v) => ((cur.visible = v), commit())));
  const pr = el("label", "ovr-row");
  pr.append(el("span", "", "Pattern"), pick(PATTERNS.filter((p) => p !== "none").map((p) => [p, p === "solid" ? "Solid fill" : p]), cur.pattern, (v) => ((cur.pattern = v ?? undefined), commit())));
  g.append(pr);
  const cr = el("label", "ovr-row");
  cr.append(el("span", "", "Colour"), colour(cur.color, (v) => ((cur.color = v ?? undefined), commit())));
  g.append(cr);
  return g;
}

function patternGroup(title: string, o: PatternOverride | undefined, set: (o: PatternOverride | undefined) => void): HTMLElement {
  const cur: PatternOverride = { ...(o ?? {}) };
  const commit = () => set(cur.foreground || cur.background ? cur : undefined);
  const g = el("fieldset", "ovr-group");
  g.append(el("legend", "", title));
  g.append(
    fillLayer("Foreground", cur.foreground, (v) => ((cur.foreground = v), commit())),
    fillLayer("Background", cur.background, (v) => ((cur.background = v), commit())),
  );
  return g;
}

/** The override as it stands now for the target (element: the first element's; category: the owner's). */
function current(doc: Document, t: OverrideTarget): GraphicOverride {
  const v = doc.require<ViewParams>(t.viewId);
  if (t.kind === "element") return structuredClone(v.params.elementOverrides?.[t.ids![0]!] ?? {});
  const owner = v.params.templateId && doc.get(v.params.templateId) ? doc.require(v.params.templateId) : v;
  const g = owner.params as ViewGraphicsParams;
  const o = structuredClone(g.categoryOverrides?.[t.category!] ?? {});
  if (g.hiddenCategories.includes(t.category!)) o.visible = false;
  return o;
}

export function openOverrideDialog(doc: Document, t: OverrideTarget, status: (s: string) => void): void {
  let draft: GraphicOverride = current(doc, t);
  const title =
    t.kind === "element"
      ? `Override Graphics in View — ${t.ids!.length === 1 ? "Element" : `${t.ids!.length} Elements`}`
      : `Override Graphics in View — Category: ${t.category}`;
  let dlg: { refresh(): void; close(): void } | null = null;
  const render = () => {
    const box = el("div", "ovr");
    const set = <K extends keyof GraphicOverride>(k: K, v: GraphicOverride[K] | undefined) => {
      if (v === undefined) delete draft[k];
      else draft[k] = v;
    };
    const top = el("fieldset", "ovr-group");
    top.append(el("legend", "", "General"));
    top.append(tri("Visible", draft.visible, (v) => set("visible", v)), tri("Halftone", draft.halftone, (v) => set("halftone", v)));
    const tr = el("label", "ovr-row");
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = String(draft.transparency ?? 0);
    const pct = document.createElement("input");
    pct.type = "number";
    pct.min = "0";
    pct.max = "100";
    pct.value = slider.value;
    pct.className = "ovr-pct";
    slider.oninput = () => ((pct.value = slider.value), set("transparency", Number(slider.value) || undefined));
    pct.oninput = () => ((slider.value = pct.value), set("transparency", Math.max(0, Math.min(100, Number(pct.value))) || undefined));
    tr.append(el("span", "", "Transparency"), slider, pct, el("span", "muted", "%"));
    top.append(tr);
    box.append(
      top,
      lineGroup("Projection Lines", draft.projectionLines, (v) => set("projectionLines", v)),
      patternGroup("Surface Patterns", draft.surfacePatterns, (v) => set("surfacePatterns", v)),
      lineGroup("Cut Lines", draft.cutLines, (v) => set("cutLines", v)),
      patternGroup("Cut Patterns", draft.cutPatterns, (v) => set("cutPatterns", v)),
    );
    const buttons = el("div", "ovr-buttons");
    const reset = el("button", "", "Reset");
    reset.title = "Clear every override";
    reset.onclick = () => {
      draft = {};
      dlg?.refresh();
    };
    const cancel = el("button", "", "Cancel");
    cancel.onclick = () => dlg?.close();
    const ok = el("button", "primary", "OK");
    ok.onclick = () => {
      try {
        const o = Object.keys(draft).length ? draft : null;
        doc.transact(title, (tx) =>
          t.kind === "element" ? setElementOverrides(tx, doc, t.viewId, t.ids!, o) : setCategoryOverride(tx, doc, t.viewId, t.category!, o ?? { visible: true }),
        );
        status(o ? "Graphics overridden in this view." : "Overrides cleared.");
        dlg?.close();
      } catch (e) {
        status(`⚠ ${(e as Error).message}`);
      }
    };
    buttons.append(reset, el("span", "ovr-gap"), cancel, ok);
    box.append(buttons);
    return box;
  };
  dlg = openDialog(title, render);
}
