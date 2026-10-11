import {
  Cat,
  levels,
  totalThickness,
  wallLength,
  wallThickness,
  type Document,
  type Element,
  type ElementId,
  type FloorParams,
  type LayeredTypeParams,
  type LevelParams,
  type Params,
  type Wall,
  type WallParams,
} from "@open-bim/core";

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: cls, ...rest } = props;
  Object.assign(el, rest);
  if (cls) el.className = cls;
  for (const c of children) if (c) el.append(c);
  return el;
}

export interface PanelContext {
  doc: Document;
  selection(): ElementId[];
  setSelection(ids: ElementId[]): void;
  activeLevelId(): ElementId;
  setActiveLevel(id: ElementId): void;
  status(text: string): void;
}

/** Run an edit, surfacing validation errors in the status bar instead of throwing. */
function edit(ctx: PanelContext, name: string, fn: Parameters<Document["transact"]>[1]): void {
  try {
    ctx.doc.transact(name, fn);
  } catch (err) {
    ctx.status(`⚠ ${(err as Error).message}`);
  }
}

const row = (label: string, control: Node | string) =>
  h("div", { class: "row" }, h("span", {}, label), typeof control === "string" ? h("span", { class: "value" }, control) : control);

function numberInput(value: number, onCommit: (v: number) => void): HTMLInputElement {
  const input = h("input", { type: "number", step: "10", value: String(Math.round(value)) });
  input.onchange = () => {
    const v = Number(input.value);
    if (Number.isFinite(v)) onCommit(v);
  };
  return input;
}

function textInput(value: string, onCommit: (v: string) => void): HTMLInputElement {
  const input = h("input", { type: "text", value });
  input.onchange = () => onCommit(input.value.trim());
  return input;
}

function select(options: { value: string; label: string }[], value: string, onChange: (v: string) => void) {
  const s = h("select");
  for (const o of options) s.append(h("option", { value: o.value, textContent: o.label, selected: o.value === value }));
  s.onchange = () => onChange(s.value);
  return s;
}

// ---- Project browser ------------------------------------------------------

export function renderBrowser(root: HTMLElement, ctx: PanelContext): void {
  const { doc } = ctx;
  const sel = new Set(ctx.selection());
  const item = (el: Element, right: string, onClick: () => void, active = false) => {
    const div = h(
      "div",
      { class: `list-item${sel.has(el.id) || active ? " selected" : ""}` },
      h("span", {}, el.name ?? el.category),
      h("span", { class: "muted" }, right),
    );
    div.onclick = onClick;
    return div;
  };

  const lv = h("div", { class: "section" }, h("h3", {}, "Levels"));
  for (const l of levels(doc)) {
    lv.append(
      item(l, `${l.params.elevation} mm`, () => {
        ctx.setActiveLevel(l.id);
        ctx.setSelection([l.id]);
      }, l.id === ctx.activeLevelId()),
    );
  }

  const types = h("div", { class: "section" }, h("h3", {}, "Types"));
  for (const cat of [Cat.WallType, Cat.FloorType]) {
    for (const t of doc.byCategory<LayeredTypeParams>(cat)) {
      types.append(item(t, `${totalThickness(t)} mm`, () => ctx.setSelection([t.id])));
    }
  }

  const counts = h("div", { class: "section" }, h("h3", {}, "Model"));
  counts.append(row("Walls", String(doc.byCategory(Cat.Wall).length)));
  counts.append(row("Floors", String(doc.byCategory(Cat.Floor).length)));

  root.replaceChildren(lv, types, counts);
}

// ---- Properties -----------------------------------------------------------

export function renderProperties(root: HTMLElement, ctx: PanelContext): void {
  const { doc } = ctx;
  const ids = ctx.selection().filter((id) => doc.has(id));
  if (ids.length === 0) {
    root.replaceChildren(h("div", { class: "empty" }, "Nothing selected"));
    return;
  }
  if (ids.length > 1) {
    root.replaceChildren(h("div", { class: "empty" }, `${ids.length} elements selected`));
    return;
  }
  const el = doc.require(ids[0]!);
  const levelOpts = levels(doc).map((l) => ({ value: l.id, label: l.name ?? l.id }));
  const typeOpts = (cat: string) => doc.byCategory(cat).map((t) => ({ value: t.id, label: t.name ?? t.id }));
  const update = <P extends Params>(name: string, patch: Partial<P>) =>
    edit(ctx, name, (tx) => tx.update<P>(el.id, patch));

  const sec = h("div", { class: "section" }, h("h3", {}, el.category));

  switch (el.category) {
    case Cat.Level: {
      const p = el.params as LevelParams;
      sec.append(
        row("Name", textInput(el.name ?? "", (v) => edit(ctx, "Rename level", (tx) => tx.setName(el.id, v || undefined)))),
        row("Elevation", numberInput(p.elevation, (v) => update<LevelParams>("Change level elevation", { elevation: v }))),
      );
      break;
    }
    case Cat.Wall: {
      const w = el as Wall;
      const p = w.params;
      sec.append(
        row("Type", select(typeOpts(Cat.WallType), w.typeId ?? "", (v) => edit(ctx, "Change wall type", (tx) => tx.setType(w.id, v)))),
        row("Base level", select(levelOpts, p.baseLevelId, (v) => update<WallParams>("Change base level", { baseLevelId: v }))),
        row("Base offset", numberInput(p.baseOffset, (v) => update<WallParams>("Change base offset", { baseOffset: v }))),
        row(
          "Top constraint",
          select([{ value: "", label: "Unconnected" }, ...levelOpts], p.topLevelId ?? "", (v) =>
            update<WallParams>("Change top constraint", { topLevelId: v || null }),
          ),
        ),
        p.topLevelId
          ? row("Top offset", numberInput(p.topOffset, (v) => update<WallParams>("Change top offset", { topOffset: v })))
          : row("Unconnected height", numberInput(p.height, (v) => update<WallParams>("Change wall height", { height: v }))),
        row("Length", `${Math.round(wallLength(w))} mm`),
        row("Thickness", `${wallThickness(doc, w)} mm`),
      );
      break;
    }
    case Cat.Floor: {
      const p = el.params as FloorParams;
      sec.append(
        row("Type", select(typeOpts(Cat.FloorType), el.typeId ?? "", (v) => edit(ctx, "Change floor type", (tx) => tx.setType(el.id, v)))),
        row("Level", select(levelOpts, p.levelId, (v) => update<FloorParams>("Change floor level", { levelId: v }))),
        row("Height offset", numberInput(p.offset, (v) => update<FloorParams>("Change floor offset", { offset: v }))),
      );
      break;
    }
    case Cat.WallType:
    case Cat.FloorType: {
      const t = el as Element<LayeredTypeParams>;
      sec.append(
        row("Name", textInput(el.name ?? "", (v) => edit(ctx, "Rename type", (tx) => tx.setName(el.id, v || undefined)))),
        row("Total", `${totalThickness(t)} mm`),
      );
      t.params.layers.forEach((layer, i) => {
        sec.append(
          row(
            `${i + 1}. ${layer.material}`,
            numberInput(layer.thickness, (v) => {
              const layers = t.params.layers.map((l, j) => (j === i ? { ...l, thickness: Math.max(0, v) } : l));
              update<LayeredTypeParams>("Edit layer thickness", { layers });
            }),
          ),
        );
      });
      break;
    }
  }

  const del = h("button", { class: "danger", textContent: "Delete" });
  del.onclick = () => edit(ctx, `Delete ${el.category}`, (tx) => tx.delete(el.id));
  root.replaceChildren(sec, h("div", { class: "section" }, del));
}
