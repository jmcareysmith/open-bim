import {
  Cat,
  levels,
  regionArea,
  angleInputValue,
  ensureProjectSettings,
  formatArea,
  formatLength,
  lengthInputValue,
  parseAngle,
  parseLength,
  projectSettings,
  projectUnits,
  DEFAULT_UNITS,
  MM_EXACT_DECIMALS,
  type ProjectSettingsParams,
  type UnitsSettings,
  validateHosted,
  doorPlacement,
  hostedPlacement,
  windowPlacement,
  roofBaseElevation,
  renameGrid,
  renameView,
  validateViewRange,
  dimensionLayout,
  flipWall,
  materials as materialElements,
  layerMaterial,
  PATTERNS,
  type MaterialParams,
  type PatternName,
  type DetailLineParams,
  type Dimension,
  type DimensionParams,
  type FilledRegionParams,
  type LineStyle,
  type TextNoteParams,
  views as viewElements,
  SCALES,
  type View,
  type ViewParams,
  type ViewRangeOffsets,
  type DetailLevel,
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
  activeViewId(): ElementId | undefined;
  setActiveView(id: ElementId): void;
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

/** Units for the panel being rendered (set at the start of each render). */
let units: UnitsSettings = DEFAULT_UNITS;
const len = (mm: number) => formatLength(mm, units);

/** Length in the project unit; a typed suffix ("2.4m") overrides it. Stores mm. */
function numberInput(value: number, onCommit: (v: number) => void): HTMLInputElement {
  const input = h("input", { type: "text", value: lengthInputValue(value, units), title: `Length in ${units.length.unit}` });
  input.onchange = () => {
    const v = parseLength(input.value, units);
    if (v === null) {
      input.value = lengthInputValue(value, units);
      return;
    }
    onCommit(v);
  };
  return input;
}

function intInput(value: number, min: number, max: number, onCommit: (v: number) => void): HTMLInputElement {
  const input = h("input", { type: "number", min: String(min), max: String(max), step: "1", value: String(value) });
  input.onchange = () => {
    const v = Math.round(Number(input.value));
    if (Number.isFinite(v) && v >= min && v <= max) onCommit(v);
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

/** Slope in the project angle unit; empty = no slope. Stored as radians. */
function slopeInput(rad: number | null, onCommit: (v: number | null) => void): HTMLInputElement {
  const input = h("input", { type: "text", value: rad === null ? "" : angleInputValue(rad, units) });
  input.onchange = () => {
    if (input.value.trim() === "") return onCommit(null);
    const r = parseAngle(input.value, units);
    if (r !== null && r > 0 && r < Math.PI / 2) onCommit(r);
  };
  return input;
}

/** Properties of a view: identity, graphics and (plans) view range. */
function viewSection(ctx: PanelContext, view: View): HTMLElement {
  const { doc } = ctx;
  const p = view.params;
  const set = (name: string, patch: Partial<ViewParams>) => edit(ctx, name, (tx) => tx.update<ViewParams>(view.id, patch));
  const title = { floorPlan: "Floor Plan", "3d": "3D View", section: "Section", elevation: "Elevation", callout: "Callout" }[p.kind];
  const sec = h("div", { class: "section" }, h("h3", {}, title));
  if (view.id !== ctx.activeViewId()) {
    const open = h("button", { textContent: "Open view" });
    open.onclick = () => ctx.setActiveView(view.id);
    sec.append(row("", open));
  }
  sec.append(
    row("View name", textInput(view.name ?? "", (v) => edit(ctx, "Rename view", (tx) => renameView(tx, doc, view.id, v)))),
    row(
      "View scale",
      select(
        SCALES.map((s) => ({ value: String(s), label: `1 : ${s}` })),
        String(p.scale),
        (v) => set("Change view scale", { scale: Number(v) }),
      ),
    ),
    row(
      "Detail level",
      select(
        (["coarse", "medium", "fine"] as const).map((d) => ({ value: d, label: d[0]!.toUpperCase() + d.slice(1) })),
        p.detailLevel,
        (v) => set("Change detail level", { detailLevel: v as DetailLevel }),
      ),
    ),
  );
  if ((p.kind === "section" || p.kind === "elevation") && p.zRange) {
    const z = p.zRange;
    const setZ = (key: "bottom" | "top", v: number) =>
      edit(ctx, "Change view crop", (tx) => {
        const next = { ...z, [key]: v };
        if (!(next.top > next.bottom)) throw new Error("Crop top must be above crop bottom");
        tx.update<ViewParams>(view.id, { zRange: next });
      });
    sec.append(
      row("Far clip offset", numberInput(p.farClip ?? 0, (v) => (v > 0 ? set("Change far clip", { farClip: v }) : ctx.status("\u26a0 Far clip must be positive")))),
      row("Crop bottom", numberInput(z.bottom, (v) => setZ("bottom", v))),
      row("Crop top", numberInput(z.top, (v) => setZ("top", v))),
    );
  }
  if (p.kind === "floorPlan" && p.range && p.levelId) {
    const range = p.range;
    const setRange = (key: keyof ViewRangeOffsets, v: number) =>
      edit(ctx, "Change view range", (tx) => {
        const next = { ...range, [key]: v };
        validateViewRange(next);
        tx.update<ViewParams>(view.id, { range: next });
      });
    sec.append(
      row("Associated level", doc.get(p.levelId)?.name ?? ""),
      h("h3", {}, "View range (offsets from level)"),
      row("Top", numberInput(range.top, (v) => setRange("top", v))),
      row("Cut plane", numberInput(range.cut, (v) => setRange("cut", v))),
      row("Bottom", numberInput(range.bottom, (v) => setRange("bottom", v))),
      row("View depth", numberInput(range.depth, (v) => setRange("depth", v))),
    );
  }
  return sec;
}

/** Project Information and Project Units editors. */
function settingsSections(ctx: PanelContext, id: ElementId, p: ProjectSettingsParams): HTMLElement[] {
  const set = (name: string, patch: Partial<ProjectSettingsParams>) =>
    edit(ctx, name, (tx) => tx.update<ProjectSettingsParams>(id, patch));
  const setInfo = (key: keyof ProjectSettingsParams["info"], v: string) =>
    set("Edit project information", { info: { ...p.info, [key]: v } });
  const setUnits = (patch: Partial<UnitsSettings>) => set("Change project units", { units: { ...p.units, ...patch } });

  const info = h("div", { class: "section" }, h("h3", {}, "Project Information"));
  for (const [key, label] of [
    ["name", "Project name"],
    ["number", "Project number"],
    ["client", "Client"],
    ["address", "Address"],
  ] as const) {
    info.append(row(label, textInput(p.info[key], (v) => setInfo(key, v))));
  }

  const u = p.units;
  const unitsSec = h("div", { class: "section" }, h("h3", {}, "Project Units"));
  unitsSec.append(
    row(
      "Length",
      select(
        [
          { value: "mm", label: "Millimetres" },
          { value: "cm", label: "Centimetres" },
          { value: "m", label: "Metres" },
        ],
        u.length.unit,
        (v) => {
          const unit = v as UnitsSettings["length"]["unit"];
          setUnits({ length: { unit, decimals: MM_EXACT_DECIMALS[unit] } });
        },
      ),
    ),
    row("Length decimals", intInput(u.length.decimals, 0, 6, (v) => setUnits({ length: { ...u.length, decimals: v } }))),
    row(
      "Area",
      select(
        [
          { value: "m2", label: "Square metres" },
          { value: "mm2", label: "Square millimetres" },
        ],
        u.area.unit,
        (v) => setUnits({ area: { ...u.area, unit: v as UnitsSettings["area"]["unit"] } }),
      ),
    ),
    row("Area decimals", intInput(u.area.decimals, 0, 6, (v) => setUnits({ area: { ...u.area, decimals: v } }))),
    row(
      "Angle",
      select(
        [
          { value: "deg", label: "Degrees" },
          { value: "rad", label: "Radians" },
        ],
        u.angle.unit,
        (v) => setUnits({ angle: { ...u.angle, unit: v as UnitsSettings["angle"]["unit"] } }),
      ),
    ),
    row("Angle decimals", intInput(u.angle.decimals, 0, 6, (v) => setUnits({ angle: { ...u.angle, decimals: v } }))),
    row("Example", `${len(12500)} \u00b7 ${formatArea(24.16e6, units)}`),
  );
  return [info, unitsSec];
}

function deleteButton(ctx: PanelContext, el: Element): HTMLButtonElement {
  const del = h("button", { class: "danger", textContent: "Delete" });
  del.onclick = () => edit(ctx, `Delete ${el.category}`, (tx) => tx.delete(el.id));
  return del;
}

function editBoundaryButton(ctx: PanelContext, id: ElementId): HTMLElement {
  const b = h("button", { textContent: "Edit boundary" });
  b.onclick = () => ctx.editBoundary(id);
  return h("div", { class: "row" }, h("span", {}), b);
}

// ---- Project browser ------------------------------------------------------

export function renderBrowser(root: HTMLElement, ctx: PanelContext): void {
  const { doc } = ctx;
  units = projectUnits(doc);
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

  // Views, grouped Revit-style. Floor plans are listed in level order.
  const viewsSec = h("div", { class: "section" }, h("h3", {}, "Views"));
  const allViews = viewElements(doc);
  const levelOrder = new Map(levels(doc).map((l, i) => [l.id, i]));
  const groups: [string, View[]][] = [
    [
      "Floor Plans",
      allViews
        .filter((v) => v.params.kind === "floorPlan")
        .sort((a, b) => (levelOrder.get(a.params.levelId!) ?? 0) - (levelOrder.get(b.params.levelId!) ?? 0)),
    ],
    ["Callouts", allViews.filter((v) => v.params.kind === "callout")],
    ["Sections", allViews.filter((v) => v.params.kind === "section")],
    ["Elevations", allViews.filter((v) => v.params.kind === "elevation")],
    ["3D Views", allViews.filter((v) => v.params.kind === "3d")],
  ];
  for (const [title, list] of groups) {
    if (!list.length) continue;
    viewsSec.append(h("div", { class: "subhead" }, title));
    for (const v of list) {
      const div = h("div", { class: `list-item indent${v.id === ctx.activeViewId() ? " selected" : ""}` }, h("span", {}, v.name ?? v.id));
      div.onclick = () => ctx.setActiveView(v.id);
      viewsSec.append(div);
    }
  }
  const views = viewsSec;

  const lv = h("div", { class: "section" }, h("h3", {}, "Levels"));
  for (const l of levels(doc)) {
    lv.append(
      item(l, len(l.params.elevation), () => {
        ctx.setActiveLevel(l.id);
        ctx.setSelection([l.id]);
      }, l.id === ctx.activeLevelId()),
    );
  }

  const mats = h("div", { class: "section" }, h("h3", {}, "Materials"));
  for (const m of materialElements(doc)) {
    const swatch = h("span", { class: "swatch" });
    swatch.style.background = `#${m.params.color.toString(16).padStart(6, "0")}`;
    const div = h("div", { class: `list-item${sel.has(m.id) ? " selected" : ""}` }, h("span", {}, m.name ?? m.id), swatch);
    div.onclick = () => ctx.setSelection([m.id]);
    mats.append(div);
  }

  const types = h("div", { class: "section" }, h("h3", {}, "Types"));
  for (const cat of [Cat.WallType, Cat.FloorType, Cat.CeilingType, Cat.RoofType]) {
    for (const t of doc.byCategory<LayeredTypeParams>(cat)) {
      types.append(item(t, len(totalThickness(t)), () => ctx.setSelection([t.id])));
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

  // Project: information and units live on one settings element (created on demand for old files).
  const project = h("div", { class: "section" }, h("h3", {}, "Project"));
  const settings = projectSettings(doc);
  const openSettings = () => {
    let id = settings?.id;
    if (!id) {
      try {
        id = doc.transact("Create project settings", (tx) => ensureProjectSettings(tx, doc)).id;
      } catch (err) {
        return ctx.status(`\u26a0 ${(err as Error).message}`);
      }
    }
    ctx.setSelection([id]);
  };
  const info = h("div", { class: `list-item${settings && sel.has(settings.id) ? " selected" : ""}` },
    h("span", {}, "Project Information & Units"),
    h("span", { class: "muted" }, units.length.unit),
  );
  info.onclick = openSettings;
  project.append(info);

  root.replaceChildren(project, views, lv, types, mats, counts);
}

// ---- Properties -----------------------------------------------------------

export function renderProperties(root: HTMLElement, ctx: PanelContext): void {
  const { doc } = ctx;
  units = projectUnits(doc);
  const ids = ctx.selection().filter((id) => doc.has(id));
  if (ids.length === 0) {
    // Nothing selected: show the active view's properties, as Revit does.
    const view = ctx.activeViewId() ? doc.get<ViewParams>(ctx.activeViewId()!) : undefined;
    root.replaceChildren(view ? viewSection(ctx, view as View) : h("div", { class: "empty" }, "Nothing selected"));
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
      const flip = h("button", { textContent: "Flip (swap exterior side)" });
      flip.onclick = () => edit(ctx, "Flip wall", (tx) => flipWall(tx, doc, w.id));
      sec.append(row("Orientation", flip));
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
        row("Length", len(wallLength(w))),
        row("Thickness", len(wallThickness(doc, w))),
      );
      break;
    }
    case Cat.Floor: {
      const p = el.params as FloorParams;
      sec.append(
        row("Type", select(typeOpts(Cat.FloorType), el.typeId ?? "", (v) => edit(ctx, "Change floor type", (tx) => tx.setType(el.id, v)))),
        row("Level", select(levelOpts, p.levelId, (v) => update<FloorParams>("Change floor level", { levelId: v }))),
        row("Height offset", numberInput(p.offset, (v) => update<FloorParams>("Change floor offset", { offset: v }))),
        row("Area", formatArea(regionArea(p), units)),
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
        row("Area", formatArea(regionArea(p), units)),
        editBoundaryButton(ctx, el.id),
      );
      break;
    }
    case Cat.Grid: {
      const { start, end } = el.params as GridParams;
      sec.append(
        row("Name", textInput(el.name ?? "", (v) => edit(ctx, "Rename grid", (tx) => renameGrid(tx, doc, el.id, v)))),
        row("Length", len(Math.hypot(end.x - start.x, end.y - start.y))),
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
        row("Length", len(Math.hypot(end.x - start.x, end.y - start.y))),
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
        row("Base elevation", len(roofBaseElevation(doc, r))),
        row(
          `Slope, all sloped edges (${units.angle.unit === "deg" ? "°" : "rad"})`,
          slopeInput(sloped.length ? sloped[0]! : null, (v) => v !== null && setSlopes(p.slopes.map((s) => (s === null ? null : v)))),
        ),
        h("h3", {}, "Edges (blank = no slope / gable)"),
        ...p.slopes.map((s, i) => {
          const a = p.boundary[i]!;
          const b = p.boundary[(i + 1) % p.boundary.length]!;
          const edgeLen = Math.hypot(b.x - a.x, b.y - a.y);
          return row(`Edge ${i + 1} (${len(edgeLen)})`, slopeInput(s, (v) => setSlopes(p.slopes.map((x, j) => (j === i ? v : x)))));
        }),
        editBoundaryButton(ctx, el.id),
      );
      break;
    }
    case Cat.Material: {
      const p = el.params as MaterialParams;
      const colour = h("input", { type: "color", value: `#${p.color.toString(16).padStart(6, "0")}` });
      colour.onchange = () => update<MaterialParams>("Change material colour", { color: parseInt(colour.value.slice(1), 16) });
      const patternOpts = PATTERNS.map((n) => ({ value: n, label: n[0]!.toUpperCase() + n.slice(1) }));
      sec.append(
        row("Name", textInput(el.name ?? "", (v) => edit(ctx, "Rename material", (tx) => tx.setName(el.id, v || undefined)))),
        row("Shading colour", colour),
        row("Cut pattern", select(patternOpts, p.cutPattern, (v) => update<MaterialParams>("Change cut pattern", { cutPattern: v as PatternName }))),
        row(
          "Surface pattern",
          select(patternOpts, p.surfacePattern, (v) => update<MaterialParams>("Change surface pattern", { surfacePattern: v as PatternName })),
        ),
      );
      break;
    }
    case Cat.DetailLine: {
      const p = el.params as DetailLineParams;
      sec.append(
        row(
          "Line style",
          select(
            (["thin", "medium", "wide", "hidden"] as const).map((s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1) })),
            p.style,
            (v) => update<DetailLineParams>("Change line style", { style: v as LineStyle }),
          ),
        ),
        row("Length", len(Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y))),
      );
      break;
    }
    case Cat.FilledRegion: {
      const p = el.params as FilledRegionParams;
      const colour = h("input", { type: "color", value: `#${p.color.toString(16).padStart(6, "0")}` });
      colour.onchange = () => update<FilledRegionParams>("Change region colour", { color: parseInt(colour.value.slice(1), 16) });
      sec.append(row("Colour", colour), row("Area", formatArea(regionArea(p), units)), editBoundaryButton(ctx, el.id));
      break;
    }
    case Cat.TextNote: {
      const p = el.params as TextNoteParams;
      sec.append(
        row("Text", textInput(p.text, (v) => (v ? update<TextNoteParams>("Edit text", { text: v }) : ctx.status("\u26a0 Text can't be empty")))),
        row("Text size (paper mm)", h("span", { class: "value" }, String(p.size))),
      );
      break;
    }
    case Cat.Dimension: {
      const d = el as Dimension;
      const values = dimensionLayout(doc, d).values.map((v) => len(v));
      sec.append(row("Values", values.join(" + ")), row("References", String((d.params as DimensionParams).refs.length)));
      break;
    }
    case Cat.View: {
      root.replaceChildren(viewSection(ctx, el as View), h("div", { class: "section" }, deleteButton(ctx, el)));
      return;
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
        row("Total", len(totalThickness(t))),
      );
      const matOpts = materialElements(doc).map((m) => ({ value: m.id, label: m.name ?? m.id }));
      sec.append(h("h3", {}, "Layers (exterior / top first)"));
      t.params.layers.forEach((layer, i) => {
        const setLayer = (name: string, patch: Partial<typeof layer>) =>
          update<LayeredTypeParams>(name, { layers: t.params.layers.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
        const current = layerMaterial(doc, layer)?.id ?? "";
        sec.append(
          row(
            `${i + 1}. ${layer.function}`,
            select(current ? matOpts : [{ value: "", label: layer.material }, ...matOpts], current, (v) => {
              const m = doc.get(v);
              if (m) setLayer("Change layer material", { materialId: m.id, material: m.name ?? layer.material });
            }),
          ),
          row("", numberInput(layer.thickness, (v) => setLayer("Edit layer thickness", { thickness: Math.max(0, v) }))),
        );
      });
      break;
    }
  }

  if (el.category === Cat.ProjectSettings) {
    root.replaceChildren(...settingsSections(ctx, el.id, el.params as ProjectSettingsParams));
    return;
  }

  const del = h("button", { class: "danger", textContent: "Delete" });
  del.onclick = () => edit(ctx, `Delete ${el.category}`, (tx) => tx.delete(el.id));
  root.replaceChildren(sec, h("div", { class: "section" }, del));
}
