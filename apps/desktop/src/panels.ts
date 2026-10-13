import { areaBoundary, areaLoopsFromWalls, massFloorArea, massTotals, roomBoundary, scheduleFields, scheduleTable } from "@open-bim/geometry";
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
  bracingSettings,
  setBracingSettings,
  setWallBracing,
  wallBracing,
  type BracedWallParams,
  type BracingSettings,
  DEFAULT_H1,
  H1_CLASS_LABELS,
  h1Settings,
  setH1Settings,
  type H1Class,
  type ThermalTypeParams,
  acceptPrimary,
  addOption,
  createOptionSet,
  elementOption,
  makePrimary,
  optionSets,
  setDesignOption,
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
  detachWall,
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
  type SymbolParams,
  type MarkerRole,
  MARKER_SLOTS,
  LINE_PATTERNS,
  type LinePattern,
  markerFamilies,
  type DetailComponentParams,
  type SymbolKind,
  SYMBOL_KINDS,
  DEFAULT_SYMBOL_SIZE,
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
  floorSlope,
  type Floor,
  type CalculatedField,
  SYSTEM_CLASSIFICATIONS,
  classificationInfo,
  createConnector,
  mepSystems,
  removeFromSystem,
  systemMembers,
  systemTotals,
  type ConnectorFacing,
  type ConnectorParams,
  type MEPSystem,
  type SystemClassification,
  ductFlows,
  ductLength,
  ductShape,
  ductSizeLabel,
  ductSystems,
  sizeDucts,
  type Duct,
  type DuctFittingParams,
  type DuctParams,
  type DuctTypeParams,
  PIPE_SIZES,
  fallLabel,
  minimumFall,
  pipeFall,
  pipeFalls,
  pipeLength,
  type Pipe,
  type PipeParams,
  type PipeTypeParams,
  isMass,
  massFloors,
  setMassFloors,
  type MassFloor,
  cutFill,
  polygonArea,
  type BuildingPad,
  type BuildingPadParams,
  type SubregionParams,
  type Toposolid,
  recordExistingGround,
  formatBearing,
  parseBearing,
  pointsFromLegs,
  propertyArea,
  propertyLegs,
  type Leg,
  type PropertyLine,
  type PropertyLineParams,
  drainageCheck,
  isPanel,
  panelSchedule,
  SUPPLY_VOLTAGE,
  type CircuitParams,
  CONDUIT_SIZES,
  containmentLength,
  type CableTray,
  type Conduit,
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
  /** The visible model's extents (a new section box). */
  modelBounds(): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null;
  /** Draw a floor's slope arrow (two clicks in the view). */
  drawSlopeArrow(id: ElementId): void;
  activeViewId(): ElementId | undefined;
  setActiveView(id: ElementId): void;
  status(text: string): void;
  /** Open a new family of a category in the family editor. */
  newFamily(category: FamilyCategory): void;
  /** Open a loaded family in the family editor. */
  editFamily(defId: ElementId): void;
  /** The built-in family library, and loading from it or from an .obim-family file. */
  libraryFamilies(): { name: string; category: FamilyCategory; description: string; markerRole?: MarkerRole }[];
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

/** R-value input (m²K/W); blank clears it. */
function rValueInput(value: number | null | undefined, onCommit: (v: number | null) => void): HTMLInputElement {
  const input = h("input", { type: "number", min: "0", step: "0.01", value: value ? String(value) : "", placeholder: "not set" });
  input.onchange = () => {
    if (!input.value.trim()) return onCommit(null);
    const v = Number(input.value);
    if (Number.isFinite(v) && v > 0) onCommit(v);
    else input.value = value ? String(value) : "";
  };
  return input;
}

/** NZS 3604 bracing panels on a wall. */
function bracingRows(ctx: PanelContext, w: Wall): HTMLElement[] {
  const { doc } = ctx;
  const systems = bracingSettings(doc).systems;
  const panels = (w.params as BracedWallParams).bracing ?? [];
  const save = (next: typeof panels) => edit(ctx, "Edit bracing", (tx) => setWallBracing(tx, doc, w.id, next));
  const out: HTMLElement[] = [h("div", { class: "subhead" }, "Bracing (NZS 3604)")];
  const sysOpts = systems.map((s) => ({ value: s.name, label: s.name }));
  panels.forEach((pn, i) => {
    const put = (patch: Partial<typeof pn>) => save(panels.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    const rm = h("button", { textContent: "\u00d7", class: "mini" });
    rm.onclick = () => save(panels.filter((_, j) => j !== i));
    out.push(
      row(`Panel ${i + 1}`, h("div", { class: "buttons wrap" }, select(sysOpts, pn.system, (v) => put({ system: v })), rm)),
      row("  from start", numberInput(pn.offset, (v) => put({ offset: v }))),
      row("  length", numberInput(pn.length, (v) => put({ length: v }))),
    );
  });
  const cap = wallBracing(doc, w, systems);
  if (panels.length) out.push(row("Capacity", `${cap.wind.toFixed(0)} BU wind / ${cap.eq.toFixed(0)} BU EQ`));
  const add = h("button", { textContent: "Add bracing panel" });
  add.onclick = () => {
    const sys = systems[0];
    if (!sys) return;
    const used = panels.reduce((a, x) => Math.max(a, x.offset + x.length), 0);
    const length = Math.min(1200, Math.max(sys.minLength, wallLength(w) - used));
    save([...panels, { system: sys.name, offset: Math.max(0, Math.min(used, wallLength(w) - length)), length }]);
  };
  out.push(row("", add));
  return out;
}

/** Graphics: Coarse Scale Fill Pattern and colour (cuts at Coarse; hollow when none). */
function coarseFillRows(ctx: PanelContext, t: Element<LayeredTypeParams>): HTMLElement[] {
  if (t.params.stack) return [];
  const cf = t.params.coarseFill ?? null;
  const set = (next: LayeredTypeParams["coarseFill"]) => edit(ctx, "Coarse fill pattern", (tx) => tx.update<LayeredTypeParams>(t.id, { coarseFill: next }));
  const opts = [{ value: "", label: "<None> (hollow)" }, ...PATTERNS.filter((n) => n !== "none").map((n) => ({ value: n, label: n[0]!.toUpperCase() + n.slice(1) }))];
  const colour = h("input", { type: "color", value: `#${(cf?.color ?? 0).toString(16).padStart(6, "0")}` }) as HTMLInputElement;
  colour.disabled = !cf;
  colour.onchange = () => cf && set({ ...cf, color: parseInt(colour.value.slice(1), 16) });
  return [
    h("div", { class: "subhead" }, "Graphics"),
    row("Coarse scale fill pattern", select(opts, cf?.pattern ?? "", (v) => set(v ? { pattern: v as PatternName, color: cf?.color ?? null } : null))),
    row("Coarse scale fill colour", colour),
  ];
}

/** Thermal (H1) properties of envelope types. */
function thermalRows(ctx: PanelContext, el: Element): HTMLElement[] {
  if (el.category === Cat.CeilingType) return [];
  const p = el.params as ThermalTypeParams;
  const set = (name: string, patch: Partial<ThermalTypeParams>) => edit(ctx, name, (tx) => tx.update<ThermalTypeParams>(el.id, patch));
  const rows: HTMLElement[] = [
    h("div", { class: "subhead" }, "Energy (H1)"),
    row("Construction R-value", rValueInput(p.rValue, (v) => set("Change R-value", { rValue: v }))),
  ];
  if (el.category === Cat.WallType)
    rows.push(
      row(
        "Function",
        select(
          [
            { value: "", label: "Automatic (by name)" },
            { value: "exterior", label: "Exterior" },
            { value: "interior", label: "Interior" },
          ],
          p.function ?? "",
          (v) => set("Change wall function", { function: (v || null) as ThermalTypeParams["function"] }),
        ),
      ),
    );
  if (el.category === Cat.FloorType)
    rows.push(
      row(
        "H1 floor",
        select(
          [
            { value: "", label: "Automatic (by level)" },
            { value: "slab", label: "Slab-on-ground" },
            { value: "suspended", label: "Suspended (exposed)" },
            { value: "intermediate", label: "Intermediate (not envelope)" },
          ],
          p.thermalKind ?? "",
          (v) => set("Change H1 floor kind", { thermalKind: (v || null) as ThermalTypeParams["thermalKind"] }),
        ),
      ),
    );
  return rows;
}

/** A 0–1 value (render appearance). */
function fractionInput(value: number, onCommit: (v: number) => void): HTMLInputElement {
  const input = h("input", { type: "number", min: "0", max: "1", step: "0.05", value: String(value) });
  input.onchange = () => {
    const v = Number(input.value);
    if (Number.isFinite(v) && v >= 0 && v <= 1) onCommit(v);
    else input.value = String(value);
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
    // Which option each option set shows here (Revit: Visibility/Graphics → Design Options).
    for (const os of optionSets(doc)) {
      sec.append(
        row(
          os.name,
          select(
            [{ value: "", label: "Automatic (primary)" }, ...os.options.map((o) => ({ value: o.id, label: o.name }))],
            p.designOptions?.[os.id] ?? "",
            (v) => {
              const next = { ...(p.designOptions ?? {}) };
              if (v) next[os.id] = v;
              else delete next[os.id];
              set("Change shown design option", { designOptions: next });
            },
          ),
        ),
      );
    }
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
  if (p.kind === "3d") {
    // Section Box (Revit: Extents): drag its arrows in the view to cut the model back.
    const sb = h("input", { type: "checkbox" }) as HTMLInputElement;
    sb.checked = !!p.sectionBox;
    sb.onchange = () => {
      const box = sb.checked ? ctx.modelBounds() : null;
      if (sb.checked && !box) return ctx.status("\u26a0 Nothing to put a section box round yet.");
      set(sb.checked ? "Section box on" : "Section box off", { sectionBox: box });
    };
    sec.append(row("Section box", sb));
  }
  if (p.kind === "3d" && p.camera) {
    // Camera: eye and target heights and the field of view (orbiting saves the rest).
    const c = p.camera;
    sec.append(
      row("Eye elevation", numberInput(c.eye[2], (v) => set("Camera eye elevation", { camera: { ...c, eye: [c.eye[0], c.eye[1], v] } }))),
      row("Target elevation", numberInput(c.target[2], (v) => set("Camera target elevation", { camera: { ...c, target: [c.target[0], c.target[1], v] } }))),
      row("Field of view (°)", numberInput(c.fov ?? 45, (v) => set("Camera field of view", { camera: { ...c, fov: Math.max(10, Math.min(120, v)) } }))),
    );
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
  // Marker families: which head/tail/mark draws this view in plans (Revit's type properties).
  for (const slot of MARKER_SLOTS[p.kind] ?? []) {
    const loaded = markerFamilies(doc, slot.role);
    const lib = ctx.libraryFamilies().filter((f) => f.markerRole === slot.role && !loaded.some((d) => d.name === f.name));
    const current = p[slot.key] && doc.has(p[slot.key] as ElementId) ? (p[slot.key] as string) : "";
    sec.append(
      row(
        slot.label,
        select(
          [{ value: "", label: "Built-in" }, ...loaded.map((d) => ({ value: d.id, label: d.name ?? d.id })), ...lib.map((f) => ({ value: `lib:${f.name}`, label: `${f.name} (load from library)` }))],
          current,
          (v) => {
            let id = v;
            if (v.startsWith("lib:")) {
              const name = v.slice(4);
              ctx.loadLibraryFamily(name);
              id = markerFamilies(doc, slot.role).find((d) => d.name === name)?.id ?? "";
            }
            edit(ctx, slot.label, (tx) => tx.update<ViewParams>(view.id, { [slot.key]: id || null }));
          },
        ),
      ),
    );
  }
  if (p.kind === "section" || p.kind === "callout") {
    sec.append(
      row(
        p.kind === "section" ? "Section line" : "Callout line",
        select(
          LINE_PATTERNS.map((v) => ({ value: v, label: { solid: "Solid", dash: "Dashed", dot: "Dotted", dashDot: "Dash-dot", longDash: "Long dash" }[v] })),
          p.markerLine ?? "dash",
          (v) => edit(ctx, "Marker line", (tx) => tx.update<ViewParams>(view.id, { markerLine: v as LinePattern })),
        ),
      ),
    );
  }
  if (MARKER_SLOTS[p.kind]) {
    const all = h("button", { textContent: `Use these marks for all ${p.kind === "callout" ? "callouts" : `${p.kind}s`}` });
    all.onclick = () =>
      edit(ctx, "Apply marks", (tx) => {
        for (const other of doc.byCategory<ViewParams>(Cat.View)) {
          if (other.params.kind !== p.kind || other.id === view.id) continue;
          tx.update<ViewParams>(other.id, { ...Object.fromEntries((MARKER_SLOTS[p.kind] ?? []).map((s) => [s.key, p[s.key] ?? null])), markerLine: p.markerLine ?? null });
        }
      });
    sec.append(row("", all));
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

  // Calculated values: a formula over the other fields by name (lengths in m, areas m², volumes m³).
  const calc = p.calculated ?? [];
  const calcSec = h("div", { class: "section" }, h("h3", {}, "Calculated values"));
  const CALC_TYPES = [
    { value: "number", label: "Number" },
    { value: "length", label: "Length (m)" },
    { value: "area", label: "Area (m²)" },
    { value: "volume", label: "Volume (m³)" },
  ];
  calc.forEach((c, i) => {
    const key = `calc:${c.name}`;
    const patch = (q: Partial<CalculatedField>) => {
      const next = calc.map((x, j) => (j === i ? { ...x, ...q } : x));
      // Renaming keeps the field in the schedule.
      const fieldsNext = q.name ? p.fields.map((f) => (f === key ? `calc:${q.name}` : f)) : p.fields;
      set("Edit calculated value", { calculated: next, fields: fieldsNext });
    };
    const rm = h("button", { textContent: "×", title: "Remove" });
    rm.onclick = () => set("Remove calculated value", { calculated: calc.filter((_, j) => j !== i), fields: p.fields.filter((f) => f !== key) });
    const formula = textInput(c.formula, (v) => patch({ formula: v }));
    formula.title = `Formula over fields by name, e.g. ${all.find((f) => f.kind === "area")?.label ?? "Area"} * 2500. Lengths in m, areas m².`;
    calcSec.append(
      h("div", { class: "buttons wrap" }, textInput(c.name, (v) => v.trim() && !calc.some((x, j) => j !== i && x.name === v.trim()) && patch({ name: v.trim() })), select(CALC_TYPES, c.type, (v) => patch({ type: v as CalculatedField["type"] })), rm),
      row("Formula", formula),
    );
  });
  const addCalc = h("button", { textContent: "Add calculated value" });
  addCalc.onclick = () => {
    let name = "Calculated";
    for (let i = 2; calc.some((c) => c.name === name) || all.some((f) => f.label === name); i++) name = `Calculated ${i}`;
    const first = all.find((f) => f.kind === "area" || f.kind === "length" || f.kind === "count");
    set("Add calculated value", { calculated: [...calc, { name, type: "number", formula: first ? `${first.label} * 1` : "1" }], fields: [...p.fields, `calc:${name}`] });
  };
  calcSec.append(row("", addCalc));

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
  return [general, fields, calcSec, filters, sorting, h("div", { class: "section" }, del)];
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
  ["DetailItem", "Detail Item (2D)"],
  ["ViewMarker", "View Marker (elevation mark, section head/tail, callout head)"],
  ["MechanicalEquipment", "Mechanical Equipment (MEP)"],
  ["AirTerminal", "Air Terminal (MEP)"],
  ["PlumbingFixture", "Plumbing Fixture (MEP)"],
  ["ElectricalEquipment", "Electrical Equipment (MEP)"],
  ["ElectricalFixture", "Electrical Fixture (MEP)"],
  ["LightingFixture", "Lighting Fixture (MEP)"],
  ["Mass", "Mass (conceptual)"],
  ["Site", "Site (trees, site furniture)"],
  ["Parking", "Parking"],
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
    ...(p.category === "ViewMarker"
      ? [
          row(
            "Marker role",
            select(
              [
                { value: "elevation", label: "Elevation mark" },
                { value: "sectionHead", label: "Section head" },
                { value: "sectionTail", label: "Section tail" },
                { value: "calloutHead", label: "Callout head" },
              ],
              p.markerRole ?? "elevation",
              (v) => edit(ctx, "Marker role", (tx) => tx.update<FamilyInfoParams>(info.id, { markerRole: v as MarkerRole })),
            ),
          ),
          h("p", { class: "muted" }, "Draw at paper size (mm) about the origin, looking along +Y (up). Text can use {n} (view number), {name} and {sheet}."),
        ]
      : []),
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
  // MEP connectors: where ducts, pipes and wiring attach (and the flow or load there).
  const connectors = doc.byCategory<ConnectorParams>(Cat.Connector);
  sec.append(h("h3", {}, `Connectors (${connectors.length})`));
  for (const c of connectors) {
    const div = h("div", { class: "list-item" }, h("span", {}, classificationInfo(c.params.classification).label), h("span", { class: "muted" }, c.params.facing));
    div.onclick = () => ctx.setSelection([c.id]);
    sec.append(div);
  }
  sec.append(
    row(
      "Add connector",
      select([{ value: "", label: "System\u2026" }, ...SYSTEM_CLASSIFICATIONS.map((x) => ({ value: x.value, label: x.label }))], "", (v) => {
        if (!v) return;
        let id: ElementId | undefined;
        edit(ctx, "Add connector", (tx) => (id = createConnector(tx, { classification: v as SystemClassification }).id));
        if (id) ctx.setSelection([id]);
      }),
    ),
  );

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
  // Views not yet on a sheet can be placed; schedules can go on any number of sheets.
  const placeable: { id: ElementId; name?: string }[] = [
    ...viewElements(doc).filter((v) => v.params.kind !== "3d" && !sheetOfView(doc, v.id)),
    ...doc.byCategory(Cat.Schedule).map((x) => ({ id: x.id, name: `${x.name ?? "Schedule"} (schedule)` })),
  ];
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
  ["Mass", "Mass"],
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
  [Cat.Symbol, "Symbols"],
  [Cat.DetailComponent, "Detail items"],
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
  const box = h("div", { class: "vg" }, h("h3", {}, "Visibility/Graphics"), h("div", { class: "vg-head" }, h("span", {}, ""), h("div", { class: "vg-controls vg-cols" }, h("span", {}, "Vis"), h("span", {}, "Half"), h("span", { class: "vg-colour-head" }, "Colour"))));
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
  box.append(h("h3", { title: "Where filters overlap, the one higher in the list wins" }, "Filters"));
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
  // H1 energy: climate zone and (provisional, editable) schedule-method minimums for that zone.
  const h1 = h1Settings(ctx.doc);
  const req = h1.requirements ?? DEFAULT_H1;
  const z = h1.climateZone;
  const h1Sec = h("div", { class: "section" }, h("h3", {}, "H1 energy"));
  const setReq = (next: typeof req) => edit(ctx, "Edit H1 requirements", (tx) => setH1Settings(tx, ctx.doc, { requirements: next }));
  h1Sec.append(
    row(
      "Climate zone",
      select([1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `Zone ${n}` })), String(z), (v) =>
        edit(ctx, "Change climate zone", (tx) => setH1Settings(tx, ctx.doc, { climateZone: Number(v) as typeof z })),
      ),
    ),
  );
  for (const cls of Object.keys(H1_CLASS_LABELS) as H1Class[]) {
    h1Sec.append(
      row(
        `${H1_CLASS_LABELS[cls]} min R`,
        rValueInput(req.minR[cls][z - 1], (v) => v && setReq({ ...req, minR: { ...req.minR, [cls]: req.minR[cls].map((x, i) => (i === z - 1 ? v : x)) } })),
      ),
    );
  }
  h1Sec.append(
    row("Max glazing (% of wall)", intInput(Math.round(req.maxGlazingRatio * 100), 1, 100, (v) => setReq({ ...req, maxGlazingRatio: v / 100 }))),
    row("", h("span", { class: "muted" }, "Provisional H1/AS1 schedule-method values: check them against the current edition. Run the check from NZ Checks.")),
  );
  // NZS 3604 bracing inputs (provisional estimates; demand overrides live in NZ Checks).
  const br = bracingSettings(ctx.doc);
  const setBr = (name: string, patch: Partial<BracingSettings>) => edit(ctx, name, (tx) => setBracingSettings(tx, ctx.doc, patch));
  const kpa = (v: number, onCommit: (x: number) => void) => {
    const input = h("input", { type: "number", min: "0", step: "0.05", value: String(v) });
    input.onchange = () => {
      const x = Number(input.value);
      if (Number.isFinite(x) && x >= 0) onCommit(x);
    };
    return input;
  };
  const brSec = h("div", { class: "section" }, h("h3", {}, "Bracing (NZS 3604)"));
  brSec.append(
    row(
      "Wind zone",
      select(
        (["L", "M", "H", "VH", "EH"] as const).map((z) => ({ value: z, label: `${{ L: "Low", M: "Medium", H: "High", VH: "Very high", EH: "Extra high" }[z]} (${br.windSpeeds[z]} m/s)` })),
        br.windZone,
        (v) => setBr("Change wind zone", { windZone: v as BracingSettings["windZone"] }),
      ),
    ),
    row("Earthquake zone", select([1, 2, 3, 4].map((n) => ({ value: String(n), label: `Zone ${n}` })), String(br.eqZone), (v) => setBr("Change earthquake zone", { eqZone: Number(v) as BracingSettings["eqZone"] }))),
    row("Roof weight (kPa)", kpa(br.roofKPa, (v) => setBr("Change roof weight", { roofKPa: v }))),
    row("Cladding weight (kPa)", kpa(br.claddingKPa, (v) => setBr("Change cladding weight", { claddingKPa: v }))),
    row("Floor weight (kPa)", kpa(br.floorKPa, (v) => setBr("Change floor weight", { floorKPa: v }))),
    h("div", { class: "subhead" }, "Bracing systems (BU/m)"),
  );
  br.systems.forEach((s, i) => {
    const put = (patch: Partial<typeof s>) => setBr("Edit bracing system", { systems: br.systems.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
    const num = (v: number, on: (x: number) => void) => {
      const input = h("input", { type: "number", min: "0", step: "5", value: String(v), class: "narrow" });
      input.onchange = () => Number(input.value) > 0 && on(Number(input.value));
      return input;
    };
    brSec.append(
      row("Name", textInput(s.name, (v) => v && put({ name: v }))),
      row("Wind / EQ", h("div", { class: "buttons" }, num(s.windPerM, (x) => put({ windPerM: x })), num(s.eqPerM, (x) => put({ eqPerM: x })))),
    );
  });
  const addSys = h("button", { textContent: "Add system" });
  addSys.onclick = () => setBr("Add bracing system", { systems: [...br.systems, { name: `System ${br.systems.length + 1}`, windPerM: 50, eqPerM: 50, minLength: 400 }] });
  brSec.append(
    row("", addSys),
    row("", h("span", { class: "muted" }, "Provisional: demand is estimated from wind speed and seismic weight, not NZS 3604 tables, and system ratings are nominal. Enter tabulated demand in NZ Checks and manufacturers' ratings here.")),
  );
  return [info, unitsSec, locSec, phSec, h1Sec, brSec];
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

/** Drag data type for Project Browser items dropped on the view (Revit: drag views onto sheets). */
export const BROWSER_DRAG = "application/x-open-bim-item";

/** Let a browser row be dragged onto the view: views/schedules onto sheets, families into views. */
function browserDrag(div: HTMLElement, kind: "view" | "family", id: ElementId): void {
  div.draggable = true;
  div.title = kind === "family" ? "Drag into a view to place it" : "Drag onto a sheet to place it";
  div.ondragstart = (ev) => {
    ev.dataTransfer?.setData(BROWSER_DRAG, JSON.stringify({ kind, id }));
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "copy";
  };
}

/**
 * The Project Browser, laid out as Revit's: Views (all), Legends, Schedules/Quantities, Sheets
 * (all), Families (system and loadable, by category, family and type), Groups and Links. Project
 * settings (information, levels, materials, parameters, design options, revisions, filters, MEP
 * systems) open from the Manage tab as dialogs, like Revit's.
 */
export function renderBrowser(root: HTMLElement, ctx: PanelContext): void {
  if (familyInfo(ctx.doc)) return renderFamilyBrowser(root, ctx);
  const s = projectSections(ctx);
  root.replaceChildren(s.views!, s.sheets!, s.legends!, s.schedules!, s.families!, s.groups!, s.links!);
}

/** Manage-tab dialogs: which project section each shows. */
export const MANAGE_SECTIONS: Record<string, string> = {
  projectInfo: "Project Information",
  levels: "Levels",
  materials: "Materials",
  parameters: "Project & Global Parameters",
  designOptions: "Design Options",
  revisions: "Sheet Issues/Revisions",
  filters: "Filters & View Templates",
  systems: "System Browser",
  statistics: "Model Statistics",
};

/** A project section on its own (Manage-tab dialogs), kept up to date while open. */
export function projectSection(ctx: PanelContext, key: string): HTMLElement {
  return projectSections(ctx)[key] ?? h("div", { class: "empty" }, "Nothing here.");
}

function projectSections(ctx: PanelContext): Record<string, HTMLElement> {
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
  const viewsSec = h("div", { class: "section" }, h("h3", {}, "Views (all)"));
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
  ];
  for (const [title, list] of groups) {
    if (!list.length) continue;
    viewsSec.append(h("div", { class: "subhead" }, title));
    for (const v of list) {
      const div = h("div", { class: `list-item indent${v.id === ctx.activeViewId() ? " selected" : ""}` }, h("span", {}, v.name ?? v.id));
      div.onclick = () => ctx.setActiveView(v.id);
      if (v.params.kind !== "3d") browserDrag(div, "view", v.id);
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
  // Legends get their own section, like schedules (Revit's browser does the same).
  const legendSec = h("div", { class: "section" }, h("h3", {}, "Legends"));
  for (const v of allViews.filter((x) => x.params.kind === "legend")) {
    const div = h("div", { class: `list-item${v.id === ctx.activeViewId() ? " selected" : ""}` }, h("span", {}, v.name ?? v.id));
    div.onclick = () => ctx.setActiveView(v.id);
    browserDrag(div, "view", v.id);
    legendSec.append(div);
  }
  legendSec.append(row("", newLegend));
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
  // Keynote files load/export from Annotate → Tag → Keynote ▾ (Keynoting settings).

  // Sheets.
  const sheetsSec = h("div", { class: "section" }, h("h3", {}, "Sheets (all)"));
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
  const typeRow = (t: Element, right: string, indent: string) => {
    const div = h("div", { class: `list-item ${indent}${sel.has(t.id) ? " selected" : ""}`, title: "Click to edit the type in Properties" }, h("span", {}, t.name ?? t.id), h("span", { class: "muted" }, right));
    div.onclick = () => ctx.setSelection([t.id]);
    return div;
  };
  const familyGroup = (title: string, families: [string, Element[], (t: Element) => string][]) => {
    const list = families.filter(([, ts]) => ts.length);
    if (!list.length) return;
    fams.append(h("div", { class: "subhead" }, title));
    for (const [name, ts, right] of list) {
      fams.append(h("div", { class: "list-item indent muted-head" }, h("span", {}, name)));
      for (const t of ts) fams.append(typeRow(t, right(t), "indent2"));
    }
  };
  const layered = (cat: string) => doc.byCategory<LayeredTypeParams>(cat);
  const thick = (t: Element) => len(totalThickness(t as Element<LayeredTypeParams>));
  const wallTypes = layered(Cat.WallType);
  // System families (Revit: Walls → Basic Wall / Curtain Wall / Stacked Wall, Floors → Floor, …).
  familyGroup("Walls", [
    ["Basic Wall", wallTypes.filter((t) => !t.params.curtain && !t.params.stack?.length), thick],
    ["Curtain Wall", wallTypes.filter((t) => !!t.params.curtain), () => ""],
    ["Stacked Wall", wallTypes.filter((t) => !!t.params.stack?.length), () => ""],
  ]);
  familyGroup("Floors", [["Floor", layered(Cat.FloorType), thick]]);
  familyGroup("Ceilings", [["Compound Ceiling", layered(Cat.CeilingType), thick]]);
  familyGroup("Roofs", [["Basic Roof", layered(Cat.RoofType), thick]]);
  familyGroup("Doors", [["Single Door", doc.byCategory<DoorTypeParams>(Cat.DoorType), (t) => `${(t as Element<DoorTypeParams>).params.leafWidth} \u00d7 ${(t as Element<DoorTypeParams>).params.leafHeight}`]]);
  familyGroup("Windows", [["Window", doc.byCategory<WindowTypeParams>(Cat.WindowType), (t) => `${(t as Element<WindowTypeParams>).params.width} \u00d7 ${(t as Element<WindowTypeParams>).params.height}`]]);
  familyGroup("Stairs", [["Stair", doc.byCategory(Cat.StairType), () => ""]]);
  familyGroup("Railings", [["Railing", doc.byCategory(Cat.RailingType), () => ""]]);
  familyGroup("Ramps", [["Ramp", doc.byCategory(Cat.RampType), () => ""]]);
  familyGroup("Structural Sections", [["Section", doc.byCategory(Cat.StructuralType), () => ""]]);
  familyGroup("Ducts", [["Duct", doc.byCategory(Cat.DuctType), () => ""]]);
  familyGroup("Pipes", [["Pipe", doc.byCategory(Cat.PipeType), () => ""]]);
  // Loadable families by category → family → types.
  for (const [cat, label] of FAMILY_CATEGORIES) {
    const defs = familyDefs(doc).filter((f) => f.params.category === cat);
    if (!defs.length) continue;
    fams.append(h("div", { class: "subhead" }, label.replace(/ \(.*\)$/, "")));
    for (const f of defs) {
      const div = h("div", { class: `list-item indent${sel.has(f.id) ? " selected" : ""}`, title: "Drag into a view to place it; click for its properties" }, h("span", {}, f.name ?? f.id));
      div.onclick = () => ctx.setSelection([f.id]);
      browserDrag(div, "family", f.id);
      fams.append(div);
      for (const t of familyTypeNames(f)) fams.append(h("div", { class: "list-item indent2 muted" }, h("span", {}, t)));
    }
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

  // Design options: sets, their options (primary first marked), and accepting the primary.
  const optSec = h("div", { class: "section" }, h("h3", {}, "Design Options"));
  for (const set of optionSets(doc)) {
    optSec.append(h("div", { class: "subhead" }, set.name));
    for (const o of set.options) {
      const primary = o.id === set.primary;
      const mk = h("button", { textContent: primary ? "primary" : "Make primary", class: "mini", disabled: primary });
      mk.onclick = () => edit(ctx, "Make primary", (tx) => makePrimary(tx, doc, o.id));
      const n = doc.all().filter((e) => elementOption(e) === o.id).length;
      optSec.append(h("div", { class: "list-item indent" }, h("span", {}, `${o.name} (${n})`), mk));
    }
    const add = h("button", { textContent: "Add option" });
    add.onclick = () => edit(ctx, "Add design option", (tx) => addOption(tx, doc, set.id));
    const accept = h("button", { textContent: "Accept primary" });
    accept.title = "Primary option joins the main model; other options' elements are deleted";
    accept.onclick = () => edit(ctx, `Accept primary of ${set.name}`, (tx) => acceptPrimary(tx, doc, set.id));
    optSec.append(h("div", { class: "buttons wrap" }, add, accept));
  }
  const newSet = h("button", { textContent: "New option set" });
  newSet.onclick = () =>
    edit(ctx, "New option set", (tx) => {
      let name = "Option Set 1";
      for (let i = 2; optionSets(doc).some((s) => s.name === name); i++) name = `Option Set ${i}`;
      createOptionSet(tx, doc, name);
    });
  optSec.append(row("", newSet));

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
    browserDrag(div, "view", s.id);
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

  // Revit order: views, then sheets right below, then legends and schedules.
  // MEP systems (Revit's System Browser): by system, with members and flow or load.
  const sysSec = h("div", { class: "section" }, h("h3", {}, "MEP Systems"));
  const allSystems = mepSystems(doc);
  for (const info of SYSTEM_CLASSIFICATIONS) {
    const list = allSystems.filter((s) => s.params.classification === info.value);
    if (!list.length) continue;
    sysSec.append(h("div", { class: "subhead" }, info.label));
    for (const s of list) {
      const t = systemTotals(doc, s);
      const swatch = h("span", { class: "swatch" });
      swatch.style.background = `#${info.color.toString(16).padStart(6, "0")}`;
      const div = h(
        "div",
        { class: `list-item indent${sel.has(s.id) ? " selected" : ""}` },
        h("span", {}, s.name ?? s.id),
        h("span", { class: "muted" }, info.domain === "electrical" ? `${(t.load / 1000).toFixed(1)} kW` : `${t.flow.toFixed(0)} L/s`),
        swatch,
      );
      div.onclick = () => ctx.setSelection([s.id]);
      sysSec.append(div);
    }
  }
  if (!allSystems.length) sysSec.append(h("div", { class: "muted" }, "Select terminals, fixtures or equipment, then right-click \u2192 Create System."));
  // Groups: model and detail group types, with how many are placed.
  const groupsSec = h("div", { class: "section" }, h("h3", {}, "Groups"));
  const groupTypes = doc.byCategory(Cat.GroupType);
  for (const [title, detail] of [["Model", false], ["Detail", true]] as const) {
    const list = groupTypes.filter((t) => {
      const inst = groupInstances(doc, t.id);
      return inst.length && !!inst[0]!.params.viewId === detail;
    });
    if (!list.length) continue;
    groupsSec.append(h("div", { class: "subhead" }, title));
    for (const t of list) {
      const inst = groupInstances(doc, t.id);
      const div = h("div", { class: `list-item indent${inst.some((g) => sel.has(g.id)) ? " selected" : ""}`, title: "Click to select every instance" }, h("span", {}, t.name ?? t.id), h("span", { class: "muted" }, String(inst.length)));
      div.onclick = () => ctx.setSelection(inst.map((g) => g.id));
      groupsSec.append(div);
    }
  }
  if (!groupsSec.querySelector(".list-item")) groupsSec.append(h("div", { class: "muted" }, "No groups yet (select elements, then Ctrl+G)."));
  types.querySelector("h3")?.remove();
  for (const b of types.querySelectorAll("button")) fams.append(row("", b));
  return {
    views,
    legends: legendSec,
    schedules: schedSec,
    sheets: sheetsSec,
    families: fams,
    groups: groupsSec,
    links: linkSec,
    projectInfo: project,
    levels: lv,
    materials: mats,
    parameters: paramsSec,
    designOptions: optSec,
    revisions: revSec,
    filters: vg,
    systems: sysSec,
    statistics: counts,
  };
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
      // Disallow Join per end (Revit: right-click a wall end → Disallow Join).
      for (const end of ["start", "end"] as const) {
        const cb = h("input", { type: "checkbox" }) as HTMLInputElement;
        cb.checked = !!p.disallowJoin?.[end];
        cb.onchange = () => update<WallParams>(cb.checked ? "Disallow join" : "Allow join", { disallowJoin: { ...p.disallowJoin, [end]: cb.checked } });
        sec.append(row(end === "start" ? "Disallow join at start" : "Disallow join at end", cb));
      }
      // Attach Top/Base (Modify tab or right-click to attach; detach here).
      for (const end of ["top", "base"] as const) {
        const id = end === "top" ? p.topAttachId : p.baseAttachId;
        const t = id ? doc.get(id) : undefined;
        if (!t) continue;
        const det = h("button", { textContent: "Detach" });
        det.onclick = () => edit(ctx, `Detach ${end}`, (tx) => detachWall(tx, doc, w.id, end));
        sec.append(row(end === "top" ? "Top attached to" : "Base attached to", h("div", { class: "buttons" }, h("span", { class: "value" }, `${t.category} ${t.name ?? ""}`.trim()), det)));
      }
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
      sec.append(...bracingRows(ctx, w));
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
    case Cat.PropertyLine: {
      const pl = el as PropertyLine;
      const legs = propertyLegs(doc, pl);
      const start = pl.params.points[0]!;
      const setLegs = (next: Leg[]) => update<PropertyLineParams>("Edit property line", { points: pointsFromLegs(doc, start, next) });
      sec.append(row("Area", formatArea(propertyArea(pl), units)), h("h3", {}, "Bearings and distances"));
      legs.forEach((l, i) => {
        const b = textInput(formatBearing(l.bearing), (v) => {
          const deg = parseBearing(v);
          if (deg === null) return ctx.status("\u26a0 Bearings as 45\u00b030'00\", 45 30 00 or 45.5");
          setLegs(legs.map((x, j) => (j === i ? { ...x, bearing: deg } : x)));
        });
        b.title = "Whole-circle bearing from north, e.g. 45\u00b030'00\"";
        const d = numberInput(Math.round(l.distance) / 1000, (v) => setLegs(legs.map((x, j) => (j === i ? { ...x, distance: v * 1000 } : x))));
        d.title = "Distance, metres";
        const rm = h("button", { textContent: "\u00d7", title: "Remove this leg", class: "mini", disabled: legs.length <= 3 });
        rm.onclick = () => setLegs(legs.filter((_, j) => j !== i));
        sec.append(h("div", { class: "buttons wrap" }, h("span", { class: "muted" }, `${i + 1}`), b, d, h("span", { class: "muted" }, "m"), rm));
      });
      const add = h("button", { textContent: "Add leg" });
      add.onclick = () => setLegs([...legs.slice(0, -1), { bearing: legs.at(-1)!.bearing, distance: 5000 }, legs.at(-1)!]);
      sec.append(row("", add), h("div", { class: "muted" }, "The last leg closes back to the first corner. Bearings are clockwise from north (the project's survey north)."));
      break;
    }
    case Cat.BuildingPad: {
      const pad = el as BuildingPad;
      const p = pad.params;
      const topo = doc.get(p.toposolidId) as Toposolid | undefined;
      const cf = topo ? cutFill(doc, topo) : { cut: 0, fill: 0 };
      sec.append(
        row("Level", select(levelOpts, p.levelId, (v) => update<BuildingPadParams>("Pad level", { levelId: v }))),
        row("Height offset (top)", numberInput(p.offset, (v) => update<BuildingPadParams>("Pad height", { offset: v }))),
        row("Thickness", numberInput(p.thickness, (v) => update<BuildingPadParams>("Pad thickness", { thickness: Math.max(10, v) }))),
        row("Area", formatArea(Math.abs(polygonArea(p.boundary)), units)),
        row("Site cut / fill", `${cf.cut.toFixed(1)} / ${cf.fill.toFixed(1)} m\u00b3`),
        editBoundaryButton(ctx, el.id),
      );
      break;
    }
    case Cat.SiteSubregion: {
      const sub = el.params as SubregionParams;
      sec.append(
        row("Material", select([{ value: "", label: "(lawn green)" }, ...materialElements(doc).map((m2) => ({ value: m2.id, label: m2.name ?? m2.id }))], sub.materialId ?? "", (v) => update<SubregionParams>("Subregion material", { materialId: v || null }))),
        row("Area", formatArea(Math.abs(polygonArea(sub.boundary)), units)),
        editBoundaryButton(ctx, el.id),
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
        row(
          "Contour labels",
          select(
            [
              { value: "index", label: "Every fifth (index)" },
              { value: "all", label: "Every contour" },
              { value: "none", label: "None" },
            ],
            p.contourLabels ?? "index",
            (v) => update<ToposolidParams>("Contour labels", { contourLabels: v as ToposolidParams["contourLabels"] }),
          ),
        ),
        row("Material", select(matOpts, p.materialId ?? "", (v) => update<ToposolidParams>("Change toposolid material", { materialId: v || null }))),
        row("", h("div", { class: "buttons wrap" }, imp, clear)),
      );
      // Earthworks: against the recorded existing ground (Graded Region), else the survey.
      const cf = cutFill(doc, el as Toposolid);
      const rec = h("button", { textContent: p.existingPoints ? "Re-record existing ground" : "Record existing ground (graded region)" });
      rec.onclick = () => edit(ctx, "Graded region", (tx) => recordExistingGround(tx, doc, el.id));
      sec.append(
        row("Cut / fill", `${cf.cut.toFixed(1)} / ${cf.fill.toFixed(1)} m³ (net ${(cf.fill - cf.cut).toFixed(1)})`),
        row("Existing ground", p.existingPoints ? "recorded" : "survey (pads excluded)"),
        row("", rec),
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
      // Slope arrow: draw it, then set the heights at its tail and head.
      const draw = h("button", { textContent: p.slope ? "Redraw slope arrow" : "Add slope arrow" });
      draw.onclick = () => ctx.drawSlopeArrow(el.id);
      sec.append(h("div", { class: "row" }, h("span", {}), draw));
      const s = p.slope;
      if (s) {
        const fall = floorSlope(el as Floor);
        const off = h("button", { textContent: "Remove slope" });
        off.onclick = () => update<FloorParams>("Remove slope arrow", { slope: null });
        sec.append(
          row("Height at tail", numberInput(s.tailOffset, (v) => update<FloorParams>("Slope arrow tail", { slope: { ...s, tailOffset: v } }))),
          row("Height at head", numberInput(s.headOffset, (v) => update<FloorParams>("Slope arrow head", { slope: { ...s, headOffset: v } }))),
          row("Slope", fall > 0 ? `1:${Math.round(1 / fall)} (${(fall * 100).toFixed(2)}%)` : "Level"),
          h("div", { class: "row" }, h("span", {}), off),
        );
      }
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
    case Cat.Connector: {
      const p = el.params as ConnectorParams;
      const set = (name: string, patch: Partial<ConnectorParams>) => update<ConnectorParams>(name, patch);
      const values = familyInfo(doc) ? familyValues(doc) : {};
      const check = (v: Num) => void evaluate(v, values);
      const f = (key: "x" | "y" | "z" | "diameter" | "width" | "height" | "flow" | "load" | "units", label: string) =>
        row(label, formulaInput(p[key] ?? 0, (v) => set(`Connector ${label.toLowerCase()}`, { [key]: v }), check));
      const domain = classificationInfo(p.classification).domain;
      sec.append(
        row("System", select(SYSTEM_CLASSIFICATIONS.map((x) => ({ value: x.value, label: x.label })), p.classification, (v) => set("Connector system", { classification: v as SystemClassification }))),
        f("x", "X"),
        f("y", "Y"),
        f("z", "Z (height)"),
        row("Facing", select((["+x", "-x", "+y", "-y", "+z", "-z"] as const).map((x) => ({ value: x, label: x })), p.facing, (v) => set("Connector facing", { facing: v as ConnectorFacing }))),
        row("Flow direction", select([{ value: "in", label: "In" }, { value: "out", label: "Out" }, { value: "both", label: "Both" }], p.flowDirection, (v) => set("Connector flow direction", { flowDirection: v as ConnectorParams["flowDirection"] }))),
      );
      if (domain !== "electrical") {
        sec.append(row("Shape", select([{ value: "round", label: "Round" }, { value: "rectangular", label: "Rectangular" }], p.shape, (v) => set("Connector shape", { shape: v as ConnectorParams["shape"] }))));
        sec.append(...(p.shape === "round" ? [f("diameter", "Diameter")] : [f("width", "Width"), f("height", "Height")]));
        sec.append(f("flow", "Flow (L/s)"));
        if (domain === "pipe") sec.append(f("units", "Discharge / loading units"));
      } else sec.append(f("load", "Load (W)"));
      break;
    }
    case Cat.Duct: {
      const d = el as Duct;
      const p = d.params;
      const set = (name: string, patch: Partial<DuctParams>) => update<DuctParams>(name, patch);
      const round = ductShape(doc, d) === "round";
      const flowIn = ductSystems(doc).filter((s) => s.params.classification === p.classification);
      const flow = flowIn.map((s) => ductFlows(doc, s).get(d.id)).find((x) => x !== undefined);
      sec.append(
        row("Type", select(typeOpts(Cat.DuctType), d.typeId ?? "", (v) => edit(ctx, "Change duct type", (tx) => tx.setType(d.id, v)))),
        row("System", select(SYSTEM_CLASSIFICATIONS.filter((c) => c.domain === "duct").map((c) => ({ value: c.value, label: c.label })), p.classification, (v) => set("Duct system", { classification: v as SystemClassification }))),
        ...(round
          ? [row("Diameter", numberInput(p.diameter, (v) => set("Duct diameter", { diameter: v })))]
          : [row("Width", numberInput(p.width, (v) => set("Duct width", { width: v }))), row("Height", numberInput(p.height, (v) => set("Duct height", { height: v })))]),
        row("Start elevation", numberInput(p.start.z, (v) => set("Duct start elevation", { start: { ...p.start, z: v } }))),
        row("End elevation", numberInput(p.end.z, (v) => set("Duct end elevation", { end: { ...p.end, z: v } }))),
        row("Length", len(ductLength(d))),
        row("Size", ductSizeLabel(doc, d)),
        ...(flow !== undefined ? [row("Flow", `${flow.toFixed(0)} L/s`)] : []),
      );
      break;
    }
    case Cat.Pipe: {
      const pp = el as Pipe;
      const p = pp.params;
      const set = (name: string, patch: Partial<PipeParams>) => update<PipeParams>(name, patch);
      const fall = pipeFall(pp);
      const falls = pipeFalls(p.classification);
      const tooFlat = falls && Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y) > 1 && Math.abs(fall) + 1e-9 < minimumFall(p.diameter);
      sec.append(
        row("Type", select(typeOpts(Cat.PipeType), pp.typeId ?? "", (v) => edit(ctx, "Change pipe type", (tx) => tx.setType(pp.id, v)))),
        row("System", select(SYSTEM_CLASSIFICATIONS.filter((c) => c.domain === "pipe").map((c) => ({ value: c.value, label: c.label })), p.classification, (v) => set("Pipe system", { classification: v as SystemClassification }))),
        row("Size", select(PIPE_SIZES.map((d) => ({ value: String(d), label: `DN${d}` })), String(p.diameter), (v) => set("Pipe size", { diameter: Number(v) }))),
        row("Start elevation", numberInput(p.start.z, (v) => set("Pipe start elevation", { start: { ...p.start, z: v } }))),
        row("End elevation", numberInput(p.end.z, (v) => set("Pipe end elevation", { end: { ...p.end, z: v } }))),
        row("Length", len(pipeLength(pp))),
        row("Fall", fallLabel(fall)),
        ...(p.classification === "sanitary"
          ? (() => {
              const d = drainageCheck(doc).pipes.find((x) => x.pipeId === pp.id);
              return d ? [row("Discharge units", `${d.units} (takes ${d.capacity})`)] : [];
            })()
          : []),
        ...(tooFlat ? [h("div", { class: "empty" }, `\u26a0 Flatter than the ${fallLabel(minimumFall(p.diameter))} minimum for DN${p.diameter} (provisional, after G13/AS1).`)] : []),
      );
      break;
    }
    case Cat.PipeType: {
      const t = el.params as PipeTypeParams;
      sec.append(
        row("Name", textInput(el.name ?? "", (v) => edit(ctx, "Rename type", (tx) => tx.setName(el.id, v || undefined)))),
        row("Material", textInput(t.material, (v) => update<PipeTypeParams>("Pipe material", { material: v }))),
        row("Used for", t.use.map((c) => classificationInfo(c).label).join(", ") || "-"),
      );
      break;
    }
    case Cat.CableTray:
    case Cat.Conduit: {
      const r = el as CableTray & Conduit;
      const p = r.params;
      const tray = el.category === Cat.CableTray;
      const set = (name: string, patch: Record<string, unknown>) => update(name, patch as never);
      sec.append(
        ...(tray
          ? [row("Width", numberInput(p.width, (v) => set("Tray width", { width: Math.max(25, v) }))), row("Depth", numberInput(p.height, (v) => set("Tray depth", { height: Math.max(25, v) })))]
          : [row("Size", select(CONDUIT_SIZES.map((d) => ({ value: String(d), label: `${d} mm` })), String(p.diameter), (v) => set("Conduit size", { diameter: Number(v) })))]),
        row("Start elevation", numberInput(p.start.z, (v) => set("Start elevation", { start: { ...p.start, z: v } }))),
        row("End elevation", numberInput(p.end.z, (v) => set("End elevation", { end: { ...p.end, z: v } }))),
        row("Length", len(containmentLength(r))),
      );
      break;
    }
    case Cat.CableTrayFitting:
    case Cat.ConduitFitting:
    case Cat.PipeFitting:
    case Cat.DuctFitting: {
      const f = el.params as DuctFittingParams;
      sec.append(row("Fitting", f.kind[0]!.toUpperCase() + f.kind.slice(1)), row("Joins", `${f.ends.length} ducts`), h("div", { class: "muted" }, "Fittings follow their ducts: edit or delete the ducts."));
      break;
    }
    case Cat.DuctType: {
      const t = el.params as DuctTypeParams;
      sec.append(
        row("Name", textInput(el.name ?? "", (v) => edit(ctx, "Rename type", (tx) => tx.setName(el.id, v || undefined)))),
        row("Shape", select([{ value: "round", label: "Round" }, { value: "rectangular", label: "Rectangular" }], t.shape, (v) => update<DuctTypeParams>("Duct shape", { shape: v as DuctTypeParams["shape"] }))),
        row("Material", textInput(t.material, (v) => update<DuctTypeParams>("Duct material", { material: v }))),
      );
      break;
    }
    case Cat.MEPSystem: {
      const sys = el as MEPSystem;
      const info = classificationInfo(sys.params.classification);
      const t = systemTotals(doc, sys);
      const members = systemMembers(doc, sys);
      const pick = h("button", { textContent: "Select members" });
      pick.onclick = () => ctx.setSelection(members.map((m) => m.id));
      if (info.domain === "duct") {
        // Duct Sizing (velocity method) from the air each duct carries.
        const vel = h("input", { type: "number", value: "5", min: "1", step: "0.5", title: "Target velocity, m/s" }) as HTMLInputElement;
        const size = h("button", { textContent: "Size ducts" });
        size.onclick = () => {
          let n = 0;
          edit(ctx, "Size ducts", (tx) => (n = sizeDucts(tx, doc, sys.id, { velocity: Number(vel.value) || 5 })));
          if (n) ctx.status(`Sized ${n} duct(s) for ${vel.value} m/s.`);
        };
        sec.append(row("Duct sizing (m/s)", h("div", { class: "buttons" }, vel, size)));
      }
      sec.append(
        row("Name", textInput(el.name ?? "", (v) => v.trim() && edit(ctx, "Rename system", (tx) => tx.setName(el.id, v.trim())))),
        row("System", info.label),
        ...(((sys.params as CircuitParams).panelId)
          ? [
              row("Switchboard", doc.get((sys.params as CircuitParams).panelId!)?.name ?? doc.get((doc.get((sys.params as CircuitParams).panelId!)?.params as { familyId?: string } | undefined)?.familyId ?? "")?.name ?? ""),
              row("Circuit number", numberInput((sys.params as CircuitParams).circuitNumber ?? 0, (v) => edit(ctx, "Circuit number", (tx) => tx.update<CircuitParams>(sys.id, { circuitNumber: Math.max(1, Math.round(v)) })))),
              row("Breaker (A)", numberInput((sys.params as CircuitParams).breaker ?? 16, (v) => edit(ctx, "Breaker rating", (tx) => tx.update<CircuitParams>(sys.id, { breaker: Math.max(1, v) })))),
              row("Current", `${(t.load / SUPPLY_VOLTAGE).toFixed(1)} A`),
            ]
          : []),
        row("Members", String(t.members)),
        ...(info.domain === "electrical" ? [row("Connected load", `${(t.load / 1000).toFixed(2)} kW`)] : [row("Flow", `${t.flow.toFixed(1)} L/s`)]),
        ...(info.domain === "pipe" && t.units ? [row("Units", String(t.units))] : []),
        row("", pick),
      );
      for (const m of members) {
        const fam = m.category === Cat.FamilyInstance ? doc.get((m.params as FamilyInstanceParams).familyId) : undefined;
        const div = h("div", { class: "list-item" }, h("span", {}, m.name ?? fam?.name ?? m.category), h("span", { class: "muted" }, fam ? (m.params as FamilyInstanceParams).typeName : m.category));
        div.onclick = () => ctx.setSelection([m.id]);
        const rm = h("button", { textContent: "\u00d7", title: "Remove from system", class: "mini" });
        rm.onclick = (ev) => {
          ev.stopPropagation();
          edit(ctx, "Remove from system", (tx) => removeFromSystem(tx, doc, sys.id, [m.id]));
        };
        div.append(rm);
        sec.append(div);
      }
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
      if (isPanel(doc, el)) {
        // Switchboard schedule (Revit: panel schedule).
        const sch = panelSchedule(doc, el.id);
        sec.append(h("h3", {}, "Switchboard schedule"));
        if (!sch.rows.length) sec.append(h("div", { class: "muted" }, "No circuits yet: select fixtures, right-click \u2192 Create power/lighting circuit."));
        for (const r of sch.rows) {
          const div = h(
            "div",
            { class: "list-item", title: `${r.fixtures} fixture(s) \u00b7 ${r.current.toFixed(1)} A of ${r.breaker} A` },
            h("span", {}, `${r.number}  ${classificationInfo(r.classification).label}`),
            h("span", { class: r.ok ? "muted" : "fail" }, `${r.load.toFixed(0)} W \u00b7 ${r.current.toFixed(1)}/${r.breaker} A${r.ok ? "" : " \u26a0"}`),
          );
          div.onclick = () => ctx.setSelection([r.circuitId]);
          sec.append(div);
        }
        sec.append(row("Connected load", `${(sch.load / 1000).toFixed(2)} kW (${sch.current.toFixed(1)} A at ${SUPPLY_VOLTAGE} V)`));
      }
      if (isMass(doc, el)) {
        // Mass Floors (Revit: Modify | Mass → Mass Floors): tick the levels to slice it at.
        const floors = massFloors(doc, el.id);
        const on = new Set(floors.map((f) => f.params.levelId));
        const t = massTotals(doc, el.id);
        sec.append(h("h3", {}, "Mass Floors"));
        for (const l of levels(doc)) {
          const cb = checkbox(on.has(l.id), (v) => {
            const next = v ? [...on, l.id] : [...on].filter((x) => x !== l.id);
            edit(ctx, v ? "Add mass floor" : "Remove mass floor", (tx) => setMassFloors(tx, doc, el.id, next));
          });
          sec.append(h("label", { class: "check" }, cb, `${l.name ?? l.id}  (${len(l.params.elevation)})`));
        }
        sec.append(
          row("Gross floor area", formatArea(t.floorArea, units)),
          row("Gross volume", `${(t.volume / 1e9).toFixed(1)} m\u00b3`),
          row("Mass floors", String(t.floors)),
        );
      }
      break;
    }
    case Cat.MassFloor: {
      const mf = el as MassFloor;
      const a = massFloorArea(doc, mf);
      sec.append(
        row("Level", doc.get(mf.params.levelId)?.name ?? ""),
        row("Floor area", formatArea(a.area, units)),
        row("Floor perimeter", len(a.perimeter)),
        h("div", { class: "muted" }, "Mass floors follow their mass. Tick levels in the mass's Properties."),
      );
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
        h("div", { class: "subhead" }, "Render appearance"),
        row("Roughness", fractionInput(p.roughness ?? 0.85, (v) => update<MaterialParams>("Change roughness", { roughness: v }))),
        row("Metalness", fractionInput(p.metalness ?? 0, (v) => update<MaterialParams>("Change metalness", { metalness: v }))),
        row("Transparency", fractionInput(p.transparency ?? 0, (v) => update<MaterialParams>("Change transparency", { transparency: v }))),
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
    case Cat.DetailComponent: {
      const p = el.params as DetailComponentParams;
      sec.append(
        row("Detail item", doc.get(p.familyId)?.name ?? "?"),
        row("Rotation (\u00b0)", numberInput(+((p.rotation * 180) / Math.PI).toFixed(2), (v) => update<DetailComponentParams>("Rotate detail", { rotation: (v * Math.PI) / 180 }))),
        row("Mirrored", checkbox(p.mirrored, (v) => update<DetailComponentParams>("Mirror detail", { mirrored: v }))),
      );
      const editFam = h("button", { textContent: "Edit family" });
      editFam.onclick = () => ctx.editFamily(p.familyId);
      sec.append(row("", editFam));
      break;
    }
    case Cat.Symbol: {
      const p = el.params as SymbolParams;
      sec.append(
        row("Symbol", select(SYMBOL_KINDS, p.kind, (v) => update<SymbolParams>("Change symbol", { kind: v as SymbolKind, size: DEFAULT_SYMBOL_SIZE[v as SymbolKind] }))),
        row("Size (paper mm)", numberInput(p.size, (v) => (v > 0 ? update<SymbolParams>("Symbol size", { size: v }) : ctx.status("⚠ Size must be positive")))),
      );
      if (p.kind === "northArrow") sec.append(row("Points to true north", checkbox(!!p.trueNorth, (v) => update<SymbolParams>("North arrow", { trueNorth: v }))));
      if (p.kind !== "northArrow" || !p.trueNorth) {
        sec.append(row("Rotation (°)", numberInput(+((p.rotation * 180) / Math.PI).toFixed(2), (v) => update<SymbolParams>("Rotate symbol", { rotation: (v * Math.PI) / 180 }))));
      }
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
      sec.append(...thermalRows(ctx, el));
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
        ...coarseFillRows(ctx, t),
        ...thermalRows(ctx, el),
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
  // Design option membership (model elements).
  const sets = optionSets(doc);
  if (sets.length && PHASED.has(el.category)) {
    const opts = [{ value: "", label: "Main model" }, ...sets.flatMap((s) => s.options.map((o) => ({ value: o.id, label: `${s.name}: ${o.name}${o.id === s.primary ? " (primary)" : ""}` })))];
    sec.append(row("Design option", select(opts, elementOption(el) ?? "", (v) => edit(ctx, "Change design option", (tx) => setDesignOption(tx, doc, [el.id], v || null)))));
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

/**
 * The Visibility/Graphics editor for a view (Revit VV): its own settings, or its template's when
 * a template controls it (edits then change the template, for every view using it).
 */
export function viewGraphicsEditor(ctx: PanelContext, viewId: ElementId): HTMLElement {
  const { doc } = ctx;
  const view = doc.get<ViewParams>(viewId) as View | undefined;
  if (!view || view.category !== Cat.View) return h("p", { class: "empty" }, "Open a view first.");
  const template = view.params.templateId ? doc.get<ViewTemplateParams>(view.params.templateId) : undefined;
  if (template) {
    return h(
      "div",
      {},
      h("p", { class: "muted" }, `Controlled by the view template "${template.name}". Changes here change the template, and every view using it.`),
      visibilityGraphics(ctx, template.id, template.params),
    );
  }
  return visibilityGraphics(ctx, view.id, view.params);
}
