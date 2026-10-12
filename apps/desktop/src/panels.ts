import { areaBoundary, areaLoopsFromWalls, roomBoundary, scheduleFields, scheduleTable } from "@open-bim/geometry";
import {
  Cat,
  levels,
  roomExtent,
  AREA_SCHEMES,
  TAGGABLE,
  elementMark,
  keynoteTable,
  getCategory,
  createLegend,
  createSchedule,
  createRevision,
  DEFAULT_PHASES,
  PHASED,
  PHASE_FILTERS,
  phases,
  setPhases,
  viewPhase,
  createStackedWallType,
  stairLayout,
  type BeamParams,
  type ColumnParams,
  type PadFootingParams,
  type StripFootingParams,
  type StructuralSectionParams,
  type ToposolidParams,
  rampLayout,
  rampLengthNeeded,
  type Ramp,
  type RampParams,
  type RampTypeParams,
  type RailingParams,
  type RailingTypeParams,
  type Stair,
  type StairParams,
  type StairTypeParams,
  links,
  linkDocument,
  type Link,
  type LinkParams,
  CRS_OPTIONS,
  DEFAULT_LOCATION,
  type SiteLocation,
  type CadImportParams,
  type DirectShapeParams,
  groupInstances,
  groupMembers,
  moveGroup,
  syncGroupInstances,
  ungroup,
  type GroupParams,
  moveRevision,
  revisionNumber,
  revisions,
  sheetRevisions,
  type RevisionParams,
  type RevisionCloudParams,
  type Sheet,
  schedules,
  SCHEDULE_CATEGORIES,
  TAKEOFF_CATEGORIES,
  type Schedule,
  type ScheduleParams,
  type ScheduleFilterOp,
  createLegendComponent,
  createKeynoteLegend,
  nextLegendPosition,
  LEGEND_TYPE_CATEGORIES,
  type LegendComponentParams,
  type KeynoteLegendParams,
  tagText,
  type TagParams,
  createAreaBoundary,
  type Area,
  type AreaParams,
  type AreaScheme,
  type Room,
  type RoomParams,
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
  associateGlobal,
  createGlobalParameter,
  createProjectParameter,
  customValue,
  globalAssociations,
  globalParameters,
  globalValues,
  parametersFor,
  projectParameters,
  setCustomValue,
  type GlobalParameterParams,
  type ParamDataType,
  type ProjectParameterParams,
  createFamilyParameter,
  createFamilyType,
  evaluate,
  familyDefs,
  familyDocument,
  familyInfo,
  familyParameters,
  familyTypeNames,
  familyValues,
  instanceValues,
  isFormCategory,
  setFamilyValue,
  type FamilyCategory,
  type FamilyDef,
  type FamilyInfoParams,
  type FamilyInstance,
  type FamilyInstanceParams,
  type FamilyParameterParams,
  type Num,
  type NumPt,
  createSheet,
  placeView,
  sheetOfView,
  sheets as sheetElements,
  viewportsOn,
  PAPER_SIZES,
  type PaperSize,
  type SheetParams,
  type ViewportParams,
  createViewFilter,
  createViewTemplate,
  effectiveGraphics,
  type AppliedFilter,
  type FilterOp,
  type FilterRule,
  type GraphicOverride,
  type ViewFilterParams,
  type ViewGraphicsParams,
  type ViewTemplateParams,
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
  /** Open a new family of a category in the family editor. */
  newFamily(category: FamilyCategory): void;
  /** Open a loaded family in the family editor. */
  editFamily(defId: ElementId): void;
  /** The built-in family library, and loading from it or from an .obim-family file. */
  libraryFamilies(): { name: string; category: FamilyCategory; description: string }[];
  loadLibraryFamily(name: string): void;
  loadFamilyFile(): void;
  /** Create an area plan (with boundaries from walls) and open it. */
  newAreaPlan(levelId: ElementId, scheme: AreaScheme): void;
  importKeynotes(): void;
  exportKeynotes(): void;
  exportSchedule(id: ElementId, format: "csv" | "xlsx"): void;
  linkProject(): void;
  importSurvey(id: ElementId): void;
  reloadLink(id: ElementId): void;
  /** Start placing copies of a selected group. */
  placeGroupCopy(): void;
  /** Family editor: the project's loaded families, and copying one in to nest it. */
  projectFamilies(): FamilyDef[];
  nestFamily(defId: ElementId): void;
  exportCatalog(): void;
  importCatalog(): void;
  importSharedParameters(): void;
  exportSharedParameters(): void;
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

function checkbox(value: boolean, onChange: (v: boolean) => void): HTMLInputElement {
  const cb = h("input", { type: "checkbox", checked: value });
  cb.onchange = () => onChange(cb.checked);
  return cb;
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
  const title = { floorPlan: "Floor Plan", "3d": "3D View", section: "Section", elevation: "Elevation", callout: "Callout", areaPlan: "Area Plan", legend: "Legend" }[p.kind];
  const sec = h("div", { class: "section" }, h("h3", {}, title));
  if (view.id !== ctx.activeViewId()) {
    const open = h("button", { textContent: "Open view" });
    open.onclick = () => ctx.setActiveView(view.id);
    sec.append(row("", open));
  }
  const templates = doc.byCategory<ViewTemplateParams>(Cat.ViewTemplate);
  const template = p.templateId ? doc.get<ViewTemplateParams>(p.templateId) : undefined;
  sec.append(
    row("View name", textInput(view.name ?? "", (v) => edit(ctx, "Rename view", (tx) => renameView(tx, doc, view.id, v)))),
    row(
      "View template",
      select(
        [{ value: "", label: "<None>" }, ...templates.map((t) => ({ value: t.id, label: t.name ?? t.id }))],
        template ? template.id : "",
        (v) => set("Change view template", { templateId: v || null }),
      ),
    ),
  );
  if (template) {
    // Revit greys out what the template controls.
    const g = effectiveGraphics(doc, view);
    sec.append(row("View scale", `1 : ${g.scale}`), row("Detail level", g.detailLevel), row("Visibility/Graphics", `from ${template.name}`));
  } else {
    sec.append(...graphicsRows(ctx, view.id, p));
  }
  if (p.kind !== "legend") {
    // Phasing: which phase this view shows, through which filter.
    sec.append(
      row("Phase", select(phases(doc).map((ph) => ({ value: ph.id, label: ph.name })), viewPhase(doc, p.phase), (v) => set("Change view phase", { phase: v }))),
      row("Phase filter", select(PHASE_FILTERS, p.phaseFilter ?? "all", (v) => set("Change phase filter", { phaseFilter: v as ViewParams["phaseFilter"] }))),
    );
  }
  {
    const make = h("button", { textContent: "Create template from view" });
    make.onclick = () =>
      edit(ctx, "Create view template", (tx) => {
        let name = `${view.name ?? "View"} template`;
        for (let i = 2; doc.byCategory(Cat.ViewTemplate).some((t) => t.name === name); i++) name = `${view.name ?? "View"} template ${i}`;
        createViewTemplate(tx, doc, name, view);
      });
    sec.append(row("", make));
  }
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
  if (p.kind === "legend") {
    const types = doc.all().filter((e) => LEGEND_TYPE_CATEGORIES.has(e.category));
    sec.append(
      row(
        "Add component",
        select([{ value: "", label: "Type\u2026" }, ...types.map((t) => ({ value: t.id, label: `${t.name ?? t.id} (${t.category.replace("Type", "")})` }))], "", (v) => {
          if (v) edit(ctx, "Add legend component", (tx) => createLegendComponent(tx, doc, view.id, v, nextLegendPosition(doc, view.id)));
        }),
      ),
    );
  }
  if (p.kind !== "3d") {
    const addKeynotes = h("button", { textContent: "Add keynote legend" });
    addKeynotes.title = "A table of the keynotes tagged in a view (pick which in its properties)";
    addKeynotes.onclick = () =>
      edit(ctx, "Add keynote legend", (tx) => {
        const at = p.kind === "legend" ? { x: 3000, y: 0 } : { x: 0, y: 0 };
        const k = createKeynoteLegend(tx, doc, view.id, at, p.kind === "legend" ? null : view.id);
        queueMicrotask(() => ctx.setSelection([k.id]));
      });
    sec.append(row("", addKeynotes));
  }
  if (p.kind === "areaPlan" && p.levelId && p.areaScheme) {
    const levelId = p.levelId;
    const scheme = p.areaScheme;
    const fromWalls = h("button", { textContent: "Boundaries from walls" });
    fromWalls.title = scheme === "gross" ? "Area boundary lines on the outside face of the building" : "Area boundary lines on the inside face of external walls";
    fromWalls.onclick = () =>
      edit(ctx, "Area boundaries from walls", (tx) => {
        const loops = areaLoopsFromWalls(doc, levelId, scheme);
        if (!loops.length) throw new Error("No walls on this level to take boundaries from");
        for (const l of loops) l.forEach((a, i) => createAreaBoundary(tx, doc, view.id, a, l[(i + 1) % l.length]!));
      });
    sec.append(row("Area scheme", AREA_SCHEMES[scheme].label), row("", fromWalls));
  }
  if ((p.kind === "floorPlan" || p.kind === "areaPlan") && p.range && p.levelId) {
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
  if (!template) sec.append(visibilityGraphics(ctx, view.id, p));
  return sec;
}

const SCHEDULE_FILTER_OPS: { value: ScheduleFilterOp; label: string }[] = [
  { value: "eq", label: "equals" },
  { value: "ne", label: "does not equal" },
  { value: "gt", label: "is greater than" },
  { value: "lt", label: "is less than" },
  { value: "contains", label: "contains" },
  { value: "notContains", label: "does not contain" },
];

/** Schedule properties: fields, filter, sorting/grouping and formatting (Revit's Schedule Properties tabs). */
function scheduleSections(ctx: PanelContext, s: Schedule): HTMLElement[] {
  const { doc } = ctx;
  const p = s.params;
  const set = (name: string, patch: Partial<ScheduleParams>) => edit(ctx, name, (tx) => tx.update<ScheduleParams>(s.id, patch));
  const all = scheduleFields(doc, p);
  const label = (k: string) => all.find((f) => f.key === k)?.label ?? k;
  const fieldOpts = all.map((f) => ({ value: f.key, label: f.label }));

  const general = h("div", { class: "section" }, h("h3", {}, p.kind === "takeoff" ? "Material Takeoff" : "Schedule"));
  const csv = h("button", { textContent: "Export CSV" });
  csv.onclick = () => ctx.exportSchedule(s.id, "csv");
  const xlsx = h("button", { textContent: "Export Excel" });
  xlsx.onclick = () => ctx.exportSchedule(s.id, "xlsx");
  const del = h("button", { class: "danger", textContent: "Delete schedule" });
  del.onclick = () => edit(ctx, "Delete schedule", (tx) => tx.delete(s.id));
  general.append(
    row("Name", textInput(s.name ?? "", (v) => (v ? edit(ctx, "Rename schedule", (tx) => tx.setName(s.id, v)) : ctx.status("\u26a0 Schedules need a name")))),
    row("Category", SCHEDULE_CATEGORIES.find(([c]) => c === p.category)?.[1] ?? p.category),
    row("Itemise every instance", checkbox(p.itemize, (v) => set("Itemise", { itemize: v }))),
    row("Grand totals", checkbox(p.grandTotals, (v) => set("Grand totals", { grandTotals: v }))),
    row("", h("div", { class: "buttons wrap" }, csv, xlsx)),
  );

  const fields = h("div", { class: "section" }, h("h3", {}, "Fields"));
  p.fields.forEach((k, i) => {
    const up = h("button", { textContent: "\u2191", title: "Move up", disabled: i === 0 });
    up.onclick = () => {
      const f = [...p.fields];
      [f[i - 1], f[i]] = [f[i]!, f[i - 1]!];
      set("Reorder fields", { fields: f });
    };
    const rm = h("button", { textContent: "\u00d7", title: "Remove" });
    rm.onclick = () => set("Remove field", { fields: p.fields.filter((_, j) => j !== i) });
    fields.append(h("div", { class: "list-item" }, h("span", {}, label(k)), h("span", { class: "buttons" }, up, rm)));
  });
  const unused = all.filter((f) => !p.fields.includes(f.key));
  if (unused.length) {
    fields.append(
      row(
        "Add field",
        select([{ value: "", label: "Field\u2026" }, ...unused.map((f) => ({ value: f.key, label: f.label }))], "", (v) => v && set("Add field", { fields: [...p.fields, v] })),
      ),
    );
  }

  const filters = h("div", { class: "section" }, h("h3", {}, "Filter"));
  p.filters.forEach((f, i) => {
    const patch = (q: Partial<typeof f>) => set("Change filter", { filters: p.filters.map((x, j) => (j === i ? { ...x, ...q } : x)) });
    const rm = h("button", { textContent: "\u00d7", title: "Remove" });
    rm.onclick = () => set("Remove filter", { filters: p.filters.filter((_, j) => j !== i) });
    filters.append(
      h(
        "div",
        { class: "buttons wrap" },
        select(fieldOpts, f.field, (v) => patch({ field: v })),
        select(SCHEDULE_FILTER_OPS, f.op, (v) => patch({ op: v as ScheduleFilterOp })),
        textInput(f.value, (v) => patch({ value: v })),
        rm,
      ),
    );
  });
  const addFilter = h("button", { textContent: "Add filter" });
  addFilter.onclick = () => set("Add filter", { filters: [...p.filters, { field: p.fields[0] ?? all[0]!.key, op: "eq", value: "" }] });
  filters.append(row("", addFilter));

  const sorting = h("div", { class: "section" }, h("h3", {}, "Sorting/Grouping"));
  p.sort.forEach((o, i) => {
    const patch = (q: Partial<typeof o>) => set("Change sorting", { sort: p.sort.map((x, j) => (j === i ? { ...x, ...q } : x)) });
    const rm = h("button", { textContent: "\u00d7", title: "Remove" });
    rm.onclick = () => set("Remove sort", { sort: p.sort.filter((_, j) => j !== i) });
    sorting.append(
      h("div", { class: "buttons wrap" }, select(fieldOpts, o.field, (v) => patch({ field: v })), rm),
      h(
        "div",
        { class: "buttons wrap" },
        h("label", { class: "check" }, checkbox(o.descending, (v) => patch({ descending: v })), "Descending"),
        h("label", { class: "check" }, checkbox(o.header, (v) => patch({ header: v })), "Header"),
        h("label", { class: "check" }, checkbox(o.footer, (v) => patch({ footer: v })), "Footer"),
      ),
    );
  });
  const addSort = h("button", { textContent: "Add sort level" });
  addSort.onclick = () => set("Add sort", { sort: [...p.sort, { field: p.fields[0] ?? all[0]!.key, descending: false, header: false, footer: false }] });
  sorting.append(row("", addSort));
  return [general, fields, filters, sorting, h("div", { class: "section" }, del)];
}

/** The schedule's table, filling the viewport area (click a row to select its elements). */
export function renderSchedulePane(root: HTMLElement, ctx: PanelContext, s: Schedule): void {
  let t: ReturnType<typeof scheduleTable>;
  try {
    t = scheduleTable(ctx.doc, s);
  } catch (err) {
    root.replaceChildren(h("div", { class: "empty" }, `\u26a0 ${(err as Error).message}`));
    return;
  }
  const head = h("tr", {}, ...t.headings.map((x) => h("th", {}, x)));
  const body = t.rows.map((r) => {
    const tr = h("tr", { class: r.kind === "row" ? "data" : r.kind }, ...r.cells.map((c, i) => h("td", { class: typeof r.values[i] === "number" ? "num" : "" }, c)));
    if (r.kind === "row" && r.ids.length) tr.onclick = () => ctx.setSelection(r.ids);
    return tr;
  });
  root.replaceChildren(
    h("h2", {}, t.title),
    t.rows.length ? h("table", {}, h("thead", {}, head), h("tbody", {}, ...body)) : h("div", { class: "empty" }, "No elements match this schedule."),
  );
}

const FAMILY_CATEGORIES: [FamilyCategory, string][] = [
  ["GenericModel", "Generic Model"],
  ["Furniture", "Furniture"],
  ["Casework", "Casework"],
  ["Door", "Door (wall hosted)"],
  ["Window", "Window (wall hosted)"],
];

/** A number or formula: numeric text is stored as a number, anything else as a formula. */
function formulaInput(value: Num, onCommit: (v: Num) => void, check?: (v: Num) => void): HTMLInputElement {
  const input = h("input", { type: "text", value: String(value), title: "Number or formula, e.g. Width / 2" });
  input.onchange = () => {
    const t = input.value.trim();
    const v: Num = /^[-+]?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : t;
    try {
      check?.(v);
      onCommit(v);
    } catch (err) {
      input.classList.add("invalid");
      input.title = (err as Error).message;
    }
  };
  return input;
}

const ptsText = (pts: NumPt[]) => pts.map((p) => `${p.x}, ${p.y}`).join("\n");

/** Points textarea: one "x, y" per line; each coordinate a number or formula. */
function pointsInput(pts: NumPt[], onCommit: (p: NumPt[]) => void): HTMLTextAreaElement {
  const ta = h("textarea", { class: "points", value: ptsText(pts), title: "One point per line: x, y (numbers or formulas)" });
  ta.onchange = () => {
    const parsed = ta.value
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const parts = l.split(",");
        if (parts.length !== 2) throw new Error(`"${l}" should be x, y`);
        const num = (s: string): Num => (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s.trim()) ? Number(s.trim()) : s.trim());
        return { x: num(parts[0]!), y: num(parts[1]!) };
      });
    onCommit(parsed);
  };
  return ta;
}

/** Form properties (family editor). */
function formRows(ctx: PanelContext, el: Element): HTMLElement[] {
  const { doc } = ctx;
  const p = el.params as Record<string, unknown> & { isVoid: boolean; plane: { kind: string } };
  const values = familyValues(doc);
  const check = (v: Num) => void evaluate(v, values);
  const update = (name: string, patch: Record<string, unknown>) => edit(ctx, name, (tx) => tx.update(el.id, patch as never));
  const isVoid = h("input", { type: "checkbox", checked: p.isVoid });
  isVoid.onchange = () => update("Toggle void", { isVoid: isVoid.checked });
  const rows: HTMLElement[] = [row("Void (cuts solids)", isVoid), row("Work plane", p.plane.kind)];
  const field = (key: string, label: string) => rows.push(row(label, formulaInput(p[key] as Num, (v) => update(`Edit ${label.toLowerCase()}`, { [key]: v }), check)));
  const pts = (key: string, label: string) => {
    rows.push(h("h3", {}, label));
    rows.push(pointsInput(p[key] as NumPt[], (v) => update(`Edit ${label.toLowerCase()}`, { [key]: v })));
  };
  switch (el.category) {
    case Cat.Extrusion:
      field("start", "Extrusion start");
      field("end", "Extrusion end");
      pts("profile", "Profile (x, y)");
      break;
    case Cat.Blend:
      field("start", "Base offset");
      field("end", "Top offset");
      pts("bottom", "Bottom profile");
      pts("top", "Top profile");
      break;
    case Cat.Revolution:
      field("axis", "Axis (u)");
      field("startAngle", "Start angle (\u00b0)");
      field("endAngle", "End angle (\u00b0)");
      pts("profile", "Profile (u, v)");
      break;
    case Cat.Sweep:
      pts("path", "Path (x, y)");
      pts("profile", "Profile (across, up)");
      break;
  }
  return rows;
}

/** Family editor: name, current type, parameters (value, formula, instance/type), add parameter/type. */
function familyTypesSection(ctx: PanelContext): HTMLElement {
  const { doc } = ctx;
  const info = familyInfo(doc)!;
  const p = info.params;
  const sec = h("div", { class: "section" }, h("h3", {}, "Family Types"));
  sec.append(
    row("Family name", textInput(info.name ?? "", (v) => edit(ctx, "Rename family", (tx) => tx.setName(info.id, v || undefined)))),
    row("Category", p.category + (p.hosting === "wall" ? " (wall hosted)" : "")),
    row(
      "Type",
      select(p.types.map((t) => ({ value: t.name, label: t.name })), p.currentType, (v) =>
        edit(ctx, "Change current type", (tx) => tx.update<FamilyInfoParams>(info.id, { currentType: v })),
      ),
    ),
  );
  const exportCat = h("button", { textContent: "Export type catalog" });
  exportCat.onclick = () => ctx.exportCatalog();
  const importCat = h("button", { textContent: "Import type catalog" });
  importCat.onclick = () => ctx.importCatalog();
  sec.append(row("", h("div", { class: "buttons" }, importCat, exportCat)));
  const newType = h("button", { textContent: "New type" });
  newType.onclick = () =>
    edit(ctx, "New family type", (tx) => {
      let n = p.types.length + 1;
      while (p.types.some((t) => t.name === `Type ${n}`)) n++;
      createFamilyType(tx, doc, `Type ${n}`);
    });
  sec.append(row("", newType));

  let values: Record<string, number> = {};
  let error = "";
  try {
    values = familyValues(doc);
  } catch (err) {
    error = (err as Error).message;
  }
  sec.append(h("h3", {}, "Parameters (value \u00b7 formula \u00b7 instance)"));
  if (error) sec.append(h("div", { class: "empty" }, `\u26a0 ${error}`));
  for (const fp of familyParameters(doc)) {
    const name = fp.name ?? "";
    const valueCell = fp.params.formula
      ? h("span", { class: "value" }, String(Math.round((values[name] ?? 0) * 100) / 100))
      : numberInput(values[name] ?? 0, (v) => edit(ctx, `Set ${name}`, (tx) => setFamilyValue(tx, doc, name, v)));
    const formula = h("input", { type: "text", value: fp.params.formula ?? "", placeholder: "formula" });
    formula.onchange = () =>
      edit(ctx, `Formula for ${name}`, (tx) => {
        const f = formula.value.trim() || null;
        tx.update<FamilyParameterParams>(fp.id, { formula: f });
        familyValues(doc); // reject circular or invalid formulas (rolls back)
      });
    const inst = h("input", { type: "checkbox", checked: fp.params.instance, title: "Instance parameter" });
    inst.onchange = () => edit(ctx, "Change parameter kind", (tx) => tx.update<FamilyParameterParams>(fp.id, { instance: inst.checked }));
    const del = h("button", { textContent: "\u00d7", class: "mini", title: "Delete parameter" });
    del.onclick = () => edit(ctx, `Delete ${name}`, (tx) => tx.delete(fp.id));
    sec.append(h("div", { class: "param" }, h("span", { title: name }, name), valueCell, formula, inst, del));
  }
  const newName = h("input", { type: "text", placeholder: "New parameter name" });
  const add = h("button", { textContent: "Add" });
  add.onclick = () => edit(ctx, "Add parameter", (tx) => createFamilyParameter(tx, doc, newName.value.trim(), { value: 0 }));
  sec.append(h("div", { class: "rule" }, newName, add));
  return sec;
}

/** Placed family instance: type, placement, instance parameters. */
function instanceRows(ctx: PanelContext, inst: FamilyInstance): HTMLElement[] {
  const { doc } = ctx;
  const p = inst.params;
  const def = doc.get(p.familyId) as FamilyDef | undefined;
  if (!def) return [row("Family", "(missing)")];
  const update = (name: string, patch: Partial<FamilyInstanceParams>) => edit(ctx, name, (tx) => tx.update<FamilyInstanceParams>(inst.id, patch));
  const rows: HTMLElement[] = [
    row("Family", def.name ?? ""),
    row(
      "Type",
      select(familyTypeNames(def).map((t) => ({ value: t, label: t })), p.typeName, (v) => update("Change family type", { typeName: v })),
    ),
  ];
  if (p.hostId) {
    const flip = h("button", { textContent: "Flip" });
    flip.onclick = () => update("Flip component", { flipped: !p.flipped });
    rows.push(
      row("Position along wall", numberInput(p.along, (v) => update("Move component", { along: v }))),
      row("Sill height", numberInput(p.sillHeight, (v) => update("Change sill height", { sillHeight: v }))),
      row("Facing", flip),
    );
  } else {
    rows.push(
      row("Offset from level", numberInput(p.offset, (v) => update("Change offset", { offset: v }))),
      row("X", numberInput(p.position.x, (v) => update("Move component", { position: { ...p.position, x: v } }))),
      row("Y", numberInput(p.position.y, (v) => update("Move component", { position: { ...p.position, y: v } }))),
      row(
        "Rotation (\u00b0)",
        formulaInput(Math.round((p.rotation * 180) / Math.PI), (v) => update("Rotate component", { rotation: (Number(v) * Math.PI) / 180 })),
      ),
    );
  }
  // Nested in a family: associate the nested family's parameters with the host's (formulas).
  const fam = familyDocument(def);
  if (familyInfo(doc)) {
    rows.push(h("h3", {}, "Associate with host parameters (formulas)"));
    for (const fp of familyParameters(fam).filter((x) => !x.params.formula)) {
      const name = fp.name ?? "";
      const current = p.associations?.[name] ?? "";
      const input = h("input", { type: "text", value: current, placeholder: "e.g. Height - 30" });
      input.onchange = () => {
        const next = { ...(p.associations ?? {}) };
        if (input.value.trim()) next[name] = input.value.trim();
        else delete next[name];
        edit(ctx, `Associate ${name}`, (tx) => {
          tx.update<FamilyInstanceParams>(inst.id, { associations: next });
          instanceValues(doc, doc.require(inst.id) as FamilyInstance); // reject bad formulas
        });
      };
      rows.push(row(name, input));
    }
  }
  // Instance parameters: overrides of the type's value.
  const instParams = familyParameters(fam).filter((fp) => fp.params.instance && !fp.params.formula);
  if (instParams.length) {
    rows.push(h("h3", {}, "Instance parameters"));
    const vals = familyValues(fam, p.typeName, p.overrides);
    for (const fp of instParams) {
      const name = fp.name ?? "";
      rows.push(row(name, numberInput(vals[name] ?? 0, (v) => update(`Set ${name}`, { overrides: { ...p.overrides, [name]: v } }))));
    }
  }
  return rows;
}

/** Family editor browser: views, parameters summary, forms. */
function renderFamilyBrowser(root: HTMLElement, ctx: PanelContext): void {
  const { doc } = ctx;
  const sel = new Set(ctx.selection());
  const viewsSec = h("div", { class: "section" }, h("h3", {}, "Views"));
  for (const v of viewElements(doc)) {
    const div = h("div", { class: `list-item${v.id === ctx.activeViewId() ? " selected" : ""}` }, h("span", {}, v.name ?? v.id));
    div.onclick = () => ctx.setActiveView(v.id);
    viewsSec.append(div);
  }
  const forms = h("div", { class: "section" }, h("h3", {}, "Forms"));
  for (const f of doc.all().filter((e) => isFormCategory(e.category))) {
    const label = `${f.category}${(f.params as { isVoid?: boolean }).isVoid ? " (void)" : ""}`;
    const div = h("div", { class: `list-item${sel.has(f.id) ? " selected" : ""}` }, h("span", {}, label));
    div.onclick = () => ctx.setSelection([f.id]);
    forms.append(div);
  }
  if (!forms.children[1]) forms.append(h("div", { class: "empty" }, "No forms yet: use Extrusion, Blend, Revolve or Sweep."));
  // Nested families: copied from the project, placed with Component.
  const nested = h("div", { class: "section" }, h("h3", {}, "Nested families"));
  for (const f of familyDefs(doc)) {
    const div = h("div", { class: `list-item${sel.has(f.id) ? " selected" : ""}` }, h("span", {}, f.name ?? f.id));
    div.onclick = () => ctx.setSelection([f.id]);
    nested.append(div);
  }
  const fromProject = ctx.projectFamilies().filter((f) => !familyDefs(doc).some((d) => d.name === f.name));
  if (fromProject.length) {
    nested.append(
      row(
        "Load from project",
        select([{ value: "", label: "Choose\u2026" }, ...fromProject.map((f) => ({ value: f.id, label: f.name ?? f.id }))], "", (v) => v && ctx.nestFamily(v)),
      ),
    );
  }
  const info = familyInfo(doc)!;
  const summary = h("div", { class: "section" }, h("h3", {}, "Family"), row("Name", info.name ?? ""), row("Types", String(info.params.types.length)));
  root.replaceChildren(summary, viewsSec, forms, nested);
}

/** Project parameter values and global-parameter associations for an element. */
function parameterSections(ctx: PanelContext, el: Element): HTMLElement[] {
  const { doc } = ctx;
  const out: HTMLElement[] = [];
  const ps = parametersFor(doc, el.category);
  if (ps.length) {
    const sec = h("div", { class: "section" }, h("h3", {}, "Project parameters"));
    for (const p of ps) {
      const name = p.name ?? "";
      const v = customValue(doc, el, name);
      const set = (val: string | number | boolean) => edit(ctx, `Set ${name}`, (tx) => setCustomValue(tx, doc, el, name, val));
      let control: HTMLElement;
      if (p.params.dataType === "yesno") {
        const cb = h("input", { type: "checkbox", checked: v === true });
        cb.onchange = () => set(cb.checked);
        control = cb;
      } else if (p.params.dataType === "length") {
        control = numberInput(typeof v === "number" ? v : 0, (n) => set(n));
      } else {
        control = textInput(v === undefined ? "" : String(v), (t) => set(t));
      }
      sec.append(row(`${name}${p.params.binding === "type" ? " (type)" : ""}`, control));
    }
    out.push(sec);
  }
  const globals = globalParameters(doc);
  const numeric = Object.entries(el.params).filter(([, v]) => typeof v === "number").map(([k]) => k);
  if (globals.length && numeric.length && !familyInfo(doc)) {
    const sec = h("div", { class: "section" }, h("h3", {}, "Driven by global parameters"));
    const assoc = globalAssociations(el);
    for (const key of numeric) {
      sec.append(
        row(
          key,
          select([{ value: "", label: "\u2014" }, ...globals.map((g) => ({ value: g.name ?? "", label: g.name ?? "" }))], assoc[key] ?? "", (v) =>
            edit(ctx, `Associate ${key}`, (tx) => associateGlobal(tx, doc, el.id, key, v || null)),
          ),
        ),
      );
    }
    out.push(sec);
  }
  return out;
}

/** Sheet properties: title block fields, paper size, placing views. */
function sheetSection(ctx: PanelContext, sheet: Element<SheetParams>): HTMLElement {
  const { doc } = ctx;
  const p = sheet.params;
  const set = (name: string, patch: Partial<SheetParams>) => edit(ctx, name, (tx) => tx.update<SheetParams>(sheet.id, patch));
  const sec = h("div", { class: "section" }, h("h3", {}, "Sheet"));
  sec.append(
    row(
      "Sheet number",
      textInput(p.number, (v) =>
        edit(ctx, "Renumber sheet", (tx) => {
          if (!v) throw new Error("Sheets need a number");
          if (doc.byCategory<SheetParams>(Cat.Sheet).some((s) => s.id !== sheet.id && s.params.number === v)) throw new Error(`Sheet ${v} already exists`);
          tx.update<SheetParams>(sheet.id, { number: v });
        }),
      ),
    ),
    row("Sheet name", textInput(sheet.name ?? "", (v) => edit(ctx, "Rename sheet", (tx) => tx.setName(sheet.id, v || undefined)))),
    row(
      "Paper size",
      select(
        (Object.keys(PAPER_SIZES) as PaperSize[]).map((s) => ({ value: s, label: `${s} (${PAPER_SIZES[s].width} \u00d7 ${PAPER_SIZES[s].height})` })),
        p.size,
        (v) => set("Change paper size", { size: v as PaperSize }),
      ),
    ),
    row("Drawn by", textInput(p.drawnBy, (v) => set("Edit title block", { drawnBy: v }))),
    row("Checked by", textInput(p.checkedBy, (v) => set("Edit title block", { checkedBy: v }))),
    row("Issue date", textInput(p.issueDate, (v) => set("Edit title block", { issueDate: v }))),
  );
  // Revisions on the sheet: clouded ones are fixed; others can be ticked on by hand.
  const revs = revisions(doc);
  if (revs.length) {
    const shown = new Set(sheetRevisions(doc, sheet as Sheet).map((r) => r.id));
    const manual = new Set(p.revisionIds ?? []);
    sec.append(h("h3", {}, "Revisions on sheet"));
    for (const r of revs) {
      const clouded = shown.has(r.id) && !manual.has(r.id);
      const cb = checkbox(shown.has(r.id), (v) => set("Revisions on sheet", { revisionIds: v ? [...manual, r.id] : [...manual].filter((x) => x !== r.id) }));
      cb.disabled = clouded;
      sec.append(h("label", { class: "check", title: clouded ? "Clouded on this sheet" : "" }, cb, `${revisionNumber(doc, r)}  ${r.params.description}`));
    }
  }
  // Views not yet on a sheet can be placed.
  const placeable = viewElements(doc).filter((v) => v.params.kind !== "3d" && !sheetOfView(doc, v.id));
  if (placeable.length) {
    sec.append(
      row(
        "Place view",
        select([{ value: "", label: "Choose\u2026" }, ...placeable.map((v) => ({ value: v.id, label: v.name ?? v.id }))], "", (v) => {
          if (v) edit(ctx, "Place view on sheet", (tx) => placeView(tx, doc, sheet.id, v));
        }),
      ),
    );
  }
  sec.append(h("h3", {}, "Viewports"));
  for (const vp of viewportsOn(doc, sheet.id)) {
    const div = h("div", { class: "list-item" }, h("span", {}, doc.get(vp.params.viewId)?.name ?? "(deleted)"));
    div.onclick = () => ctx.setSelection([vp.id]);
    sec.append(div);
  }
  const del = h("button", { class: "danger", textContent: "Delete sheet" });
  del.onclick = () => edit(ctx, "Delete sheet", (tx) => tx.delete(sheet.id));
  return h("div", {}, sec, h("div", { class: "section" }, del));
}

/** Scale and detail level, for a view or a view template. */
function graphicsRows(ctx: PanelContext, id: ElementId, p: ViewGraphicsParams): HTMLElement[] {
  const set = (name: string, patch: Partial<ViewGraphicsParams>) => edit(ctx, name, (tx) => tx.update<ViewGraphicsParams>(id, patch));
  return [
    row(
      "View scale",
      select(SCALES.map((s) => ({ value: String(s), label: `1 : ${s}` })), String(p.scale), (v) => set("Change view scale", { scale: Number(v) })),
    ),
    row(
      "Detail level",
      select(
        (["coarse", "medium", "fine"] as const).map((d) => ({ value: d, label: d[0]!.toUpperCase() + d.slice(1) })),
        p.detailLevel,
        (v) => set("Change detail level", { detailLevel: v as DetailLevel }),
      ),
    ),
  ];
}

/** Categories shown in the V/G table, model first then annotation (Revit's two tabs). */
const VG_CATEGORIES: [string, string][] = [
  [Cat.Wall, "Walls"],
  [Cat.Floor, "Floors"],
  [Cat.Ceiling, "Ceilings"],
  [Cat.Roof, "Roofs"],
  [Cat.Door, "Doors"],
  [Cat.Window, "Windows"],
  [Cat.WallOpening, "Openings"],
  [Cat.Stair, "Stairs"],
  [Cat.Railing, "Railings"],
  [Cat.Ramp, "Ramps"],
  [Cat.Toposolid, "Topography"],
  [Cat.Column, "Structural columns"],
  [Cat.Beam, "Structural framing"],
  [Cat.PadFooting, "Foundations (pads)"],
  [Cat.StripFooting, "Foundations (strips)"],
  [Cat.Room, "Rooms"],
  [Cat.RoomSeparator, "Room separators"],
  [Cat.Area, "Areas"],
  [Cat.Link, "Linked models"],
  [Cat.AreaBoundary, "Area boundaries"],
  [Cat.Grid, "Grids"],
  [Cat.ReferencePlane, "Reference planes"],
  [Cat.View, "View markers"],
  [Cat.Dimension, "Dimensions"],
  [Cat.TextNote, "Text"],
  [Cat.Tag, "Tags"],
  [Cat.DetailLine, "Detail lines"],
  [Cat.FilledRegion, "Filled regions"],
];

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

/** Visible / halftone / colour controls for one override. */
function overrideControls(o: GraphicOverride, visibleDefault: boolean, onChange: (o: GraphicOverride) => void): HTMLElement {
  const vis = h("input", { type: "checkbox", checked: o.visible ?? visibleDefault, title: "Visible" });
  vis.onchange = () => onChange({ ...o, visible: vis.checked });
  const half = h("input", { type: "checkbox", checked: !!o.halftone, title: "Halftone" });
  half.onchange = () => onChange({ ...o, halftone: half.checked || undefined });
  const col = h("input", { type: "color", value: hex(o.color ?? 0xd8dde4), title: "Line colour override" });
  col.classList.toggle("unset", o.color === undefined);
  col.onchange = () => onChange({ ...o, color: parseInt(col.value.slice(1), 16) });
  const clear = h("button", { textContent: "\u00d7", title: "Clear colour override", class: "mini" });
  clear.onclick = () => {
    const { color: _c, ...rest } = o;
    void _c;
    onChange(rest);
  };
  return h("div", { class: "vg-controls" }, vis, half, col, clear);
}

/** Visibility/Graphics for a view or template: categories, then applied filters. */
function visibilityGraphics(ctx: PanelContext, id: ElementId, p: ViewGraphicsParams): HTMLElement {
  const { doc } = ctx;
  const update = (name: string, patch: Partial<ViewGraphicsParams>) => edit(ctx, name, (tx) => tx.update<ViewGraphicsParams>(id, patch));
  const box = h("div", { class: "vg" }, h("h3", {}, "Visibility/Graphics"), h("div", { class: "vg-head" }, h("span", {}, ""), h("span", {}, "Vis \u00b7 Half \u00b7 Colour")));
  for (const [cat, label] of VG_CATEGORIES) {
    const o = p.categoryOverrides?.[cat] ?? {};
    const hidden = p.hiddenCategories.includes(cat);
    box.append(
      h(
        "div",
        { class: "vg-row" },
        h("span", {}, label),
        overrideControls({ ...o, visible: !hidden && o.visible !== false }, true, (next) => {
          const hiddenCategories = next.visible === false ? [...new Set([...p.hiddenCategories, cat])] : p.hiddenCategories.filter((c) => c !== cat);
          const { visible: _v, ...rest } = next;
          void _v;
          update(`V/G: ${label}`, { hiddenCategories, categoryOverrides: { ...(p.categoryOverrides ?? {}), [cat]: rest } });
        }),
      ),
    );
  }
  box.append(h("h3", {}, "Filters (top wins)"));
  const applied = p.filters ?? [];
  applied.forEach((af, i) => {
    const f = doc.get(af.filterId);
    const setAt = (next: AppliedFilter | null) => {
      const list = applied.flatMap((x, j) => (j === i ? (next ? [next] : []) : [x]));
      update("Edit view filters", { filters: list });
    };
    const remove = h("button", { textContent: "Remove", class: "mini" });
    remove.onclick = () => setAt(null);
    box.append(
      h(
        "div",
        { class: "vg-row" },
        h("span", {}, f?.name ?? "(deleted filter)"),
        overrideControls(af.override, true, (override) => setAt({ ...af, override })),
      ),
      h("div", { class: "row" }, h("span", {}), remove),
    );
  });
  const available = doc.byCategory(Cat.ViewFilter).filter((f) => !applied.some((a) => a.filterId === f.id));
  if (available.length) {
    box.append(
      row(
        "Add filter",
        select([{ value: "", label: "Choose\u2026" }, ...available.map((f) => ({ value: f.id, label: f.name ?? f.id }))], "", (v) => {
          if (v) update("Add view filter", { filters: [...applied, { filterId: v, override: { color: 0xff6b3d } }] });
        }),
      ),
    );
  }
  return box;
}

const FILTER_FIELDS: [string, string][] = [
  ["type", "Type name"],
  ["name", "Name"],
  ["baseLevelId", "Base level"],
  ["levelId", "Level"],
  ["height", "Unconnected height"],
  ["baseOffset", "Base offset"],
  ["sillHeight", "Sill height"],
];
const FILTER_OPS: [FilterOp, string][] = [
  ["equals", "equals"],
  ["notEquals", "does not equal"],
  ["contains", "contains"],
  ["notContains", "does not contain"],
  ["greater", "is greater than"],
  ["less", "is less than"],
];

/** Filter editor: name, categories, rules. */
function filterSection(ctx: PanelContext, id: ElementId, name: string, p: ViewFilterParams): HTMLElement {
  const update = (label: string, patch: Partial<ViewFilterParams>) => edit(ctx, label, (tx) => tx.update<ViewFilterParams>(id, patch));
  const sec = h("div", { class: "section" }, h("h3", {}, "Filter"));
  sec.append(row("Name", textInput(name, (v) => edit(ctx, "Rename filter", (tx) => tx.setName(id, v || undefined)))));
  sec.append(h("h3", {}, "Categories (none ticked = all)"));
  for (const [cat, label] of VG_CATEGORIES) {
    const cb = h("input", { type: "checkbox", checked: p.categories.includes(cat) });
    cb.onchange = () =>
      update("Edit filter categories", { categories: cb.checked ? [...p.categories, cat] : p.categories.filter((c) => c !== cat) });
    sec.append(h("label", { class: "check" }, cb, label));
  }
  sec.append(h("h3", {}, "Rules (all must match)"));
  const setRule = (i: number, r: FilterRule | null) =>
    update("Edit filter rules", { rules: p.rules.flatMap((x, j) => (j === i ? (r ? [r] : []) : [x])) });
  p.rules.forEach((r, i) => {
    const field = select(FILTER_FIELDS.map(([value, label]) => ({ value, label })), r.field, (v) => setRule(i, { ...r, field: v }));
    const op = select(FILTER_OPS.map(([value, label]) => ({ value, label })), r.op, (v) => setRule(i, { ...r, op: v as FilterOp }));
    const value = textInput(r.value, (v) => setRule(i, { ...r, value: v }));
    const remove = h("button", { textContent: "\u00d7", class: "mini" });
    remove.onclick = () => setRule(i, null);
    sec.append(h("div", { class: "rule" }, field, op, value, remove));
  });
  const add = h("button", { textContent: "Add rule" });
  add.onclick = () => update("Add filter rule", { rules: [...p.rules, { field: "type", op: "contains", value: "" }] });
  sec.append(row("", add));
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
  // Shared coordinates (survey point).
  const loc = p.location ?? DEFAULT_LOCATION;
  const setLoc = (patch: Partial<SiteLocation>) => set("Change project location", { location: { ...loc, ...patch } });
  const locSec = h("div", { class: "section" }, h("h3", {}, "Location (shared coordinates)"));
  const metres = (v: number, onCommit: (x: number) => void) => {
    const input = h("input", { type: "number", step: "0.001", value: String(v) });
    input.onchange = () => {
      const x = Number(input.value);
      if (Number.isFinite(x)) onCommit(x);
    };
    return input;
  };
  locSec.append(
    row("Coordinate system", select(CRS_OPTIONS.map((c) => ({ value: String(c.epsg), label: `EPSG:${c.epsg} ${c.name.replace("NZGD2000 / ", "")}` })), String(loc.epsg), (v) => setLoc({ epsg: Number(v) }))),
    row("Eastings (m)", metres(loc.eastings, (v) => setLoc({ eastings: v }))),
    row("Northings (m)", metres(loc.northings, (v) => setLoc({ northings: v }))),
    row("Height (m)", metres(loc.height, (v) => setLoc({ height: v }))),
    row(
      "Angle to true north (\u00b0)",
      metres(Math.round(((loc.rotation * 180) / Math.PI) * 1e4) / 1e4, (v) => setLoc({ rotation: (v * Math.PI) / 180 })),
    ),
    row("DXF plans in shared coordinates", checkbox(loc.dxfShared === true, (v) => setLoc({ dxfShared: v }))),
    row("", h("span", { class: "muted" }, "Project origin's map position; project north turned anticlockwise from grid north. Written to IFC as IfcMapConversion.")),
  );
  // Phases, in order.
  const phSec = h("div", { class: "section" }, h("h3", {}, "Phases"));
  const list = p.phases ?? DEFAULT_PHASES;
  const setList = (next: typeof list) => edit(ctx, "Edit phases", (tx) => setPhases(tx, ctx.doc, next));
  list.forEach((ph, i) => {
    const rm = h("button", { textContent: "\u00d7", class: "mini", disabled: list.length <= 1 });
    rm.onclick = () => setList(list.filter((_, j) => j !== i));
    phSec.append(h("div", { class: "buttons wrap" }, h("span", { class: "muted" }, String(i + 1)), textInput(ph.name, (v) => v && setList(list.map((x, j) => (j === i ? { ...x, name: v } : x)))), rm));
  });
  const addPhase = h("button", { textContent: "Add phase" });
  addPhase.onclick = () => {
    let n = list.length + 1;
    while (list.some((x) => x.id === `phase${n}`)) n++;
    setList([...list, { id: `phase${n}`, name: `Phase ${n}` }]);
  };
  phSec.append(row("", addPhase));
  return [info, unitsSec, locSec, phSec];
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
  if (familyInfo(doc)) return renderFamilyBrowser(root, ctx);
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
    ...(Object.keys(AREA_SCHEMES) as AreaScheme[]).map((s): [string, View[]] => [
      `Area Plans (${AREA_SCHEMES[s].short})`,
      allViews
        .filter((v) => v.params.kind === "areaPlan" && v.params.areaScheme === s)
        .sort((a, b) => (levelOrder.get(a.params.levelId!) ?? 0) - (levelOrder.get(b.params.levelId!) ?? 0)),
    ]),
    ["Sections", allViews.filter((v) => v.params.kind === "section")],
    ["Elevations", allViews.filter((v) => v.params.kind === "elevation")],
    ["3D Views", allViews.filter((v) => v.params.kind === "3d")],
    ["Legends", allViews.filter((v) => v.params.kind === "legend")],
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
  viewsSec.append(
    row(
      "New area plan",
      select(
        [
          { value: "", label: "Level\u2026" },
          ...(Object.keys(AREA_SCHEMES) as AreaScheme[]).flatMap((s) =>
            levels(doc).map((l) => ({ value: `${s}|${l.id}`, label: `${AREA_SCHEMES[s].short}: ${l.name ?? l.id}` })),
          ),
        ],
        "",
        (v) => {
          if (!v) return;
          const [s, id] = v.split("|");
          ctx.newAreaPlan(id!, s as AreaScheme);
        },
      ),
    ),
  );
  const newLegend = h("button", { textContent: "New legend" });
  newLegend.onclick = () =>
    edit(ctx, "New legend", (tx) => {
      const v = createLegend(tx, doc);
      queueMicrotask(() => ctx.setActiveView(v.id));
    });
  viewsSec.append(row("", newLegend));
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
  const plainWalls = doc.byCategory<LayeredTypeParams>(Cat.WallType).filter((t) => !t.params.stack && !t.params.curtain);
  if (plainWalls.length >= 2) {
    const newStack = h("button", { textContent: "New stacked wall type" });
    newStack.onclick = () =>
      edit(ctx, "New stacked wall type", (tx) => {
        let name = "Stacked Wall 1";
        for (let i = 2; doc.byCategory(Cat.WallType).some((t) => t.name === name); i++) name = `Stacked Wall ${i}`;
        const st = createStackedWallType(tx, doc, name, [
          { typeId: plainWalls[1]!.id, height: 900 },
          { typeId: plainWalls[0]!.id, height: 0 },
        ]);
        queueMicrotask(() => ctx.setSelection([st.id]));
      });
    types.append(row("", newStack));
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
  const kImp = h("button", { textContent: "Load keynotes" });
  kImp.onclick = () => ctx.importKeynotes();
  const kExp = h("button", { textContent: "Export" });
  kExp.onclick = () => ctx.exportKeynotes();
  project.append(row(`Keynotes (${keynoteTable(doc).length})`, h("div", { class: "buttons" }, kImp, kExp)));

  // Sheets.
  const sheetsSec = h("div", { class: "section" }, h("h3", {}, "Sheets"));
  for (const s of sheetElements(doc)) {
    const div = h(
      "div",
      { class: `list-item${s.id === ctx.activeViewId() ? " selected" : ""}` },
      h("span", {}, `${s.params.number} - ${s.name ?? ""}`),
      h("span", { class: "muted" }, s.params.size),
    );
    div.onclick = () => ctx.setActiveView(s.id);
    sheetsSec.append(div);
  }
  const newSheet = h("button", { textContent: "New sheet" });
  newSheet.onclick = () => {
    try {
      const s = doc.transact("Create sheet", (tx) => createSheet(tx, doc));
      ctx.setActiveView(s.id);
    } catch (err) {
      ctx.status(`\u26a0 ${(err as Error).message}`);
    }
  };
  sheetsSec.append(row("", newSheet));

  // Filters and view templates (Revit keeps these in dialogs; a list is quicker here).
  const vg = h("div", { class: "section" }, h("h3", {}, "Filters & View Templates"));
  for (const f of doc.byCategory(Cat.ViewFilter)) {
    const div = h("div", { class: `list-item${sel.has(f.id) ? " selected" : ""}` }, h("span", {}, f.name ?? f.id), h("span", { class: "muted" }, "filter"));
    div.onclick = () => ctx.setSelection([f.id]);
    vg.append(div);
  }
  for (const t of doc.byCategory(Cat.ViewTemplate)) {
    const div = h("div", { class: `list-item${sel.has(t.id) ? " selected" : ""}` }, h("span", {}, t.name ?? t.id), h("span", { class: "muted" }, "template"));
    div.onclick = () => ctx.setSelection([t.id]);
    vg.append(div);
  }
  const newFilter = h("button", { textContent: "New filter" });
  newFilter.onclick = () => {
    try {
      const f = doc.transact("Create filter", (tx) => {
        let name = "Filter 1";
        for (let i = 2; doc.byCategory(Cat.ViewFilter).some((x) => x.name === name); i++) name = `Filter ${i}`;
        return createViewFilter(tx, doc, name, { categories: [Cat.Wall], rules: [{ field: "type", op: "contains", value: "Exterior" }] });
      });
      ctx.setSelection([f.id]);
    } catch (err) {
      ctx.status(`\u26a0 ${(err as Error).message}`);
    }
  };
  vg.append(row("", newFilter));

  // Families: loaded (embedded) families and starting new ones.
  const fams = h("div", { class: "section" }, h("h3", {}, "Families"));
  for (const f of familyDefs(doc)) {
    const div = h("div", { class: `list-item${sel.has(f.id) ? " selected" : ""}` }, h("span", {}, f.name ?? f.id), h("span", { class: "muted" }, f.params.category));
    div.onclick = () => ctx.setSelection([f.id]);
    fams.append(div);
  }
  fams.append(
    row(
      "New family",
      select(
        [{ value: "", label: "Category\u2026" }, ...FAMILY_CATEGORIES.map(([v, l]) => ({ value: v, label: l }))],
        "",
        (v) => v && ctx.newFamily(v as FamilyCategory),
      ),
    ),
    row(
      "Load from library",
      select(
        [{ value: "", label: "Family…" }, ...ctx.libraryFamilies().map((f) => ({ value: f.name, label: f.name }))],
        "",
        (v) => v && ctx.loadLibraryFamily(v),
      ),
    ),
  );
  const loadFile = h("button", { textContent: "Load family file…" });
  loadFile.onclick = () => ctx.loadFamilyFile();
  fams.append(row("", h("div", { class: "buttons" }, loadFile)));

  // Linked projects.
  const linkSec = h("div", { class: "section" }, h("h3", {}, "Links"));
  for (const l of links(doc)) {
    const div = h("div", { class: `list-item${sel.has(l.id) ? " selected" : ""}` }, h("span", {}, l.name ?? l.id), h("span", { class: "muted" }, l.params.positioning === "shared" ? "shared" : "origin"));
    div.onclick = () => ctx.setSelection([l.id]);
    linkSec.append(div);
  }
  const addLink = h("button", { textContent: "Link project\u2026" });
  addLink.onclick = () => ctx.linkProject();
  linkSec.append(row("", addLink));

  // Sheet issues / revisions, in sequence.
  const revSec = h("div", { class: "section" }, h("h3", {}, "Revisions"));
  for (const r of revisions(doc)) {
    const div = h(
      "div",
      { class: `list-item${sel.has(r.id) ? " selected" : ""}` },
      h("span", {}, `${revisionNumber(doc, r)}  ${r.params.description || "(no description)"}`),
      h("span", { class: "muted" }, r.params.issued ? "issued" : r.params.date),
    );
    div.onclick = () => ctx.setSelection([r.id]);
    revSec.append(div);
  }
  const newRev = h("button", { textContent: "New revision" });
  newRev.onclick = () =>
    edit(ctx, "New revision", (tx) => {
      const r = createRevision(tx, doc, { date: new Date().toISOString().slice(0, 10) });
      queueMicrotask(() => ctx.setSelection([r.id]));
    });
  revSec.append(row("", newRev));

  // Schedules / quantities and material takeoffs (open like views).
  const schedSec = h("div", { class: "section" }, h("h3", {}, "Schedules/Quantities"));
  for (const s of schedules(doc)) {
    const div = h("div", { class: `list-item${s.id === ctx.activeViewId() ? " selected" : ""}` }, h("span", {}, s.name ?? s.id));
    div.onclick = () => ctx.setActiveView(s.id);
    schedSec.append(div);
  }
  const newSchedule = (kind: "schedule" | "takeoff") =>
    select(
      [
        { value: "", label: "Category\u2026" },
        ...SCHEDULE_CATEGORIES.filter(([c]) => kind === "schedule" || TAKEOFF_CATEGORIES.has(c)).map(([v, l]) => ({ value: v, label: l })),
      ],
      "",
      (v) => {
        if (!v) return;
        edit(ctx, kind === "takeoff" ? "New material takeoff" : "New schedule", (tx) => {
          const s = createSchedule(tx, doc, v, { kind });
          queueMicrotask(() => ctx.setActiveView(s.id));
        });
      },
    );
  schedSec.append(row("New schedule", newSchedule("schedule")), row("New takeoff", newSchedule("takeoff")));

  // Project, shared and global parameters.
  const paramsSec = h("div", { class: "section" }, h("h3", {}, "Parameters"));
  for (const p of projectParameters(doc)) {
    const div = h(
      "div",
      { class: `list-item${sel.has(p.id) ? " selected" : ""}` },
      h("span", {}, p.name ?? p.id),
      h("span", { class: "muted" }, p.params.guid ? "shared" : "project"),
    );
    div.onclick = () => ctx.setSelection([p.id]);
    paramsSec.append(div);
  }
  for (const g of globalParameters(doc)) {
    const v = (() => {
      try {
        return len(globalValues(doc)[g.name ?? ""] ?? 0);
      } catch {
        return "error";
      }
    })();
    const div = h("div", { class: `list-item${sel.has(g.id) ? " selected" : ""}` }, h("span", {}, `\u2295 ${g.name}`), h("span", { class: "muted" }, v));
    div.onclick = () => ctx.setSelection([g.id]);
    paramsSec.append(div);
  }
  const uniq = (base: string, taken: (n: string) => boolean) => {
    let n = 1;
    while (taken(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  };
  const newProj = h("button", { textContent: "New project parameter" });
  newProj.onclick = () =>
    edit(ctx, "New project parameter", (tx) => {
      const p = createProjectParameter(tx, doc, uniq("Parameter", (n) => projectParameters(doc).some((x) => x.name === n)), { categories: [Cat.Wall] });
      queueMicrotask(() => ctx.setSelection([p.id]));
    });
  const newGlobal = h("button", { textContent: "New global parameter" });
  newGlobal.onclick = () =>
    edit(ctx, "New global parameter", (tx) => {
      const g = createGlobalParameter(tx, doc, uniq("Global", (n) => globalParameters(doc).some((x) => x.name === n)), { value: 2400 });
      queueMicrotask(() => ctx.setSelection([g.id]));
    });
  const imp = h("button", { textContent: "Import shared" });
  imp.onclick = () => ctx.importSharedParameters();
  const exp = h("button", { textContent: "Export shared" });
  exp.onclick = () => ctx.exportSharedParameters();
  paramsSec.append(
    h("div", { class: "buttons wrap" }, newProj, newGlobal),
    h("div", { class: "buttons wrap" }, imp, exp),
  );

  root.replaceChildren(project, views, schedSec, sheetsSec, revSec, linkSec, fams, paramsSec, lv, types, mats, vg, counts);
}

// ---- Properties -----------------------------------------------------------

export function renderProperties(root: HTMLElement, ctx: PanelContext): void {
  const { doc } = ctx;
  units = projectUnits(doc);
  const ids = ctx.selection().filter((id) => doc.has(id));
  if (ids.length === 0) {
    // Nothing selected: show the active view's properties, as Revit does.
    const active = ctx.activeViewId() ? doc.get(ctx.activeViewId()!) : undefined;
    if (familyInfo(doc)) {
      // Family editor: Family Types (parameters and values) first, then the view.
      root.replaceChildren(familyTypesSection(ctx), ...(active ? [viewSection(ctx, active as View)] : []));
      return;
    }
    if (active?.category === Cat.Sheet) {
      root.replaceChildren(sheetSection(ctx, active as Element<SheetParams>));
      return;
    }
    if (active?.category === Cat.Schedule) {
      root.replaceChildren(...scheduleSections(ctx, active as Schedule));
      return;
    }
    root.replaceChildren(active ? viewSection(ctx, active as View) : h("div", { class: "empty" }, "Nothing selected"));
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
        row("Room bounding", checkbox(p.roomBounding !== false, (v) => update<WallParams>("Change room bounding", { roomBounding: v }))),
      );
      break;
    }
    case Cat.Room: {
      const r = el as Room;
      const p = r.params;
      const b = roomBoundary(doc, r);
      const { bottom, top } = roomExtent(doc, r);
      sec.append(
        row("Name", textInput(r.name ?? "", (v) => edit(ctx, "Rename room", (tx) => tx.setName(r.id, v || undefined)))),
        row("Number", textInput(p.number, (v) => update<RoomParams>("Change room number", { number: v }))),
        row("Level", select(levelOpts, p.levelId, (v) => update<RoomParams>("Change room level", { levelId: v }))),
        row(
          "Upper limit",
          select([{ value: "", label: "(base level)" }, ...levelOpts], p.upperLevelId ?? "", (v) =>
            update<RoomParams>("Change upper limit", { upperLevelId: v || null }),
          ),
        ),
        row("Limit offset", numberInput(p.limitOffset, (v) => update<RoomParams>("Change limit offset", { limitOffset: v }))),
        row("Base offset", numberInput(p.baseOffset, (v) => update<RoomParams>("Change base offset", { baseOffset: v }))),
        row("Area", b ? formatArea(b.area, units) : "Not enclosed"),
        row("Perimeter", b ? len(b.perimeter) : "—"),
        row("Unbounded height", len(top - bottom)),
        row("Volume", b ? `${((b.area * (top - bottom)) / 1e9).toFixed(2)} m³` : "—"),
      );
      break;
    }
    case Cat.Area: {
      const a = el as Area;
      const b = areaBoundary(doc, a);
      const plan = doc.get<ViewParams>(a.params.viewId);
      sec.append(
        row("Name", textInput(a.name ?? "", (v) => edit(ctx, "Rename area", (tx) => tx.setName(a.id, v || undefined)))),
        row("Number", textInput(a.params.number, (v) => update<AreaParams>("Change area number", { number: v }))),
        row("Area scheme", plan?.params.areaScheme ? AREA_SCHEMES[plan.params.areaScheme].label : ""),
        row("Area", b ? formatArea(b.area, units) : "Not enclosed"),
        row("Perimeter", b ? len(b.perimeter) : "\u2014"),
      );
      break;
    }
    case Cat.Tag: {
      const p = el.params as TagParams;
      const host = doc.get(p.hostId);
      const sel = h("button", { textContent: "Select tagged element" });
      sel.onclick = () => ctx.setSelection([p.hostId]);
      sec.append(
        row("Tags", host ? `${host.category} ${host.name ?? ""}`.trim() : "(missing)"),
        row("Text", tagText(doc, el as never)),
        row("Leader", checkbox(p.leader, (v) => update<TagParams>("Change leader", { leader: v }))),
        row("Offset X", numberInput(p.offset.x, (v) => update<TagParams>("Move tag", { offset: { ...p.offset, x: v } }))),
        row("Offset Y", numberInput(p.offset.y, (v) => update<TagParams>("Move tag", { offset: { ...p.offset, y: v } }))),
        row("", sel),
      );
      break;
    }
    case Cat.LegendComponent: {
      const p = el.params as LegendComponentParams;
      const type = doc.get(p.typeId);
      const same = doc.all().filter((e) => e.category === type?.category);
      sec.append(
        row("Type", select(same.map((t) => ({ value: t.id, label: t.name ?? t.id })), p.typeId, (v) => update<LegendComponentParams>("Change legend type", { typeId: v }))),
        ...(type && type.category !== Cat.DoorType && type.category !== Cat.WindowType
          ? [row("Host length", numberInput(p.length, (v) => (v > 0 ? update<LegendComponentParams>("Change length", { length: v }) : ctx.status("\u26a0 Length must be positive"))))]
          : []),
        row("Label", checkbox(p.label, (v) => update<LegendComponentParams>("Toggle label", { label: v }))),
        row("X", numberInput(p.position.x, (v) => update<LegendComponentParams>("Move component", { position: { ...p.position, x: v } }))),
        row("Y", numberInput(p.position.y, (v) => update<LegendComponentParams>("Move component", { position: { ...p.position, y: v } }))),
      );
      break;
    }
    case Cat.KeynoteLegend: {
      const p = el.params as KeynoteLegendParams;
      const vs = viewElements(doc).filter((v) => v.params.kind !== "3d" && v.params.kind !== "legend");
      sec.append(
        row(
          "Keynotes from",
          select([{ value: "", label: "All views" }, ...vs.map((v) => ({ value: v.id, label: v.name ?? v.id }))], p.sourceViewId ?? "", (v) =>
            update<KeynoteLegendParams>("Change keynote legend source", { sourceViewId: v || null }),
          ),
        ),
        row("X", numberInput(p.position.x, (v) => update<KeynoteLegendParams>("Move keynote legend", { position: { ...p.position, x: v } }))),
        row("Y", numberInput(p.position.y, (v) => update<KeynoteLegendParams>("Move keynote legend", { position: { ...p.position, y: v } }))),
      );
      break;
    }
    case Cat.Stair: {
      const s = el as Stair;
      const p = s.params;
      const L = stairLayout(doc, s);
      sec.append(
        row("Type", select(typeOpts(Cat.StairType), s.typeId ?? "", (v) => edit(ctx, "Change stair type", (tx) => tx.setType(s.id, v)))),
        row("Base level", select(levelOpts, p.baseLevelId, (v) => update<StairParams>("Change stair base", { baseLevelId: v }))),
        row("Base offset", numberInput(p.baseOffset, (v) => update<StairParams>("Change stair base offset", { baseOffset: v }))),
        row("Top level", select(levelOpts, p.topLevelId, (v) => update<StairParams>("Change stair top", { topLevelId: v }))),
        row("Top offset", numberInput(p.topOffset, (v) => update<StairParams>("Change stair top offset", { topOffset: v }))),
        row("Risers", `${L.risers} \u00d7 ${L.riser.toFixed(1)} mm`),
        row("Going", len(L.going)),
        row("Runs", L.runs.map((r) => r.risers).join(" + ")),
        h("h3", {}, "NZBC D1/AS1 (private stairway)"),
      );
      for (const c of L.checks) sec.append(row(c.ok ? "\u2713" : "\u2717", h("span", { class: c.ok ? "" : "warn" }, c.label)));
      break;
    }
    case Cat.Column: {
      const p = el.params as ColumnParams;
      sec.append(
        row("Type", select(typeOpts(Cat.StructuralType), el.typeId ?? "", (v) => edit(ctx, "Change section", (tx) => tx.setType(el.id, v)))),
        row("Base level", select(levelOpts, p.baseLevelId, (v) => update<ColumnParams>("Change column base", { baseLevelId: v }))),
        row("Base offset", numberInput(p.baseOffset, (v) => update<ColumnParams>("Change column base offset", { baseOffset: v }))),
        row("Top level", select(levelOpts, p.topLevelId, (v) => update<ColumnParams>("Change column top", { topLevelId: v }))),
        row("Top offset", numberInput(p.topOffset, (v) => update<ColumnParams>("Change column top offset", { topOffset: v }))),
        row("Rotation (\u00b0)", numberInput(Math.round(((p.rotation * 180) / Math.PI) * 100) / 100, (v) => update<ColumnParams>("Rotate column", { rotation: (v * Math.PI) / 180 }))),
      );
      break;
    }
    case Cat.Beam: {
      const p = el.params as BeamParams;
      sec.append(
        row("Type", select(typeOpts(Cat.StructuralType), el.typeId ?? "", (v) => edit(ctx, "Change section", (tx) => tx.setType(el.id, v)))),
        row("Reference level", select(levelOpts, p.levelId, (v) => update<BeamParams>("Change beam level", { levelId: v }))),
        row("Top offset", numberInput(p.offset, (v) => update<BeamParams>("Change beam offset", { offset: v }))),
        row("Length", len(Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y))),
      );
      break;
    }
    case Cat.PadFooting: {
      const p = el.params as PadFootingParams;
      const num = (k: "width" | "length" | "depth", label: string) =>
        row(label, numberInput(p[k], (v) => (v > 0 ? update<PadFootingParams>("Edit footing", { [k]: v }) : ctx.status("\u26a0 Must be positive"))));
      sec.append(
        row("Level", select(levelOpts, p.levelId, (v) => update<PadFootingParams>("Change footing level", { levelId: v }))),
        row("Top offset", numberInput(p.offset, (v) => update<PadFootingParams>("Change footing offset", { offset: v }))),
        num("width", "Width"),
        num("length", "Length"),
        num("depth", "Depth"),
      );
      break;
    }
    case Cat.StripFooting: {
      const p = el.params as StripFootingParams;
      sec.append(
        row("Width", numberInput(p.width, (v) => (v > 0 ? update<StripFootingParams>("Edit footing", { width: v }) : ctx.status("\u26a0 Must be positive")))),
        row("Depth", numberInput(p.depth, (v) => (v > 0 ? update<StripFootingParams>("Edit footing", { depth: v }) : ctx.status("\u26a0 Must be positive")))),
      );
      break;
    }
    case Cat.StructuralType: {
      const p = el.params as StructuralSectionParams;
      const set = (k: "d" | "b" | "tf" | "tw", label: string) => row(label, numberInput(p[k], (v) => update<StructuralSectionParams>("Edit section", { [k]: Math.max(0, v) })));
      const matOpts = [{ value: "", label: "\u2014" }, ...materialElements(doc).map((m) => ({ value: m.id, label: m.name ?? m.id }))];
      sec.append(
        row("Name", textInput(el.name ?? "", (v) => v && edit(ctx, "Rename type", (tx) => tx.setName(el.id, v)))),
        row(
          "Shape",
          select(
            [
              { value: "rect", label: "Rectangle" },
              { value: "circle", label: "Circle" },
              { value: "I", label: "I-section" },
              { value: "SHS", label: "Hollow section (SHS/RHS)" },
            ],
            p.shape,
            (v) => update<StructuralSectionParams>("Change shape", { shape: v as StructuralSectionParams["shape"] }),
          ),
        ),
        set("d", p.shape === "circle" ? "Diameter" : "Depth"),
        ...(p.shape === "circle" ? [] : [set("b", "Width")]),
        ...(p.shape === "I" || p.shape === "SHS" ? [set("tf", p.shape === "I" ? "Flange thickness" : "Wall thickness (top/bottom)"), set("tw", p.shape === "I" ? "Web thickness" : "Wall thickness (sides)")] : []),
        row("Material", select(matOpts, p.materialId ?? "", (v) => update<StructuralSectionParams>("Change material", { materialId: v || null }))),
      );
      break;
    }
    case Cat.Toposolid: {
      const p = el.params as ToposolidParams;
      const imp = h("button", { textContent: "Import survey CSV\u2026" });
      imp.title = "Rows of E, N, RL (or id, E, N, RL) in metres; converted with the project's shared coordinates";
      imp.onclick = () => ctx.importSurvey(el.id);
      const clear = h("button", { textContent: "Clear points", disabled: !p.points.length });
      clear.onclick = () => update<ToposolidParams>("Clear survey points", { points: [] });
      const matOpts = [{ value: "", label: "\u2014" }, ...materialElements(doc).map((m) => ({ value: m.id, label: m.name ?? m.id }))];
      sec.append(
        row("Level", select(levelOpts, p.levelId, (v) => update<ToposolidParams>("Change toposolid level", { levelId: v }))),
        row("Spot heights", String(p.points.length)),
        row("Thickness below lowest", numberInput(p.thickness, (v) => (v > 0 ? update<ToposolidParams>("Change thickness", { thickness: v }) : ctx.status("\u26a0 Must be positive")))),
        row("Contour interval", numberInput(p.contourInterval, (v) => update<ToposolidParams>("Change contour interval", { contourInterval: Math.max(0, v) }))),
        row("Material", select(matOpts, p.materialId ?? "", (v) => update<ToposolidParams>("Change toposolid material", { materialId: v || null }))),
        row("", h("div", { class: "buttons wrap" }, imp, clear)),
      );
      break;
    }
    case Cat.Ramp: {
      const r = el as Ramp;
      const p = r.params;
      const L = rampLayout(doc, r);
      sec.append(
        row("Type", select(typeOpts(Cat.RampType), r.typeId ?? "", (v) => edit(ctx, "Change ramp type", (tx) => tx.setType(r.id, v)))),
        row("Base level", select(levelOpts, p.baseLevelId, (v) => update<RampParams>("Change ramp base", { baseLevelId: v }))),
        row("Base offset", numberInput(p.baseOffset, (v) => update<RampParams>("Change ramp base offset", { baseOffset: v }))),
        row("Top level", select(levelOpts, p.topLevelId, (v) => update<RampParams>("Change ramp top", { topLevelId: v }))),
        row("Top offset", numberInput(p.topOffset, (v) => update<RampParams>("Change ramp top offset", { topOffset: v }))),
        row("Rise", len(L.height)),
        row("Run length", len(L.runs.reduce((s, x) => s + x.length, 0))),
        row("Needed at max gradient", len(rampLengthNeeded(doc, r))),
        h("h3", {}, "NZBC D1/AS1, NZS 4121"),
      );
      for (const c of L.checks) sec.append(row(c.ok ? "\u2713" : "\u2717", h("span", { class: c.ok ? "" : "warn" }, c.label)));
      break;
    }
    case Cat.RampType: {
      const p = el.params as RampTypeParams;
      const set = (k: keyof RampTypeParams, label: string) =>
        row(label, numberInput(p[k], (v) => (v > 0 ? update<RampTypeParams>("Edit ramp type", { [k]: v }) : ctx.status("\u26a0 Must be positive"))));
      sec.append(
        row("Name", textInput(el.name ?? "", (v) => v && edit(ctx, "Rename type", (tx) => tx.setName(el.id, v)))),
        set("width", "Width"),
        set("thickness", "Thickness"),
        set("maxSlope", "Steepest gradient (1:n)"),
      );
      break;
    }
    case Cat.Railing: {
      const p = el.params as RailingParams;
      const host = p.hostId ? doc.get(p.hostId) : undefined;
      sec.append(row("Type", select(typeOpts(Cat.RailingType), el.typeId ?? "", (v) => edit(ctx, "Change railing type", (tx) => tx.setType(el.id, v)))));
      if (host) {
        const sel2 = h("button", { textContent: "Select stair" });
        sel2.onclick = () => ctx.setSelection([host.id]);
        sec.append(row("Host", `Stair (${p.side})`), row("", sel2));
      } else {
        sec.append(
          row("Level", select(levelOpts, p.levelId, (v) => update<RailingParams>("Change railing level", { levelId: v }))),
          row("Base offset", numberInput(p.baseOffset, (v) => update<RailingParams>("Change railing offset", { baseOffset: v }))),
          row("Path points", String(p.path.length)),
        );
      }
      break;
    }
    case Cat.RailingType: {
      const p = el.params as RailingTypeParams;
      const set = (k: keyof RailingTypeParams, label: string) =>
        row(label, numberInput(p[k], (v) => (v > 0 ? update<RailingTypeParams>("Edit railing type", { [k]: v }) : ctx.status("\u26a0 Must be positive"))));
      sec.append(
        row("Name", textInput(el.name ?? "", (v) => v && edit(ctx, "Rename type", (tx) => tx.setName(el.id, v)))),
        set("height", "Height"),
        set("railSize", "Top rail size"),
        set("balusterSize", "Baluster size"),
        set("balusterGap", "Baluster gap"),
        h("h3", {}, "NZBC F4/AS1"),
        row(p.balusterGap <= 100 ? "\u2713" : "\u2717", h("span", { class: p.balusterGap <= 100 ? "" : "warn" }, `Openings ${p.balusterGap} mm \u2264 100`)),
        row(p.height >= 1000 ? "\u2713" : "\u2717", h("span", { class: p.height >= 1000 ? "" : "warn" }, `Barrier height ${p.height} mm \u2265 1000 (floors)`)),
      );
      break;
    }
    case Cat.StairType: {
      const p = el.params as StairTypeParams;
      const set = (k: keyof StairTypeParams, label: string) =>
        row(label, numberInput(p[k], (v) => (v > 0 ? update<StairTypeParams>("Edit stair type", { [k]: v }) : ctx.status("\u26a0 Must be positive"))));
      sec.append(
        row("Name", textInput(el.name ?? "", (v) => v && edit(ctx, "Rename type", (tx) => tx.setName(el.id, v)))),
        set("maxRiser", "Maximum riser"),
        set("going", "Going"),
        set("width", "Width"),
        set("waist", "Waist"),
        set("landingThickness", "Landing thickness"),
      );
      break;
    }
    case Cat.Link: {
      const l = el as Link;
      const p = l.params;
      const reload = h("button", { textContent: "Reload" });
      reload.onclick = () => ctx.reloadLink(l.id);
      let count = 0;
      try {
        count = linkDocument(l).all().length;
      } catch {
        count = 0;
      }
      sec.append(
        row("File", p.path),
        row("Elements", String(count)),
        row(
          "Positioning",
          select(
            [
              { value: "shared", label: "By shared coordinates" },
              { value: "origin", label: "Origin to origin" },
            ],
            p.positioning,
            (v) => update<LinkParams>("Change link positioning", { positioning: v as LinkParams["positioning"] }),
          ),
        ),
        row("Offset X", numberInput(p.offset.x, (v) => update<LinkParams>("Move link", { offset: { ...p.offset, x: v } }))),
        row("Offset Y", numberInput(p.offset.y, (v) => update<LinkParams>("Move link", { offset: { ...p.offset, y: v } }))),
        row("Offset Z", numberInput(p.offset.z, (v) => update<LinkParams>("Move link", { offset: { ...p.offset, z: v } }))),
        row("Rotation (\u00b0)", numberInput(Math.round(((p.rotation * 180) / Math.PI) * 100) / 100, (v) => update<LinkParams>("Rotate link", { rotation: (v * Math.PI) / 180 }))),
        row("", reload),
      );
      break;
    }
    case Cat.CadImport: {
      const p = el.params as CadImportParams;
      sec.append(
        row("File", el.name ?? ""),
        row("Lines", String(p.segments.length / 4)),
        row("Texts", String(p.texts.length)),
        row("Offset X", numberInput(p.offset.x, (v) => update<CadImportParams>("Move CAD import", { offset: { ...p.offset, x: v } }))),
        row("Offset Y", numberInput(p.offset.y, (v) => update<CadImportParams>("Move CAD import", { offset: { ...p.offset, y: v } }))),
        row("Layers", p.layers.join(", ") || "\u2014"),
      );
      break;
    }
    case Cat.DirectShape: {
      const p = el.params as DirectShapeParams;
      sec.append(
        row("IFC class", p.ifcClass),
        row("GlobalId", p.globalId || "\u2014"),
        row("Level", select(levelOpts, p.levelId, (v) => update<DirectShapeParams>("Change level", { levelId: v }))),
        row("Triangles", String(p.indices.length / 3)),
      );
      const props = Object.entries(p.properties);
      if (props.length) {
        sec.append(h("h3", {}, "IFC properties"));
        for (const [k, v] of props) sec.append(row(k, v));
      }
      break;
    }
    case Cat.Group: {
      const p = el.params as GroupParams;
      const type = el.typeId ? doc.get(el.typeId) : undefined;
      const others = el.typeId ? groupInstances(doc, el.typeId).length - 1 : 0;
      const move = (origin: { x: number; y: number }, rotation?: number) => edit(ctx, "Move group", (tx) => moveGroup(tx, doc, el.id, origin, rotation));
      const place = h("button", { textContent: "Place copy" });
      place.onclick = () => ctx.placeGroupCopy();
      const apply = h("button", { textContent: `Apply to ${others} other instance${others === 1 ? "" : "s"}`, disabled: others === 0 });
      apply.title = "Make every other instance of this group match this one";
      apply.onclick = () => edit(ctx, "Apply group changes", (tx) => syncGroupInstances(tx, doc, el.id));
      const ungroupBtn = h("button", { textContent: "Ungroup" });
      ungroupBtn.onclick = () =>
        edit(ctx, "Ungroup", (tx) => {
          const ids = ungroup(tx, doc, el.id);
          queueMicrotask(() => ctx.setSelection(ids));
        });
      sec.append(
        row("Group", textInput(type?.name ?? "", (v) => (v && type ? edit(ctx, "Rename group", (tx) => tx.setName(type.id, v)) : undefined))),
        row("Members", String(groupMembers(doc, el.id).length)),
        row("Origin X", numberInput(p.origin.x, (v) => move({ ...p.origin, x: v }))),
        row("Origin Y", numberInput(p.origin.y, (v) => move({ ...p.origin, y: v }))),
        row("Rotation (\u00b0)", numberInput(Math.round((p.rotation * 180) / Math.PI * 100) / 100, (v) => move(p.origin, (v * Math.PI) / 180))),
        row("", h("div", { class: "buttons wrap" }, place, apply, ungroupBtn)),
      );
      break;
    }
    case Cat.Revision: {
      const p = el.params as RevisionParams;
      const set = (name: string, patch: Partial<RevisionParams>) => update(name, patch);
      const up = h("button", { textContent: "Earlier" });
      up.onclick = () => edit(ctx, "Reorder revisions", (tx) => moveRevision(tx, doc, el.id, -1));
      const down = h("button", { textContent: "Later" });
      down.onclick = () => edit(ctx, "Reorder revisions", (tx) => moveRevision(tx, doc, el.id, 1));
      sec.append(
        row("Revision", revisionNumber(doc, el as never)),
        row("Sequence", h("div", { class: "buttons" }, up, down)),
        row(
          "Numbering",
          select(
            [
              { value: "alpha", label: "Alphabetic (A, B, C)" },
              { value: "numeric", label: "Numeric (1, 2, 3)" },
            ],
            p.numbering,
            (v) => set("Change numbering", { numbering: v as RevisionParams["numbering"] }),
          ),
        ),
        row("Date", textInput(p.date, (v) => set("Change revision date", { date: v }))),
        row("Description", textInput(p.description, (v) => set("Change revision description", { description: v }))),
        row("Issued to", textInput(p.issuedTo, (v) => set("Change issued to", { issuedTo: v }))),
        row("Issued by", textInput(p.issuedBy, (v) => set("Change issued by", { issuedBy: v }))),
        row("Issued", checkbox(p.issued, (v) => set(v ? "Issue revision" : "Reopen revision", { issued: v }))),
      );
      break;
    }
    case Cat.RevisionCloud: {
      const p = el.params as RevisionCloudParams;
      const revs = revisions(doc);
      const r = doc.get<RevisionParams>(p.revisionId);
      sec.append(
        r?.params.issued
          ? row("Revision", `${revisionNumber(doc, r as never)} (issued)`)
          : row(
              "Revision",
              select(
                revs.filter((x) => !x.params.issued).map((x) => ({ value: x.id, label: `${revisionNumber(doc, x)}  ${x.params.description}` })),
                p.revisionId,
                (v) => update("Change cloud revision", { revisionId: v }),
              ),
            ),
      );
      break;
    }
    case Cat.RoomSeparator: {
      const p = el.params as { levelId: string };
      sec.append(row("Level", select(levelOpts, p.levelId, (v) => update<{ levelId: string }>("Change separator level", { levelId: v }))));
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
    case Cat.Extrusion:
    case Cat.Blend:
    case Cat.Revolution:
    case Cat.Sweep: {
      sec.append(...formRows(ctx, el));
      break;
    }
    case Cat.FamilyDef: {
      const def = el as FamilyDef;
      const open = h("button", { textContent: "Edit family" });
      open.onclick = () => ctx.editFamily(def.id);
      const count = doc.byCategory<FamilyInstanceParams>(Cat.FamilyInstance).filter((i) => i.params.familyId === def.id).length;
      sec.append(
        row("Name", textInput(el.name ?? "", (v) => edit(ctx, "Rename family", (tx) => tx.setName(el.id, v || undefined)))),
        row("Category", def.params.category),
        row("Hosting", def.params.hosting === "wall" ? "Wall" : "None"),
        row("Types", familyTypeNames(def).join(", ")),
        row("Placed", String(count)),
        row("", open),
      );
      break;
    }
    case Cat.FamilyInstance: {
      sec.append(...instanceRows(ctx, el as FamilyInstance));
      break;
    }
    case Cat.Viewport: {
      const p = el.params as ViewportParams;
      const v = doc.get(p.viewId);
      const setCentre = (key: "x" | "y", val: number) =>
        edit(ctx, "Move viewport", (tx) => tx.update<ViewportParams>(el.id, { centre: { ...p.centre, [key]: val } }));
      const open = h("button", { textContent: "Open view" });
      open.onclick = () => ctx.setActiveView(p.viewId);
      sec.append(
        row("View", v?.name ?? "(deleted)"),
        row("", open),
        row("Centre X (paper mm)", numberInput(p.centre.x, (val) => setCentre("x", val))),
        row("Centre Y (paper mm)", numberInput(p.centre.y, (val) => setCentre("y", val))),
      );
      break;
    }
    case Cat.ProjectParameter: {
      const p = el.params as ProjectParameterParams;
      const set = (name: string, patch: Partial<ProjectParameterParams>) => update<ProjectParameterParams>(name, patch);
      sec.append(
        row("Name", textInput(el.name ?? "", (v) => edit(ctx, "Rename parameter", (tx) => tx.setName(el.id, v || undefined)))),
        row(
          "Data type",
          select(
            (["text", "length", "number", "area", "yesno"] as const).map((t) => ({ value: t, label: t === "yesno" ? "Yes/No" : t[0]!.toUpperCase() + t.slice(1) })),
            p.dataType,
            (v) => set("Change parameter type", { dataType: v as ParamDataType }),
          ),
        ),
        row(
          "Binding",
          select(
            [
              { value: "instance", label: "Instance" },
              { value: "type", label: "Type" },
            ],
            p.binding,
            (v) => set("Change binding", { binding: v as "instance" | "type" }),
          ),
        ),
        row("Group", textInput(p.group, (v) => set("Change group", { group: v }))),
        row("Shared GUID", p.guid ?? "(not shared)"),
        h("h3", {}, "Categories"),
      );
      for (const [cat, label] of VG_CATEGORIES.filter(([c]) => ![Cat.View, Cat.Dimension, Cat.TextNote, Cat.DetailLine].includes(c as never))) {
        const cb = h("input", { type: "checkbox", checked: p.categories.includes(cat) });
        cb.onchange = () => set("Change categories", { categories: cb.checked ? [...p.categories, cat] : p.categories.filter((c) => c !== cat) });
        sec.append(h("label", { class: "check" }, cb, label));
      }
      break;
    }
    case Cat.GlobalParameter: {
      const g = el.params as GlobalParameterParams;
      let current = "";
      try {
        current = len(globalValues(doc)[el.name ?? ""] ?? 0);
      } catch (err) {
        current = `\u26a0 ${(err as Error).message}`;
      }
      const formula = h("input", { type: "text", value: g.formula ?? "", placeholder: "formula (optional)" });
      formula.onchange = () =>
        edit(ctx, "Global formula", (tx) => {
          tx.update<GlobalParameterParams>(el.id, { formula: formula.value.trim() || null });
          globalValues(doc);
        });
      sec.append(
        row("Name", textInput(el.name ?? "", (v) => edit(ctx, "Rename global", (tx) => tx.setName(el.id, v || undefined)))),
        g.formula ? row("Value", current) : row("Value", numberInput(g.value, (v) => update<GlobalParameterParams>("Set global", { value: v }))),
        row("Formula", formula),
        row("Driving", String(doc.all().filter((e) => Object.values(globalAssociations(e)).includes(el.name ?? "")).length) + " element(s)"),
      );
      break;
    }
    case Cat.ViewFilter: {
      root.replaceChildren(filterSection(ctx, el.id, el.name ?? "", el.params as ViewFilterParams), h("div", { class: "section" }, deleteButton(ctx, el)));
      return;
    }
    case Cat.ViewTemplate: {
      const t = el.params as ViewTemplateParams;
      sec.append(
        row("Name", textInput(el.name ?? "", (v) => edit(ctx, "Rename view template", (tx) => tx.setName(el.id, v || undefined)))),
        ...graphicsRows(ctx, el.id, t),
        visibilityGraphics(ctx, el.id, t),
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
      if (familyInfo(doc)) {
        // Family dimensions between reference planes can drive them (Revit's label and EQ).
        const dp = d.params as DimensionParams;
        const params = familyParameters(doc).map((fp) => fp.name ?? "").filter(Boolean);
        sec.append(
          row(
            "Label",
            select([{ value: "", label: "<None>" }, ...params.map((n) => ({ value: n, label: n }))], dp.label ?? "", (v) =>
              edit(ctx, "Label dimension", (tx) => tx.update<DimensionParams>(d.id, { label: v || null })),
            ),
          ),
        );
        const eq = h("input", { type: "checkbox", checked: !!dp.equality });
        eq.onchange = () => edit(ctx, "Toggle EQ", (tx) => tx.update<DimensionParams>(d.id, { equality: eq.checked }));
        sec.append(row("EQ (equal spacing)", eq));
      }
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
      const stack = t.params.stack;
      if (stack) {
        // Stacked wall: member types bottom to top; height 0 = variable.
        const members = doc.byCategory<LayeredTypeParams>(Cat.WallType).filter((x) => !x.params.stack && !x.params.curtain);
        const setStack = (next: typeof stack) =>
          edit(ctx, "Edit stacked wall", (tx) => {
            if (next.filter((s) => s.height === 0).length !== 1) throw new Error("Exactly one segment must have variable height (0)");
            const thickest = next.map((s) => doc.require<LayeredTypeParams>(s.typeId)).reduce((a, b) => (totalThickness(b) > totalThickness(a) ? b : a));
            tx.update<LayeredTypeParams>(t.id, { stack: next, layers: thickest.params.layers.map((l) => ({ ...l })) });
          });
        sec.append(h("h3", {}, "Stack (bottom to top; height 0 = variable)"));
        stack.forEach((s, i) => {
          const rm = h("button", { textContent: "\u00d7", class: "mini", disabled: stack.length <= 2 });
          rm.onclick = () => setStack(stack.filter((_, j) => j !== i));
          sec.append(
            h(
              "div",
              { class: "buttons wrap" },
              select(members.map((m) => ({ value: m.id, label: m.name ?? m.id })), s.typeId, (v) => setStack(stack.map((x, j) => (j === i ? { ...x, typeId: v } : x)))),
              numberInput(s.height, (v) => setStack(stack.map((x, j) => (j === i ? { ...x, height: Math.max(0, v) } : x)))),
              rm,
            ),
          );
        });
        const add = h("button", { textContent: "Add segment" });
        add.onclick = () => setStack([...stack, { typeId: members[0]!.id, height: 600 }]);
        sec.append(row("", add));
        break;
      }
      const grid = t.params.curtain;
      if (grid) {
        // Curtain wall: grid, mullions and panels instead of layers.
        const setGrid = (patch: Partial<typeof grid>) => update<LayeredTypeParams>("Edit curtain grid", { curtain: { ...grid, ...patch } });
        const num = (k: "uSpacing" | "vSpacing" | "mullionWidth" | "mullionDepth" | "panelThickness", label: string) =>
          row(label, numberInput(grid[k], (v) => (v > 0 ? setGrid({ [k]: v }) : ctx.status("⚠ Must be positive"))));
        sec.append(
          h("h3", {}, "Curtain grid"),
          num("uSpacing", "Vertical grid spacing (max)"),
          num("vSpacing", "Horizontal grid spacing (max)"),
          num("mullionWidth", "Mullion width"),
          num("mullionDepth", "Mullion depth"),
          num("panelThickness", "Panel thickness"),
          row("Panel material", select(matOpts, grid.panelMaterialId ?? "", (v) => setGrid({ panelMaterialId: v }))),
          row("Mullion material", select(matOpts, grid.mullionMaterialId ?? "", (v) => setGrid({ mullionMaterialId: v }))),
        );
        break;
      }
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

  // Keynotes on types, materials and taggable elements (an element's own overrides its type's).
  if (getCategory(el.category).isType || el.category === Cat.Material || (TAGGABLE.has(el.category) && el.category !== Cat.Room && el.category !== Cat.Area)) {
    const table = keynoteTable(doc);
    const cur = (el.params as { keynote?: string }).keynote ?? "";
    const opts = [{ value: "", label: "\u2014" }, ...table.map((k) => ({ value: k.key, label: `${k.key}  ${k.text}` }))];
    if (cur && !table.some((k) => k.key === cur)) opts.push({ value: cur, label: `${cur} (not in table)` });
    sec.append(row("Keynote", select(opts, cur, (v) => edit(ctx, "Change keynote", (tx) => tx.update(el.id, { keynote: v || undefined })))));
  }
  // Phasing of model elements.
  if (PHASED.has(el.category)) {
    const list = phases(doc);
    const pp = el.params as { phaseCreated?: string; phaseDemolished?: string | null };
    sec.append(
      row("Phase created", select(list.map((ph) => ({ value: ph.id, label: ph.name })), pp.phaseCreated ?? list.at(-1)!.id, (v) => edit(ctx, "Change phase created", (tx) => tx.update(el.id, { phaseCreated: v })))),
      row(
        "Phase demolished",
        select([{ value: "", label: "None" }, ...list.map((ph) => ({ value: ph.id, label: ph.name }))], pp.phaseDemolished ?? "", (v) =>
          edit(ctx, "Change phase demolished", (tx) => tx.update(el.id, { phaseDemolished: v || null })),
        ),
      ),
    );
  }
  // Revit "Mark": the instance identifier tags show (rooms and areas use their number).
  if (TAGGABLE.has(el.category) && el.category !== Cat.Room && el.category !== Cat.Area) {
    sec.append(row("Mark", textInput(elementMark(el) ?? "", (v) => edit(ctx, "Change mark", (tx) => tx.update(el.id, { mark: v || undefined })))));
  }
  const extra = parameterSections(ctx, el);
  const del = h("button", { class: "danger", textContent: "Delete" });
  del.onclick = () => edit(ctx, `Delete ${el.category}`, (tx) => tx.delete(el.id));
  root.replaceChildren(sec, ...extra, h("div", { class: "section" }, del));
}
