import {
  Cat,
  Document,
  applyResidentialTemplate,
  hostedPlacement,
  isWallCutter,
  levels,
  ensureDefaultViews,
  floorPlanFor,
  projectSettings,
  viewRange,
  views,
  createBuildingElevations,
  effectiveGraphics,
  elementGraphics,
  PAPER_SIZES,
  sheets,
  type Sheet,
  isDrawingView,
  is2DView,
  type View,
  type ViewParams,
  typeCategoryOf,
  validateHosted,
  type CeilingParams,
  type ElementId,
  type FloorParams,
  type RoofParams,
  type LevelParams,
  applyFamilyTemplate,
  familyDefs,
  familyInfo,
  familyName,
  familyTypeNames,
  loadFamily,
  familyFile,
  readFamilyFile,
  tableCsv,
  tableXlsx,
  type Schedule,
  parseKeynoteFile,
  setKeynoteTable,
  writeKeynoteFile,
  keynoteTable,
  createAreaPlan,
  createAreaBoundary,
  isPlanView,
  type AreaScheme,
  enableFamilyFlex,
  copyFamilyDef,
  enableGlobalParameters,
  parseSharedParameters,
  createProjectParameter,
  shareProjectParameters,
  writeSharedParameters,
  projectParameters,
  importTypeCatalog,
  typeCatalogCsv,
  setFamilySolver,
  type FamilyCategory,
  type FamilyDef,
} from "@open-bim/core";
import { OcctKernel, SimpleKernel, areaLoopsFromWalls, scheduleTable, createPlaneSolver, sheetDrawing, writePdf } from "@open-bim/geometry";
import occtWasmUrl from "replicad-opencascadejs/wasm?url";
import gcsWasmUrl from "@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url";
import { LIBRARY } from "@open-bim/library";
import { openProject, openText, saveBytes, savePdf, saveProject, saveText } from "./io.ts";
import { renderBrowser, renderProperties, renderSchedulePane, type PanelContext } from "./panels.ts";
import { buildSample } from "./sample.ts";
import {
  GridTool,
  CalloutTool,
  ComponentTool,
  SweepTool,
  DetailLineTool,
  DimensionTool,
  RoomTool,
  RoomSeparatorTool,
  AreaTool,
  TagTool,
  AreaBoundaryTool,
  HostedTool,
  TextTool,
  OpeningTool,
  SectionTool,
  ReferencePlaneTool,
  SelectTool,
  SketchTool,
  WallTool,
  type Tool,
  type ToolContext,
} from "./tools.ts";
import { Viewport, type ViewMode } from "./viewport.ts";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

// ---- state ----------------------------------------------------------------

/** The document being edited: the project, or a family open in the family editor. */
let doc = new Document();
buildSample(doc);
// Global parameters drive element values inside every transaction of the project.
enableGlobalParameters(doc);
/** While a family is open, the project's state to return to. */
let projectSession: Session | null = null;
interface Session {
  doc: Document;
  selection: ElementId[];
  activeLevelId: ElementId;
  activeViewId: ElementId | undefined;
  filePath: string | null;
  dirty: boolean;
}
/** Component tool: the family type chosen in the type selector ("familyId|type"). */
let activeComponentKey: string | undefined;

let selection: ElementId[] = [];
let activeLevelId: ElementId = levels(doc)[0]!.id;
/** The view shown in the viewport (a View element). Starts on the 3D view. */
let activeViewId: ElementId | undefined = views(doc).find((v) => v.params.kind === "3d")?.id;
/** Type selector state: the type each placing tool uses, per type category. */
const activeTypes = new Map<string, ElementId>();
/** Type category each placing tool creates. */
const TOOL_TYPES: Record<string, string> = {
  wall: Cat.WallType,
  floor: Cat.FloorType,
  ceiling: Cat.CeilingType,
  roof: Cat.RoofType,
  door: Cat.DoorType,
  window: Cat.WindowType,
};
const activeTypeId = (cat: string): ElementId | undefined => {
  const id = activeTypes.get(cat);
  return id && doc.has(id) ? id : doc.byCategory(cat)[0]?.id;
};
let filePath: string | null = null;
let dirty = false;

const viewport = new Viewport($("#viewport"), doc, new SimpleKernel());
const status = (text: string): void => {
  $("#status").textContent = text;
};

const ctx: ToolContext & PanelContext = {
  get doc() {
    return doc;
  },
  viewport,
  formIsVoid: () => $<HTMLInputElement>("#void-form").checked,
  activeComponent() {
    const defs = familyDefs(doc);
    const [id, type] = (activeComponentKey ?? "").split("|");
    const def = defs.find((d) => d.id === id) ?? defs[0];
    if (!def) return undefined;
    const types = familyTypeNames(def);
    return { familyId: def.id, typeName: def.id === id && type && types.includes(type) ? type : (types[0] ?? "Default") };
  },
  newFamily(category: FamilyCategory) {
    const fam = new Document();
    let n = 1;
    while (familyDefs(doc).some((f) => f.name === `${category} ${n}`)) n++;
    applyFamilyTemplate(fam, category, `${category} ${n}`);
    openFamily(fam);
  },
  projectFamilies: () => (projectSession ? familyDefs(projectSession.doc) : []),
  nestFamily(defId: ElementId) {
    const s = projectSession;
    if (!s) return;
    const def = s.doc.require(defId) as FamilyDef;
    try {
      doc.transact(`Load ${def.name} into family`, (tx) => copyFamilyDef(tx, doc, def));
      status(`${def.name} loaded into this family. Place it with Component (C); associate its parameters in Properties.`);
    } catch (err) {
      status(`\u26a0 ${(err as Error).message}`);
    }
  },
  async importSharedParameters() {
    try {
      const text = await openText({ name: "Shared parameters", extensions: ["txt"] });
      if (!text) return;
      const defs = parseSharedParameters(text);
      const have = new Set(projectParameters(doc).map((p) => p.params.guid));
      const fresh = defs.filter((d) => !have.has(d.guid));
      doc.transact("Add shared parameters", (tx) => {
        for (const d of fresh) {
          let name = d.name;
          for (let i = 2; projectParameters(doc).some((p) => p.name === name); i++) name = `${d.name} (${i})`;
          createProjectParameter(tx, doc, name, { dataType: d.dataType, guid: d.guid, group: d.group });
        }
      });
      status(`Added ${fresh.length} shared parameter(s). Tick their categories in Properties.`);
    } catch (err) {
      status(`\u26a0 ${(err as Error).message}`);
    }
  },
  async exportSharedParameters() {
    try {
      const defs = doc.transact("Share project parameters", (tx) => shareProjectParameters(tx, doc));
      const path = await saveText(writeSharedParameters(defs), "Shared Parameters.txt", { name: "Shared parameters", extensions: ["txt"] });
      if (path) status(`Shared parameter file saved to ${path}`);
    } catch (err) {
      status(`\u26a0 ${(err as Error).message}`);
    }
  },
  async exportCatalog() {
    try {
      const path = await saveText(typeCatalogCsv(doc), `${familyName(doc)}.txt`, { name: "Type catalog", extensions: ["txt", "csv"] });
      if (path) status(`Type catalog saved to ${path}`);
    } catch (err) {
      status(`\u26a0 ${(err as Error).message}`);
    }
  },
  async importCatalog() {
    try {
      const text = await openText({ name: "Type catalog", extensions: ["txt", "csv"] });
      if (!text) return;
      const types = doc.transact("Import type catalog", (tx) => importTypeCatalog(tx, doc, text));
      status(`Loaded ${types.length} type(s) from the catalog.`);
    } catch (err) {
      status(`\u26a0 ${(err as Error).message}`);
    }
  },
  async exportSchedule(id: ElementId, format: "csv" | "xlsx") {
    try {
      const s = doc.require(id) as Schedule;
      const t = scheduleTable(doc, s);
      const name = (s.name ?? "Schedule").replace(/[\\/:*?"<>|]/g, "-");
      const path =
        format === "csv"
          ? await saveText(tableCsv(t), `${name}.csv`, { name: "CSV", extensions: ["csv"] })
          : await saveBytes(tableXlsx(t), `${name}.xlsx`, { name: "Excel workbook", extensions: ["xlsx"] }, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      if (path) status(`Schedule exported to ${path}`);
    } catch (err) {
      status(`\u26a0 ${(err as Error).message}`);
    }
  },
  async importKeynotes() {
    try {
      const text = await openText({ name: "Keynote file", extensions: ["txt"] });
      if (!text) return;
      const entries = parseKeynoteFile(text);
      doc.transact("Load keynote file", (tx) => setKeynoteTable(tx, doc, entries));
      status(`Loaded ${entries.length} keynote(s).`);
    } catch (err) {
      status(`\u26a0 ${(err as Error).message}`);
    }
  },
  async exportKeynotes() {
    try {
      const path = await saveText(writeKeynoteFile(keynoteTable(doc)), "Keynotes.txt", { name: "Keynote file", extensions: ["txt"] });
      if (path) status(`Keynotes saved to ${path}`);
    } catch (err) {
      status(`\u26a0 ${(err as Error).message}`);
    }
  },
  newAreaPlan(levelId: ElementId, scheme: AreaScheme) {
    try {
      const plan = doc.transact("Create area plan", (tx) => {
        const v = createAreaPlan(tx, doc, levelId, scheme);
        for (const l of areaLoopsFromWalls(doc, levelId, scheme)) l.forEach((a, i) => createAreaBoundary(tx, doc, v.id, a, l[(i + 1) % l.length]!));
        return v;
      });
      ctx.setActiveView(plan.id);
      status(`${plan.name}: boundaries from walls added. Place areas with the Area tool.`);
    } catch (err) {
      status(`\u26a0 ${(err as Error).message}`);
    }
  },
  libraryFamilies: () => LIBRARY.map((f) => ({ name: f.name, category: f.category, description: f.description })),
  loadLibraryFamily(name: string) {
    const lib = LIBRARY.find((f) => f.name === name);
    if (lib) loadFamilyIntoProject(lib.build(), lib.name);
  },
  async loadFamilyFile() {
    try {
      const text = await openText({ name: "Open-BIM family", extensions: ["obim-family", "json"] });
      if (!text) return;
      const fam = readFamilyFile(JSON.parse(text));
      loadFamilyIntoProject(fam, familyName(fam));
    } catch (err) {
      status(`⚠ ${(err as Error).message}`);
    }
  },
  editFamily(defId: ElementId) {
    const def = doc.require(defId) as FamilyDef;
    openFamily(Document.fromJSON(def.params.json as unknown as ReturnType<Document["toJSON"]>));
  },
  activeLevelId: () => activeLevelId,
  activeTypeId,
  selection: () => selection,
  setSelection(ids) {
    selection = ids;
    viewport.setSelection(ids);
    refreshPanels();
  },
  setActiveLevel(id) {
    activeLevelId = id;
    // In a plan, picking another level opens that level's plan.
    if (activeView()?.params.kind === "floorPlan") {
      const plan = floorPlanFor(doc, id);
      if (plan) activeViewId = plan.id;
    }
    refreshAll();
  },
  activeViewId: () => activeViewId,
  setActiveView(id) {
    activeViewId = id;
    const v = activeView();
    if (v?.params.levelId) activeLevelId = v.params.levelId;
    // Switching views clears the selection (Revit does too), so Properties shows the new view.
    selection = [];
    viewport.setSelection([]);
    refreshAll();
  },
  editBoundary(id) {
    const el = doc.require<FloorParams | CeilingParams | RoofParams>(id);
    const name = { [Cat.Ceiling]: "ceiling", [Cat.Roof]: "roof", [Cat.FilledRegion]: "region" }[el.category] ?? "floor";
    // Filled regions belong to a view, not a level.
    if (el.params.levelId) activeLevelId = el.params.levelId;
    setTool(name);
    refreshAll();
    (tools[name] as SketchTool).edit(id);
  },
  status,
};

// ---- tools ----------------------------------------------------------------

const tools: Record<string, Tool> = { select: new SelectTool(ctx), wall: new WallTool(ctx), grid: new GridTool(ctx),
  refplane: new ReferencePlaneTool(ctx),
  floor: new SketchTool(ctx, "floor"),
  ceiling: new SketchTool(ctx, "ceiling"),
  roof: new SketchTool(ctx, "roof"),
  opening: new OpeningTool(ctx),
  door: new HostedTool(ctx, "door"),
  window: new HostedTool(ctx, "window"),
  section: new SectionTool(ctx),
  callout: new CalloutTool(ctx),
  extrusion: new SketchTool(ctx, "extrusion"),
  blend: new SketchTool(ctx, "blend"),
  revolution: new SketchTool(ctx, "revolution"),
  sweep: new SweepTool(ctx),
  component: new ComponentTool(ctx),
  detailline: new DetailLineTool(ctx),
  region: new SketchTool(ctx, "region"),
  cloud: new SketchTool(ctx, "cloud"),
  text: new TextTool(ctx),
  dimension: new DimensionTool(ctx),
  room: new RoomTool(ctx),
  roomseparator: new RoomSeparatorTool(ctx),
  area: new AreaTool(ctx),
  tag: new TagTool(ctx, "category"),
  keynote: new TagTool(ctx, "keynote"),
  areaboundary: new AreaBoundaryTool(ctx),
};
/** Tools that work in sections/elevations (the rest need a plan or 3D work plane). */
const DRAWING_TOOLS = new Set(["select", "detailline", "region", "cloud", "text", "tag", "keynote", "extrusion", "blend", "revolution"]);
let tool: Tool = tools.select!;

function setTool(name: string): void {
  if (viewport.viewMode === "drawing" && !DRAWING_TOOLS.has(name)) {
    status("That tool works in plan and 3D views. Open a floor plan or the 3D view to use it.");
    name = "select";
  }
  if (name === "callout" && activeView()?.params.kind !== "floorPlan") {
    status("Callouts are drawn on floor plans. Open a floor plan first.");
    name = "select";
  }
  tool.deactivate?.();
  tool = tools[name] ?? tools.select!;
  tool.activate?.();
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => {
    b.classList.toggle("active", b.dataset.tool === tool.name);
  });
  refreshTypeSelector();
}

const canvas = viewport.renderer.domElement;
let downAt: { x: number; y: number } | null = null;
canvas.addEventListener("pointerdown", (ev) => {
  if (ev.button === 0) downAt = { x: ev.clientX, y: ev.clientY };
  tool.pointerDown?.(ev);
});
// Listen on window so a box-select drag that leaves the canvas still finishes.
window.addEventListener("pointerup", (ev) => {
  tool.pointerUp?.(ev);
  if (ev.button !== 0 || !downAt) return;
  const moved = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y);
  downAt = null;
  if (moved < 5 && ev.target === canvas) tool.click?.(ev);
});
canvas.addEventListener("pointermove", (ev) => tool.pointerMove?.(ev));
canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());

// ---- commands -------------------------------------------------------------

const commands: Record<string, () => void | Promise<void>> = {
  new() {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    const fresh = new Document();
    applyResidentialTemplate(fresh);
    loadInto(fresh.toJSON(), null);
  },
  async open() {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    try {
      const result = await openProject();
      if (result) loadInto(result.json, result.path);
    } catch (err) {
      status(`⚠ Could not open: ${(err as Error).message}`);
    }
  },
  loadFamily() {
    if (!projectSession) return status("Load into Project: open a family first.");
    const fam = doc;
    const name = familyName(fam);
    closeFamilyEditor();
    try {
      doc.transact(`Load family ${name}`, (tx) => loadFamily(tx, doc, fam, name));
      activeComponentKey = undefined;
      status(`Loaded ${name}. Place it with the Component tool (C).`);
    } catch (err) {
      status(`\u26a0 ${(err as Error).message}`);
    }
  },
  async saveFamilyFile() {
    if (!projectSession) return status("Save Family File: open a family first.");
    try {
      const name = familyName(doc);
      const path = await saveText(JSON.stringify(familyFile(doc), null, 1), `${name}.obim-family`, { name: "Open-BIM family", extensions: ["obim-family"] });
      if (path) status(`Family saved to ${path}`);
    } catch (err) {
      status(`⚠ ${(err as Error).message}`);
    }
  },
  closeFamily() {
    if (!projectSession) return;
    if (dirty && !confirm("Close the family without loading it into the project?")) return;
    closeFamilyEditor();
    status("Family closed.");
  },
  async save() {
    if (projectSession) return status("You're editing a family: use Load into Project to keep it.");
    try {
      const path = await saveProject(doc.toJSON(), filePath);
      if (path) {
        filePath = path;
        dirty = false;
        status(`Saved ${path}`);
        updateTitle();
      }
    } catch (err) {
      status(`⚠ Could not save: ${(err as Error).message}`);
    }
  },
  undo() {
    doc.undo();
  },
  redo() {
    doc.redo();
  },
  fit() {
    viewport.zoomToFit();
  },
  // Temporary hide/isolate (Revit HH / HI / HC / IC / HR). Category variants act on the selection's categories.
  hide() {
    if (!selection.length) return status("Hide: select something first.");
    viewport.visibility.hide(selection);
    afterVisibility(`Hid ${selection.length} element(s)`);
    ctx.setSelection([]);
  },
  isolate() {
    if (!selection.length) return status("Isolate: select something first.");
    viewport.visibility.isolate(selection);
    afterVisibility(`Isolated ${selection.length} element(s)`);
  },
  hideCategory() {
    const cats = selectedCategories();
    if (!cats.length) return status("Hide category: select something first.");
    viewport.visibility.hideCategories(cats);
    afterVisibility(`Hid ${cats.join(", ")}`);
    ctx.setSelection([]);
  },
  isolateCategory() {
    const cats = selectedCategories();
    if (!cats.length) return status("Isolate category: select something first.");
    viewport.visibility.isolateCategories(cats);
    afterVisibility(`Isolated ${cats.join(", ")}`);
  },
  async exportPdf() {
    const all = sheets(doc);
    if (!all.length) return status("Export PDF: create a sheet first (Project Browser \u2192 Sheets \u2192 New sheet).");
    try {
      const kernel = viewport.geometryKernel;
      const pages = all.map((s) => ({ ...PAPER_SIZES[s.params.size], drawing: sheetDrawing(doc, kernel, s) }));
      const project = projectSettings(doc)?.params.info.name || "Open-BIM";
      const path = await savePdf(writePdf(pages, project), `${project} - Sheets.pdf`);
      if (path) status(`Exported ${pages.length} sheet(s) to ${path}`);
    } catch (err) {
      status(`\u26a0 Could not export PDF: ${(err as Error).message}`);
    }
  },
  elevations() {
    // N/E/S/W elevations around the model's walls.
    const walls = doc.byCategory<{ start: { x: number; y: number }; end: { x: number; y: number } }>(Cat.Wall);
    if (!walls.length) return status("Elevations: draw some walls first.");
    const xs = walls.flatMap((w) => [w.params.start.x, w.params.end.x]);
    const ys = walls.flatMap((w) => [w.params.start.y, w.params.end.y]);
    const min = { x: Math.min(...xs), y: Math.min(...ys) };
    const max = { x: Math.max(...xs), y: Math.max(...ys) };
    const made = doc.transact("Create building elevations", (tx) => createBuildingElevations(tx, doc, min, max));
    status(made.length ? `Created ${made.map((v) => v.name).join(", ")} elevations.` : "Building elevations already exist.");
  },
  resetVisibility() {
    viewport.visibility.reset();
    afterVisibility("Temporary hide/isolate reset");
  },
};

function selectedCategories(): string[] {
  return [...new Set(selection.map((id) => doc.require(id).category))];
}

function afterVisibility(message: string): void {
  viewport.refreshVisibility();
  selection = selection.filter((id) => viewport.visibility.isVisible(doc.require(id)));
  viewport.setSelection(selection);
  refreshPanels();
  status(viewport.visibility.active ? `${message} \u00b7 temporary hide/isolate is on (U to reset)` : message);
}

function loadInto(json: ReturnType<Document["toJSON"]>, path: string | null): void {
  doc.load(json);
  // Files from before views were elements: give them plans and a 3D view.
  if (doc.byCategory(Cat.View).length === 0) doc.transact("Create default views", (tx) => ensureDefaultViews(tx, doc));
  filePath = path;
  dirty = false;
  selection = [];
  activeLevelId = levels(doc)[0]?.id ?? "";
  activeTypes.clear();
  activeViewId = views(doc).find((v) => v.params.kind === "3d")?.id;
  viewport.visibility.reset();
  viewport.refreshVisibility();
  viewport.setSelection([]);
  refreshAll();
  viewport.zoomToFit();
  status(path ? `Opened ${path}` : "New project");
}

document.querySelectorAll<HTMLButtonElement>("[data-cmd]").forEach((b) => {
  // Shift+click on Hide/Isolate acts on whole categories.
  b.onclick = (ev) => {
    const cmd = b.dataset.cmd!;
    const byCategory = ev.shiftKey && (cmd === "hide" || cmd === "isolate");
    void commands[byCategory ? `${cmd}Category` : cmd]?.();
  };
});
document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => {
  b.onclick = () => setTool(b.dataset.tool!);
});
// Toolbar Plan / 3D: jump to the active level's plan, or the first 3D view.
document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b) => {
  b.onclick = () => {
    const target =
      (b.dataset.view as ViewMode) === "plan"
        ? floorPlanFor(doc, activeLevelId)
        : views(doc).find((v) => v.params.kind === "3d");
    if (target) ctx.setActiveView(target.id);
    else status(`\u26a0 No ${b.dataset.view === "plan" ? "floor plan for this level" : "3D view"} in this project`);
  };
});

function activeView(): View | undefined {
  const v = activeViewId ? doc.get<ViewParams>(activeViewId) : undefined;
  return v as View | undefined;
}

/** Push the active view's settings (mode, range, hidden categories) into the viewport. */
function applyView(): void {
  // Schedules open like views, as a table over the viewport.
  const active = activeViewId ? doc.get(activeViewId) : undefined;
  const pane = $<HTMLDivElement>("#schedule-pane");
  pane.hidden = active?.category !== Cat.Schedule;
  if (active?.category === Cat.Schedule) {
    renderSchedulePane(pane, ctx, active as Schedule);
    if (tool.name !== "select") setTool("select");
    return;
  }
  // Sheets open like views.
  const sheet = active;
  if (sheet?.category === Cat.Sheet) {
    viewport.setSheet(sheet as Sheet);
    viewport.setGraphicsResolver(() => ({ visible: true, halftone: false, color: null }));
    viewport.setAnnotationView(sheet.id);
    viewport.setPlanLevel(undefined);
    if (!DRAWING_TOOLS.has(tool.name)) setTool("select");
    return;
  }
  if (!activeView()) activeViewId = views(doc).find((v) => v.params.kind === "3d")?.id ?? views(doc)[0]?.id;
  const v = activeView();
  if (!v) return viewport.setViewMode("3d");
  if (isPlanView(v)) {
    viewport.setPlanRange(viewRange(doc, v));
    viewport.setViewMode("plan");
    viewport.setPlanCrop(v.params.kind === "callout" ? (v.params.crop ?? null) : null);
  } else if (is2DView(v)) {
    viewport.setDrawingView(v);
  } else {
    viewport.setViewMode("3d");
  }
  // Visibility/Graphics: the view's own settings, or its template's.
  const g = effectiveGraphics(doc, v);
  viewport.setGraphicsResolver((el) => elementGraphics(doc, g, el));
  viewport.setAnnotationView(v.id);
  // Rooms show in floor plans and callouts of their level (area plans show areas instead).
  viewport.setPlanLevel(viewport.viewMode === "plan" && v.params.kind !== "areaPlan" ? (v.params.levelId ?? undefined) : undefined);
  viewport.setViewGraphics({ detailLevel: g.detailLevel, scale: g.scale });
  if (viewport.viewMode === "drawing" && !DRAWING_TOOLS.has(tool.name)) setTool("select");
}

window.addEventListener("keydown", (ev) => {
  const target = ev.target as HTMLElement;
  if (target.matches("input, select, textarea")) return;
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && ev.key.toLowerCase() === "z" && !ev.shiftKey) return run(ev, "undo");
  if (mod && (ev.key.toLowerCase() === "y" || (ev.shiftKey && ev.key.toLowerCase() === "z"))) return run(ev, "redo");
  if (mod && ev.key.toLowerCase() === "s") return run(ev, "save");
  if (mod && ev.key.toLowerCase() === "o") return run(ev, "open");
  if (mod && ev.key.toLowerCase() === "n") return run(ev, "new");
  if (mod) return;
  if (tool.key?.(ev)) return ev.preventDefault();
  if (ev.key === "Escape") return setTool("select");
  if (ev.key.toLowerCase() === "w") return setTool("wall");
  if (ev.key.toLowerCase() === "g") return setTool("grid");
  if (ev.key.toLowerCase() === "r") return setTool("refplane");
  if (ev.key.toLowerCase() === "d") return setTool("door");
  if (ev.key.toLowerCase() === "n") return setTool("window");
  if (ev.key.toLowerCase() === "s") return setTool("section");
  if (ev.key.toLowerCase() === "l") return setTool("detailline");
  if (ev.key.toLowerCase() === "t") return setTool("text");
  if (ev.key.toLowerCase() === "m") return setTool("dimension");
  if (ev.key.toLowerCase() === "c") return setTool("component");
  if (ev.key.toLowerCase() === "f") return run(ev, "fit");
  if (ev.key.toLowerCase() === "h") return run(ev, ev.shiftKey ? "hideCategory" : "hide");
  if (ev.key.toLowerCase() === "i") return run(ev, ev.shiftKey ? "isolateCategory" : "isolate");
  if (ev.key.toLowerCase() === "u") return run(ev, "resetVisibility");
});

function run(ev: KeyboardEvent, cmd: string): void {
  ev.preventDefault();
  void commands[cmd]?.();
}

// ---- UI refresh -----------------------------------------------------------

function refreshToolbar(): void {
  const lvl = $<HTMLSelectElement>("#active-level");
  lvl.replaceChildren(
    ...levels(doc).map((l) => new Option(l.name ?? l.id, l.id, false, l.id === activeLevelId)),
  );
  lvl.onchange = () => ctx.setActiveLevel(lvl.value);

  refreshTypeSelector();

  $<HTMLButtonElement>('[data-cmd="undo"]').disabled = !doc.canUndo;
  $<HTMLButtonElement>('[data-cmd="redo"]').disabled = !doc.canRedo;
  $<HTMLButtonElement>('[data-cmd="undo"]').title = doc.undoName ? `Undo ${doc.undoName} (Ctrl+Z)` : "Undo";
  $<HTMLButtonElement>('[data-cmd="redo"]').title = doc.redoName ? `Redo ${doc.redoName} (Ctrl+Y)` : "Redo";

  const lv = doc.get<LevelParams>(activeLevelId);
  if (lv) {
    viewport.setWorkPlane(lv.params.elevation);
  }
  applyView();
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === viewport.viewMode);
  });
}

/**
 * Revit-style type selector. With a placing tool active it picks the type to place; otherwise it
 * shows (and changes) the type of the selected elements when they share a type category.
 */
function refreshTypeSelector(): void {
  const sel = $<HTMLSelectElement>("#active-type");
  const label = $<HTMLSpanElement>("#active-type-label");
  if (tool.name === "component") {
    // Component: every loaded family's types, "Family : Type".
    const current = ctx.activeComponent();
    const opts = familyDefs(doc).flatMap((d) => familyTypeNames(d).map((t) => ({ key: `${d.id}|${t}`, label: `${d.name} : ${t}` })));
    sel.disabled = !opts.length;
    label.textContent = "Family type";
    sel.replaceChildren(
      ...(opts.length ? [] : [new Option("(no families loaded)", "")]),
      ...opts.map((o) => new Option(o.label, o.key, false, current ? o.key === `${current.familyId}|${current.typeName}` : false)),
    );
    sel.onchange = () => {
      activeComponentKey = sel.value;
      tool.activate?.();
    };
    return;
  }
  const toolCat = TOOL_TYPES[tool.name];
  const selCats = [...new Set(selection.map((id) => doc.get(id)).map((e) => e && typeCategoryOf(e.category)))];
  const cat = toolCat ?? (selCats.length === 1 ? selCats[0] : undefined);
  if (!cat) {
    sel.replaceChildren(new Option("\u2014", ""));
    sel.disabled = true;
    label.textContent = "Type";
    return;
  }
  sel.disabled = false;
  label.textContent = cat.replace(/Type$/, " type");
  const types = new Set(selection.map((id) => doc.get(id)?.typeId));
  const current = toolCat ? activeTypeId(cat) : types.size === 1 ? [...types][0] : undefined;
  sel.replaceChildren(
    ...(current ? [] : [new Option("(varies)", "", true, true)]),
    ...doc.byCategory(cat).map((t) => new Option(t.name ?? t.id, t.id, false, t.id === current)),
  );
  sel.onchange = () => {
    if (!sel.value) return;
    if (toolCat) {
      activeTypes.set(cat, sel.value);
      tool.activate?.();
      return;
    }
    try {
      doc.transact("Change type", (tx) => {
        for (const id of selection) {
          tx.setType(id, sel.value);
          const el = doc.require(id);
          if (isWallCutter(el.category)) validateHosted(doc, hostedPlacement(doc, el));
        }
      });
    } catch (err) {
      status(`\u26a0 ${(err as Error).message}`);
      refreshTypeSelector();
    }
  };
}

function refreshPanels(): void {
  refreshTypeSelector();
  renderBrowser($("#browser-body"), ctx);
  renderProperties($("#properties-body"), ctx);
  const active = activeViewId ? doc.get(activeViewId) : undefined;
  if (active?.category === Cat.Schedule) renderSchedulePane($("#schedule-pane"), ctx, active as Schedule);
}

function refreshAll(): void {
  if (!doc.has(activeLevelId)) activeLevelId = levels(doc)[0]?.id ?? "";
  refreshToolbar();
  refreshPanels();
  updateTitle();
}

function updateTitle(): void {
  if (projectSession) {
    document.title = `${dirty ? "\u2022 " : ""}Family: ${familyName(doc)} \u2014 Open-BIM`;
    $("#family-banner").textContent = `Editing family: ${familyName(doc)}`;
    return;
  }
  const name = filePath?.split(/[\\/]/).pop() ?? "Untitled";
  const project = projectSettings(doc)?.params.info.name;
  document.title = `${dirty ? "• " : ""}${name}${project ? ` (${project})` : ""} — Open-BIM`;
}

function attachDocument(d: Document): () => void {
  return d.on((c) => {
    if (c.name !== "Load") dirty = true;
    selection = selection.filter((id) => doc.has(id));
    refreshAll();
    if (c.name.startsWith("Undo") || c.name.startsWith("Redo")) status(c.name);
  });
}
let detachDocument = attachDocument(doc);

/** Show another document, restoring that document's view/selection state. */
function switchDocument(next: Document, s: Partial<Session> = {}): void {
  tool.deactivate?.();
  detachDocument();
  doc = next;
  detachDocument = attachDocument(doc);
  viewport.setDocument(doc);
  selection = s.selection ?? [];
  activeLevelId = s.activeLevelId ?? levels(doc)[0]?.id ?? "";
  activeViewId = s.activeViewId ?? floorPlanFor(doc, activeLevelId)?.id ?? views(doc)[0]?.id;
  filePath = s.filePath ?? null;
  dirty = s.dirty ?? false;
  activeTypes.clear();
  document.body.classList.toggle("family-mode", !!familyInfo(doc));
  setTool("select");
  refreshAll();
  viewport.zoomToFit();
}

/** Open a family document in the family editor (the project waits in the background). */
function openFamily(fam: Document): void {
  if (projectSession) return status("Finish the open family first (Load into Project or Close Family).");
  projectSession = { doc, selection, activeLevelId, activeViewId, filePath, dirty };
  // Labelled/EQ dimensions move reference planes after every edit, within the same undo step.
  stopFlex = enableFamilyFlex(fam);
  switchDocument(fam);
  status(`Family editor: ${familyName(fam)}. Sketch forms with Extrusion / Blend / Revolve / Sweep; set parameters and types in Properties.`);
}

let stopFlex: () => void = () => {};

/** Load (or reload, by name) a family document into the open project. */
function loadFamilyIntoProject(fam: Document, name: string): void {
  if (projectSession) return status("Finish the open family first (Load into Project or Close Family).");
  try {
    const reload = familyDefs(doc).some((f) => f.name === name);
    const def = doc.transact(`${reload ? "Reload" : "Load"} family ${name}`, (tx) => loadFamily(tx, doc, fam, name));
    activeComponentKey = `${def.id}|${familyTypeNames(def)[0] ?? ""}`;
    status(`${reload ? "Reloaded" : "Loaded"} ${name}. Place it with the Component tool (C).`);
  } catch (err) {
    status(`⚠ ${(err as Error).message}`);
  }
}

function closeFamilyEditor(): void {
  const s = projectSession;
  if (!s) return;
  stopFlex();
  projectSession = null;
  switchDocument(s.doc, s);
}

refreshAll();
setTool("select");
viewport.zoomToFit();

// Family constraint solver (PlaneGCS, ~1 MB WASM): small and quick, so load it straight away.
createPlaneSolver({ locateFile: () => gcsWasmUrl })
  .then((s) => {
    setFamilySolver(s);
    viewport.rebuildAll();
  })
  .catch((err) => {
    console.error(err);
    status("\u26a0 The family constraint solver failed to load \u2014 labelled dimensions won't flex.");
  });

// Start on the fast extrusion kernel; switch to OpenCascade (booleans for openings) once its WASM loads.
OcctKernel.create({ locateFile: () => occtWasmUrl })
  .then((k) => viewport.setKernel(k))
  .catch((err) => {
    console.error(err);
    status("\u26a0 OpenCascade failed to load \u2014 openings won't cut walls until restart.");
  });
