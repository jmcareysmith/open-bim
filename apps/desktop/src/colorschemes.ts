import {
  COLOR_SCHEME_BY,
  Cat,
  autoSchemeColor,
  colorSchemes,
  createColorScheme,
  schemeValue,
  setColorSchemeEntry,
  type Area,
  type ColorScheme,
  type ColorSchemeBy,
  type ColorSchemeParams,
  type Document,
  type ElementId,
  type Room,
} from "@open-bim/core";
import { areaBoundary, roomBoundary } from "@open-bim/geometry";
import { openDialog } from "./dialog.ts";

// Edit Color Scheme (Revit: Architecture → Room & Area ▾ → Color Schemes, or the view's Color
// Scheme property): schemes for rooms or areas, each colouring by a value; the values in use with
// their colours, and whether each shows. A plan picks a scheme in its Properties.

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

/** Every value the project's rooms (or areas) have for a scheme. */
function valuesInUse(doc: Document, s: ColorScheme): string[] {
  const els = s.params.category === "Room" ? doc.byCategory(Cat.Room) : doc.byCategory(Cat.Area);
  const vals = els.map((el) => {
    if (s.params.by !== "area") return schemeValue(s, el);
    const b = el.category === Cat.Room ? roomBoundary(doc, el as Room) : areaBoundary(doc, el as Area);
    return schemeValue(s, el, b ? b.area / 1e6 : null);
  });
  return [...new Set(vals.filter(Boolean))];
}

export function openColorSchemes(doc: Document, status: (s: string) => void, category: "Room" | "Area" = "Room", pick?: ElementId | null): void {
  let current: ElementId | null = pick ?? colorSchemes(doc, category)[0]?.id ?? null;
  let dlg: { refresh(): void; close(): void } | null = null;
  const off = doc.on(() => dlg?.refresh());
  const run = (name: string, fn: Parameters<Document["transact"]>[1]) => {
    try {
      doc.transact(name, fn);
    } catch (e) {
      status(`⚠ ${(e as Error).message}`);
    }
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = (tag: string, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): any => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e;
  };
  dlg = openDialog(
    "Edit Color Scheme",
    () => {
      const box = el("div", { className: "cs" });
      const schemes = colorSchemes(doc, category);
      if (current && !doc.get(current)) current = schemes[0]?.id ?? null;
      // Left: the schemes, with New / Duplicate / Delete.
      const list = el("div", { className: "cs-list" });
      const cat = el("select");
      for (const c of ["Room", "Area"] as const) cat.append(new Option(c === "Room" ? "Rooms" : "Areas", c, false, c === category));
      cat.onchange = () => {
        category = cat.value as "Room" | "Area";
        current = colorSchemes(doc, category)[0]?.id ?? null;
        dlg?.refresh();
      };
      list.append(el("label", { className: "cs-cat" }, "Category ", cat));
      for (const s of schemes) {
        const b = el("button", { className: `cs-item${s.id === current ? " active" : ""}`, textContent: s.name ?? "Scheme" });
        b.onclick = () => {
          current = s.id;
          dlg?.refresh();
        };
        list.append(b);
      }
      const newBy = el("select");
      for (const o of COLOR_SCHEME_BY.filter((o) => category === "Room" || o.value === "name" || o.value === "area")) newBy.append(new Option(`New: by ${o.label}`, o.value));
      const add = el("button", { textContent: "New" });
      add.onclick = () => {
        const by = newBy.value as ColorSchemeBy;
        const label = COLOR_SCHEME_BY.find((o) => o.value === by)!.label.replace(" (ranges)", "");
        run("New colour scheme", (tx) => {
          current = createColorScheme(tx, `Scheme by ${label}`, { category, by }).id;
        });
      };
      const cur = current ? (doc.get(current) as ColorScheme | undefined) : undefined;
      const dup = el("button", { textContent: "Duplicate", disabled: !cur });
      dup.onclick = () =>
        cur &&
        run("Duplicate colour scheme", (tx) => {
          current = createColorScheme(tx, `${cur.name ?? "Scheme"} 2`, { ...cur.params, entries: cur.params.entries.map((e) => ({ ...e })) }).id;
        });
      const del = el("button", { textContent: "Delete", disabled: !cur });
      del.onclick = () =>
        cur &&
        run("Delete colour scheme", (tx) => {
          // Plans using it go back to no scheme.
          for (const v of doc.byCategory(Cat.View)) if ((v.params as { colorScheme?: string | null }).colorScheme === cur.id) tx.update(v.id, { colorScheme: null });
          tx.delete(cur.id);
          current = null;
        });
      list.append(el("div", { className: "buttons wrap" }, newBy, add, dup, del));
      box.append(list);

      // Right: the scheme's settings and its values.
      const right = el("div", { className: "cs-body" });
      if (!cur) {
        right.append(el("p", { className: "muted", textContent: "No colour schemes yet: pick what to colour by and click New." }));
      } else {
        const set = (patch: Partial<ColorSchemeParams>) => run("Edit colour scheme", (tx) => tx.update<ColorSchemeParams>(cur.id, patch));
        const name = el("input", { value: cur.name ?? "" });
        name.onchange = () => run("Rename colour scheme", (tx) => tx.setName(cur.id, name.value || undefined));
        const title = el("input", { value: cur.params.title });
        title.onchange = () => set({ title: title.value });
        const by = el("select");
        for (const o of COLOR_SCHEME_BY.filter((o) => category === "Room" || o.value === "name" || o.value === "area")) by.append(new Option(o.label, o.value, false, o.value === cur.params.by));
        by.onchange = () => set({ by: by.value as ColorSchemeBy, entries: [] });
        right.append(el("label", { className: "dlg-field" }, el("span", { textContent: "Name" }), name), el("label", { className: "dlg-field" }, el("span", { textContent: "Title" }), title), el("label", { className: "dlg-field" }, el("span", { textContent: "Colour by" }), by));
        if (cur.params.by === "area") {
          const step = el("input", { type: "number", min: "1", value: String(cur.params.rangeStep ?? 10) });
          step.onchange = () => Number(step.value) > 0 && set({ rangeStep: Number(step.value), entries: [] });
          right.append(el("label", { className: "dlg-field" }, el("span", { textContent: "Range (m²)" }), step));
        }
        const table = el("table", { className: "cs-table" });
        table.append(el("tr", {}, el("th", { textContent: "Value" }), el("th", { textContent: "Colour" }), el("th", { textContent: "Visible" })));
        const values = [...new Set([...cur.params.entries.map((e) => e.value), ...valuesInUse(doc, cur)])];
        const inUse = new Set(valuesInUse(doc, cur));
        for (const v of values) {
          const e = cur.params.entries.find((x) => x.value === v);
          const col = el("input", { type: "color", value: hex(e?.color ?? autoSchemeColor(v)) });
          col.onchange = () => run("Scheme colour", (tx) => setColorSchemeEntry(tx, doc, cur.id, v, { color: parseInt(col.value.slice(1), 16) }));
          const vis = el("input", { type: "checkbox", checked: e?.visible !== false });
          vis.onchange = () => run("Scheme visibility", (tx) => setColorSchemeEntry(tx, doc, cur.id, v, { visible: vis.checked }));
          table.append(el("tr", { className: inUse.has(v) ? "" : "unused" }, el("td", { textContent: v }), el("td", {}, col), el("td", {}, vis)));
        }
        if (!values.length) right.append(el("p", { className: "muted", textContent: "No rooms have a value for this yet." }));
        right.append(table, el("p", { className: "muted", textContent: "Values in use get a colour automatically; change one to keep it. Pick the scheme in a plan's Properties (Colour scheme)." }));
      }
      box.append(right);
      return box;
    },
    () => off(),
  );
}
