import {
  Cat,
  levels,
  regionArea,
  validateHosted,
  doorPlacement,
  hostedPlacement,
  windowPlacement,
  roofBaseElevation,
  renameGrid,
  renameReferencePlane,
  totalThickness,
  wallLength,
  wallThickness,
  type Document,
  type Element,
  type ElementId,
  type CeilingParams,
  type HostedParams,
  type DoorParams,
  type DoorTypeParams,
  type WindowParams,
  type WindowTypeParams,
  type Transaction,
  type Roof,
  type RoofParams,
  type FloorParams,
  type GridParams,
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
  /** Re-sketch a floor or ceiling boundary. */
  editBoundary(id: ElementId): void;
  viewMode(): "3d" | "plan";
  setViewMode(mode: "3d" | "plan"): void;
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

/** Slope in degrees; empty = no slope. Stored as radians. */
function slopeInput(rad: number | null, onCommit: (v: number | null) => void): HTMLInputElement {
  const input = h("input", { type: "number", step: "0.5", min: "0", max: "89", value: rad === null ? "" : (rad * 180 / Math.PI).toFixed(1) });
  input.onchange = () => {
    if (input.value.trim() === "") return onCommit(null);
    const d = Number(input.value);
    if (Number.isFinite(d) && d > 0 && d < 90) onCommit((d * Math.PI) / 180);
  };
  return input;
}

function editBoundaryButton(ctx: PanelContext, id: ElementId): HTMLElement {
  const b = h("button", { textContent: "Edit boundary" });
  b.onclick = () => ctx.editBoundary(id);
  return h("div", { class: "row" }, h("span", {}), b);
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

  // Views: Revit-style "Floor Plans" per level plus the default 3D view.
  const views = h("div", { class: "section" }, h("h3", {}, "Views"));
  const viewItem = (label: string, active: boolean, onClick: () => void) => {
    const div = h("div", { class: `list-item${active ? " selected" : ""}` }, h("span", {}, label));
    div.onclick = onClick;
    return div;
  };
  for (const l of levels(doc)) {
    const active = ctx.viewMode() === "plan" && l.id === ctx.activeLevelId();
    views.append(
      viewItem(`Floor Plan: ${l.name ?? l.id}`, active, () => {
        ctx.setActiveLevel(l.id);
        ctx.setViewMode("plan");
      }),
    );
  }
  views.append(viewItem("3D View", ctx.viewMode() === "3d", () => ctx.setViewMode("3d")));

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
  for (const cat of [Cat.WallType, Cat.FloorType, Cat.CeilingType, Cat.RoofType]) {
    for (const t of doc.byCategory<LayeredTypeParams>(cat)) {
      types.append(item(t, `${totalThickness(t)} mm`, () => ctx.setSelection([t.id])));
    }
  }
  for (const t of doc.byCategory<DoorTypeParams>(Cat.DoorType)) {
    types.append(item(t, `${t.params.leafWidth} \u00d7 ${t.params.leafHeight}`, () => ctx.setSelection([t.id])));
  }
  for (const t of doc.byCategory<WindowTypeParams>(Cat.WindowType)) {
    types.append(item(t, `${t.params.width} \u00d7 ${t.params.height}`, () => ctx.setSelection([t.id])));
  }

  const counts = h("div", { class: "section" }, h("h3", {}, "Model"));
  counts.append(row("Walls", String(doc.byCategory(Cat.Wall).length)));
  counts.append(row("Floors", String(doc.byCategory(Cat.Floor).length)));
  counts.append(row("Ceilings", String(doc.byCategory(Cat.Ceiling).length)));
  counts.append(row("Roofs", String(doc.byCategory(Cat.Roof).length)));
  counts.append(row("Doors", String(doc.byCategory(Cat.Door).length)));
  counts.append(row("Windows", String(doc.byCategory(Cat.Window).length)));
  counts.append(row("Openings", String(doc.byCategory(Cat.WallOpening).length)));
  counts.append(row("Grids", String(doc.byCategory(Cat.Grid).length)));
  counts.append(row("Reference planes", String(doc.byCategory(Cat.ReferencePlane).length)));

  root.replaceChildren(views, lv, types, counts);
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
        row("Area", `${(regionArea(p) / 1e6).toFixed(2)} m²`),
        editBoundaryButton(ctx, el.id),
      );
      break;
    }
    case Cat.Ceiling: {
      const p = el.params as CeilingParams;
      sec.append(
        row("Type", select(typeOpts(Cat.CeilingType), el.typeId ?? "", (v) => edit(ctx, "Change ceiling type", (tx) => tx.setType(el.id, v)))),
        row("Level", select(levelOpts, p.levelId, (v) => update<CeilingParams>("Change ceiling level", { levelId: v }))),
        row("Height offset", numberInput(p.offset, (v) => update<CeilingParams>("Change ceiling height", { offset: v }))),
        row("Area", `${(regionArea(p) / 1e6).toFixed(2)} m²`),
        editBoundaryButton(ctx, el.id),
      );
      break;
    }
    case Cat.Grid: {
      const { start, end } = el.params as GridParams;
      sec.append(
        row("Name", textInput(el.name ?? "", (v) => edit(ctx, "Rename grid", (tx) => renameGrid(tx, doc, el.id, v)))),
        row("Length", `${Math.round(Math.hypot(end.x - start.x, end.y - start.y))} mm`),
      );
      break;
    }
    case Cat.ReferencePlane: {
      const { start, end } = el.params as GridParams;
      sec.append(
        row(
          "Name",
          textInput(el.name ?? "", (v) => edit(ctx, "Rename reference plane", (tx) => renameReferencePlane(tx, doc, el.id, v))),
        ),
        row("Length", `${Math.round(Math.hypot(end.x - start.x, end.y - start.y))} mm`),
      );
      break;
    }
    case Cat.Roof: {
      const r = el as Roof;
      const p = r.params;
      const setSlopes = (slopes: (number | null)[]) => update<RoofParams>("Change roof slope", { slopes });
      const sloped = p.slopes.filter((s): s is number => s !== null);
      sec.append(
        row("Type", select(typeOpts(Cat.RoofType), el.typeId ?? "", (v) => edit(ctx, "Change roof type", (tx) => tx.setType(el.id, v)))),
        row("Base level", select(levelOpts, p.levelId, (v) => update<RoofParams>("Change roof level", { levelId: v }))),
        row("Base offset", numberInput(p.baseOffset, (v) => update<RoofParams>("Change roof offset", { baseOffset: v }))),
        row("Base elevation", `${Math.round(roofBaseElevation(doc, r))} mm`),
        row(
          "Slope, all sloped edges (°)",
          slopeInput(sloped.length ? sloped[0]! : null, (v) => v !== null && setSlopes(p.slopes.map((s) => (s === null ? null : v)))),
        ),
        h("h3", {}, "Edges (blank = no slope / gable)"),
        ...p.slopes.map((s, i) => {
          const a = p.boundary[i]!;
          const b = p.boundary[(i + 1) % p.boundary.length]!;
          const len = Math.round(Math.hypot(b.x - a.x, b.y - a.y));
          return row(`Edge ${i + 1} (${len} mm)`, slopeInput(s, (v) => setSlopes(p.slopes.map((x, j) => (j === i ? v : x)))));
        }),
        editBoundaryButton(ctx, el.id),
      );
      break;
    }
    case Cat.WallOpening: {
      const p = el.params as HostedParams;
      const set = (name: string, patch: Partial<HostedParams>) =>
        edit(ctx, name, (tx) => {
          validateHosted(doc, { ...p, ...patch });
          tx.update<HostedParams>(el.id, patch);
        });
      sec.append(
        row("Position along wall", numberInput(p.position, (v) => set("Move opening", { position: v }))),
        row("Width", numberInput(p.width, (v) => set("Change opening width", { width: v }))),
        row("Sill height", numberInput(p.sillHeight, (v) => set("Change sill height", { sillHeight: v }))),
        row("Height", numberInput(p.height, (v) => set("Change opening height", { height: v }))),
      );
      break;
    }
    case Cat.Door:
    case Cat.Window: {
      const isDoor = el.category === Cat.Door;
      const p = el.params as DoorParams | WindowParams;
      const set = (name: string, patch: Partial<DoorParams>) =>
        edit(ctx, name, (tx) => {
          const next = { ...el, params: { ...p, ...patch } };
          validateHosted(doc, isDoor ? doorPlacement(doc, next) : windowPlacement(doc, next));
          tx.update(el.id, patch);
        });
      const typeCat = isDoor ? Cat.DoorType : Cat.WindowType;
      sec.append(
        row(
          "Type",
          select(typeOpts(typeCat), el.typeId ?? "", (v) =>
            edit(ctx, `Change ${isDoor ? "door" : "window"} type`, (tx) => {
              tx.setType(el.id, v);
              validateHosted(doc, hostedPlacement(doc, doc.require(el.id)));
            }),
          ),
        ),
        row("Position along wall", numberInput(p.position, (v) => set("Move " + (isDoor ? "door" : "window"), { position: v }))),
        row("Sill height", numberInput(p.sillHeight, (v) => set("Change sill height", { sillHeight: v }))),
      );
      if (isDoor) {
        const d = p as DoorParams;
        const flip = (label: string, key: "facingFlipped" | "handFlipped") => {
          const b = h("button", { textContent: label });
          b.onclick = () => set(label, { [key]: !d[key] });
          return b;
        };
        sec.append(row("Flip", h("div", { class: "buttons" }, flip("Facing", "facingFlipped"), flip("Hand", "handFlipped"))));
      }
      break;
    }
    case Cat.DoorType:
    case Cat.WindowType: {
      const isDoor = el.category === Cat.DoorType;
      // Resizing a type must keep every instance inside its wall.
      const setType = (patch: Params) =>
        edit(ctx, `Edit ${isDoor ? "door" : "window"} type`, (tx: Transaction) => {
          tx.update(el.id, patch);
          for (const inst of doc.byCategory(isDoor ? Cat.Door : Cat.Window)) {
            if (inst.typeId === el.id) validateHosted(doc, hostedPlacement(doc, inst));
          }
        });
      const p = el.params as Record<string, number>;
      const fields: [string, string][] = isDoor
        ? [["leafWidth", "Leaf width"], ["leafHeight", "Leaf height"], ["frameWidth", "Frame width"]]
        : [["width", "Width"], ["height", "Height"], ["frameWidth", "Frame width"], ["defaultSill", "Default sill"]];
      sec.append(row("Name", textInput(el.name ?? "", (v) => edit(ctx, "Rename type", (tx) => tx.setName(el.id, v || undefined)))));
      for (const [key, label] of fields) sec.append(row(label, numberInput(p[key]!, (v) => setType({ [key]: v }))));
      break;
    }
    case Cat.WallType:
    case Cat.FloorType:
    case Cat.CeilingType:
    case Cat.RoofType: {
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
