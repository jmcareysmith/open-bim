import { ContainmentTool } from "./containtool.ts";
import { FaceTool } from "./facetool.ts";
import { MANAGE_SECTIONS, projectSection } from "./panels.ts";
import { openMaterialBrowser } from "./materialbrowser.ts";
import { RunTool } from "./runtool.ts";
import { Panes, type PaneLayout } from "./panes.ts";
import { openShortcutEditor, shortcutTable } from "./shortcuts.ts";
import { BROWSER_DRAG } from "./panels.ts";
import { addRecentFile, fileName, recentFiles, removeRecentFile } from "./recent.ts";
import { CameraTool } from "./cameratool.ts";
import { SlopeArrowTool } from "./slopetool.ts";
import {
  Cat,
  Document,
  transformElements,
  translation,
  detachWall,
  DETAIL_GROUPABLE,
  isDetailFamily,
  createLegend,
  createOptionSet,
  createRevision,
  createSchedule,
  createSheet,
  ensureProjectSettings,
  optionSets,
  flipWall,
  groupOf,
  type Element as ModelElement,
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
  parseSurveyCsv,
  type ToposolidParams,
  zipStore,
  createLink,
  reloadLink,
  type Link,
  createCadImport,
  createGroup,
  groupMembers,
  GROUPABLE,
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
  defaultGraphics,
  viewSun,
  type WallParams,
  placeView,
  SYSTEM_CLASSIFICATIONS,
  addToSystem,
  connectableClassifications,
  createSystem,
  mepSystems,
  enableDuctFittings,
  placeFamilyInstance,
  type FamilyInstanceParams,
  recordExistingGround,
  createPropertyLine,
  pointsFromLegs,
  createCircuit,
  panels,
} from "@open-bim/core";
import { OcctKernel, SimpleKernel, findClashes, exportGlb, exportObj, exportParts, areaLoopsFromWalls, drawingDxf, parseDxf, viewDrawing, scheduleTable, createPlaneSolver, sheetDrawing, writePdf } from "@open-bim/geometry";
import occtWasmUrl from "replicad-opencascadejs/wasm?url";
import gcsWasmUrl from "@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url";
import { LIBRARY } from "@open-bim/library";
// The IFC exporter is small; web-ifc (import) loads on demand.
import { exportIfc } from "@open-bim/ifc/export";
import { SyncClient, bindDocument, newYDoc, type Binding } from "@open-bim/collab";
import type { IfcApi } from "@open-bim/ifc";
import ifcWasmUrl from "web-ifc/web-ifc.wasm?url";
import { dwgConverterPath, isTauri, openBytes, openCad, openProject, openText, readProjectAt, saveBytes, saveCad, savePdf, saveProject, saveText, setDwgConverterPath } from "./io.ts";
import { renderBrowser, renderProperties, renderSchedulePane, viewGraphicsEditor, type PanelContext } from "./panels.ts";
import { PluginHost, mountConsole } from "./plugins.ts";
import { buildSample } from "./sample.ts";
import {
  GridTool,
  CalloutTool,
  ComponentTool,
  SweepTool,
  DetailLineTool,
  DimensionTool,
  RoomTool,
  StairTool,
  ColumnTool,
  BeamTool,
  FootingTool,
  DemolishTool,
  RailingTool,
  PlaceGroupTool,
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
import { openRender } from "./render.ts";
import { renderNzChecks } from "./nzchecks.ts";
import { ModifyTool, type ModifyToolContext, type ToolOption } from "./modifytools.ts";
import { AlignTool, OffsetTool, SplitTool, TrimTool } from "./edittools.ts";
import { GripLayer } from "./grips.ts";
import { openDialog, showContextMenu, type MenuItem } from "./dialog.ts";
import { Docking } from "./docking.ts";
import { ViewBar } from "./viewbar.ts";
import { makeCollapsible } from "./collapse.ts";
import { Ribbon } from "./ribbon.ts";
import { ribbonTabs } from "./ribbondefs.ts";
import { openFindReplace, openSpelling } from "./textdialogs.ts";
import { SymbolTool } from "./symboltool.ts";
import { openOverrideDialog } from "./overridedialog.ts";
import { DetailComponentTool } from "./detailtool.ts";
import { AttachTool } from "./attachtool.ts";
import { ElevationTool } from "./elevationtool.ts";

/** The family editor's Void toggle; one element, shown on the Create tab. */
const voidForm = Object.assign(document.createElement("input"), { type: "checkbox", id: "void-form" });
const voidToggle = () => {
  const l = document.createElement("label");
  l.className = "rb-check";
  l.title = "New forms are voids (cut the solids)";
  l.append(voidForm, " Void");
  return l;
};

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

// ---- state ----------------------------------------------------------------

/** The document being edited: the project, or a family open in the family editor. */
let doc = new Document();
buildSample(doc);
// The sample is the starting point: Undo mustn't take it apart.
doc.clearHistory();
// Global parameters drive element values inside every transaction of the project.
enableGlobalParameters(doc);
enableDuctFittings(doc);
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
let ifcApi: IfcApi | undefined;

let selection: ElementId[] = [];
let activeLevelId: ElementId = levels(doc)[0]!.id;
/** The view shown in the viewport (a View element). Starts on the 3D view. */
let activeViewId: ElementId | undefined = views(doc).find((v) => v.params.kind === "3d")?.id;
/** Type selector state: the type each placing tool uses, per type category. */
const activeTypes = new Map<string, ElementId>();
/** Type category each placing tool creates. */
const TOOL_TYPES: Record<string, string> = {
  wall: Cat.WallType,
  "face-wall": Cat.WallType,
  "face-roof": Cat.RoofType,
  "face-floor": Cat.FloorType,
  duct: Cat.DuctType,
  floor: Cat.FloorType,
  ceiling: Cat.CeilingType,
  roof: Cat.RoofType,
  door: Cat.DoorType,
  window: Cat.WindowType,
  stair: Cat.StairType,
  railing: Cat.RailingType,
  ramp: Cat.RampType,
  column: Cat.StructuralType,
  beam: Cat.StructuralType,
};
const activeTypeId = (cat: string): ElementId | undefined => {
  const id = activeTypes.get(cat);
  return id && doc.has(id) ? id : doc.byCategory(cat)[0]?.id;
};
let filePath: string | null = null;
let dirty = false;

// Project Browser and Properties: dockable left/right, tabbed or floating.
const docking = new Docking(
  [
    { id: "browser", title: "Project Browser", el: $("#browser") },
    { id: "properties", title: "Properties", el: $("#properties") },
  ],
  $("main"),
);
const viewport = new Viewport($("#viewport"), doc, new SimpleKernel());
const status = (text: string): void => {
  $("#status").textContent = text;
};

const ctx: ModifyToolContext & PanelContext = {
  get doc() {
    return doc;
  },
  viewport,
  setToolOptions: (options) => renderToolOptions(options),
  formIsVoid: () => voidForm.checked,
  activeComponent() {
    const defs = familyDefs(doc).filter((d) => !isDetailFamily(d));
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
    fam.clearHistory();
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
  placeGroupCopy: () => void commands.placeGroupCopy?.(),
  linkProject: () => void commands.linkProject?.(),
  importSurvey: (id: ElementId) => void importSurveyPoints(id),
  reloadLink: (id: ElementId) => void reloadLinkFile(id),
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
  libraryFamilies: () => LIBRARY.map((f) => ({ name: f.name, category: f.category, description: f.description, ...(f.markerRole ? { markerRole: f.markerRole } : {}) })),
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
    collab?.client.setSelection(ids);
    // A selected group highlights its members.
    viewport.setSelection(ids.flatMap((id) => (doc.get(id)?.category === Cat.Group ? [id, ...groupMembers(doc, id).map((m) => m.id)] : [id])));
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
    saveViewCamera();
    activeViewId = id;
    const v = activeView();
    if (v?.params.levelId) activeLevelId = v.params.levelId;
    // Switching views clears the selection (Revit does too), so Properties shows the new view.
    selection = [];
    viewport.setSelection([]);
    refreshAll();
  },
  drawSlopeArrow(id) {
    (tools.slopeArrow as SlopeArrowTool).floorId = id;
    setTool("slopeArrow");
  },
  editBoundary(id) {
    const el = doc.require<FloorParams | CeilingParams | RoofParams>(id);
    const name = { [Cat.Ceiling]: "ceiling", [Cat.Roof]: "roof", [Cat.FilledRegion]: "region", [Cat.BuildingPad]: "pad", [Cat.SiteSubregion]: "subregion" }[el.category] ?? "floor";
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
  toposolid: new SketchTool(ctx, "toposolid"),
  pad: new SketchTool(ctx, "pad"),
  subregion: new SketchTool(ctx, "subregion"),
  property: new SketchTool(ctx, "property"),
  text: new TextTool(ctx),
  dimension: new DimensionTool(ctx),
  room: new RoomTool(ctx),
  stair: new StairTool(ctx),
  ramp: new StairTool(ctx, "ramp"),
  column: new ColumnTool(ctx),
  beam: new BeamTool(ctx),
  footing: new FootingTool(ctx),
  demolish: new DemolishTool(ctx),
  railing: new RailingTool(ctx),
  placegroup: new PlaceGroupTool(ctx),
  roomseparator: new RoomSeparatorTool(ctx),
  area: new AreaTool(ctx),
  tag: new TagTool(ctx, "category"),
  keynote: new TagTool(ctx, "keynote"),
  areaboundary: new AreaBoundaryTool(ctx),
  move: new ModifyTool(ctx, "move"),
  copy: new ModifyTool(ctx, "copy"),
  rotate: new ModifyTool(ctx, "rotate"),
  mirror: new ModifyTool(ctx, "mirror"),
  array: new ModifyTool(ctx, "array"),
  align: new AlignTool(ctx),
  offset: new OffsetTool(ctx),
  trim: new TrimTool(ctx),
  split: new SplitTool(ctx),
  symbol: new SymbolTool(ctx),
  detailcomponent: new DetailComponentTool(ctx),
  attach: new AttachTool(ctx),
  slopeArrow: new SlopeArrowTool(ctx),
  "face-wall": new FaceTool(ctx, "wall"),
  "face-curtain": new FaceTool(ctx, "curtain"),
  "face-roof": new FaceTool(ctx, "roof"),
  "face-floor": new FaceTool(ctx, "floor"),
  duct: new RunTool(ctx, "duct"),
  pipe: new RunTool(ctx, "pipe"),
  tray: new ContainmentTool(ctx, "tray"),
  conduit: new ContainmentTool(ctx, "conduit"),
  camera: new CameraTool(ctx, (id) => {
    setTool("select");
    ctx.setActiveView(id);
  }),
  elevation: new ElevationTool(ctx),
};
/** Tools that work in sections/elevations (the rest need a plan or 3D work plane). */
const DRAWING_TOOLS = new Set(["select", "symbol", "detailcomponent", "placegroup", "attach", "move", "copy", "rotate", "mirror", "array", "detailline", "region", "cloud", "text", "tag", "keynote", "extrusion", "blend", "revolution"]);
let tool: Tool = tools.select!;
/** Grips and temporary dimensions for the selection (Select tool only). */
let grips: GripLayer | undefined = new GripLayer(ctx, $("#viewport"));
// Tile / Cascade / Tab Views: every open view in its own live pane; click one to work in it.
let panes: Panes | undefined = new Panes($("#panes"), {
  get doc() {
    return doc;
  },
  mainHost: $("#viewport"),
  activeViewId: () => activeViewId,
  openViews: () => viewBar?.openViews() ?? [],
  activate: (id) => id !== activeViewId && ctx.setActiveView(id),
  closeView: (id) => viewBar?.close(id),
  makeViewport: (container) => new Viewport(container, doc, viewport.geometryKernel),
  configure: (vp, target) => configureViewport(vp, target, false),
  renderSchedule: (container, s) => renderSchedulePane(container, ctx, s as Schedule),
});
$("#sel-filter").onclick = () => openSelectionFilter();
// Drag from the Project Browser: views, legends and schedules onto the open sheet (placed where
// dropped); families into a view (starts placing them, as Revit does).
{
  const host = $("#viewport");
  host.addEventListener("dragover", (ev) => {
    if (!ev.dataTransfer?.types.includes(BROWSER_DRAG)) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "copy";
  });
  host.addEventListener("drop", (ev) => {
    const raw = ev.dataTransfer?.getData(BROWSER_DRAG);
    if (!raw) return;
    ev.preventDefault();
    const { kind, id } = JSON.parse(raw) as { kind: "view" | "family"; id: ElementId };
    const active = activeViewId ? doc.get(activeViewId) : undefined;
    if (kind === "view") {
      if (active?.category !== Cat.Sheet) return status("Open a sheet, then drag views and schedules onto it.");
      const at = viewport.pickDrawing(ev);
      try {
        const vp = doc.transact("Place view on sheet", (tx) => placeView(tx, doc, active.id, id, at ?? undefined));
        ctx.setSelection([vp.id]);
        status(`Placed ${doc.get(id)?.name ?? "the view"} on sheet ${(active as Sheet).params.number}.`);
      } catch (err) {
        status(`⚠ ${(err as Error).message}`);
      }
      return;
    }
    const def = familyDefs(doc).find((d) => d.id === id);
    if (!def) return;
    if (def.params.category === "ViewMarker") return status("View Marker families are chosen in a view's Properties, not placed.");
    if (isDetailFamily(def)) {
      (tools.detailcomponent as DetailComponentTool).familyId = def.id;
      return setTool("detailcomponent");
    }
    if (active?.category === Cat.Sheet) return status("Open a plan or 3D view to place families.");
    activeComponentKey = `${def.id}|${familyTypeNames(def)[0] ?? ""}`;
    setTool("component");
    refreshAll();
  });
}

/** The ribbon: File menu, Quick Access Toolbar, tabs. */
let ribbon: Ribbon | undefined = new Ribbon(
  $("#ribbon"),
  ribbonTabs(
    {
      libraryFamilies: () => LIBRARY.map((f) => ({ name: f.name, category: f.category })),
      loadLibraryFamily: (name) => ctx.loadLibraryFamily(name),
      newSchedule: (category, kind) =>
        edit(kind === "takeoff" ? "New material takeoff" : "New schedule", (tx) => {
          const s = createSchedule(tx, doc, category, { kind });
          queueMicrotask(() => ctx.setActiveView(s.id));
        }),
      cmd: (c) => void commands[c]?.(),
      detailFamilies: () => (tools.detailcomponent as DetailComponentTool).families().map((f) => ({ id: f.id, name: f.name ?? f.id })),
      libraryDetailItems: () => LIBRARY.filter((f) => f.category === "DetailItem").map((f) => f.name),
      placeDetail: (familyId) => {
        (tools.detailcomponent as DetailComponentTool).familyId = familyId;
        setTool("detailcomponent");
      },
      loadDetail: (name) => {
        ctx.loadLibraryFamily(name);
        const def = familyDefs(doc).find((f) => f.name === name);
        if (def) {
          (tools.detailcomponent as DetailComponentTool).familyId = def.id;
          setTool("detailcomponent");
        }
      },
      placeSymbol: (kind) => {
        (tools.symbol as SymbolTool).kind = kind;
        setTool("symbol");
      },
    },
    voidToggle,
  ),
  {
    tool: (name) => setTool(name),
    cmd: (name) => void commands[name]?.(),
    activeTool: () => tool.name,
    fileMenu: () => [
      { label: "New", hint: "Ctrl+N", action: () => void commands.new?.() },
      { label: "Open\u2026", hint: "Ctrl+O", action: () => void commands.open?.() },
      { label: "Save", hint: "Ctrl+S", action: () => void commands.save?.() },
      ...recentMenu(),
      "-",
      { heading: "Export" },
      { label: "PDF (all sheets)\u2026", action: () => void commands.exportPdf?.() },
      { label: "IFC\u2026", action: () => void commands.exportIfc?.() },
      { label: "DXF/DWG (this view)\u2026", action: () => void commands.exportDxf?.() },
      { label: "glTF (.glb)\u2026", action: () => void commands.exportGlb?.() },
      { label: "OBJ\u2026", action: () => void commands.exportObj?.() },
      "-",
      { heading: "Import" },
      { label: "IFC\u2026", action: () => void commands.importIfc?.() },
      { label: "DXF/DWG into this view\u2026", action: () => void commands.importDxf?.() },
      { label: "Link project\u2026", action: () => void commands.linkProject?.() },
      "-",
      { label: "Keyboard Shortcuts\u2026", hint: "KS", action: () => void commands.keyboardShortcuts?.() },
    ],
  },
  [
    { label: "New", icon: "newdoc", cmd: "new", title: "New project (Ctrl+N)" },
    { label: "Open", icon: "open", cmd: "open", title: "Open (Ctrl+O)" },
    { label: "Save", icon: "save", cmd: "save", title: "Save (Ctrl+S)" },
    { label: "Undo", icon: "undo", cmd: "undo", title: "Undo (Ctrl+Z)" },
    { label: "Redo", icon: "redo", cmd: "redo", title: "Redo (Ctrl+Y)" },
    { label: "3D", icon: "view3d", cmd: "view3d", title: "Default 3D view" },
    { label: "Measure: Aligned Dimension", icon: "dimension", tool: "dimension", title: "Aligned dimension" },
  ],
);
/** Open-view tabs and the view control bar under the model window. */
let viewBar: ViewBar | undefined = new ViewBar(
  {
    get doc() {
      return doc;
    },
    viewport,
    activeViewId: () => activeViewId,
    setActiveView: (id) => ctx.setActiveView(id),
    run: (c) => void commands[c]?.(),
    status,
  },
  $("#view-tabs"),
  $("#view-bar"),
);

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
  grips?.setEnabled(tool.name === "select");
  ribbon?.markTool();
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => {
    b.classList.toggle("active", b.dataset.tool === tool.name);
  });
  refreshTypeSelector();
}

const canvas = viewport.renderer.domElement;
let downAt: { x: number; y: number } | null = null;
// Press-drag-release as two clicks, for tools that allow it (sections, grids, callouts).
let dragPlace: { down: PointerEvent; started: boolean } | null = null;
canvas.addEventListener("pointerdown", (ev) => {
  if (ev.button === 0) downAt = { x: ev.clientX, y: ev.clientY };
  dragPlace = ev.button === 0 && tool.dragPlace ? { down: ev, started: false } : null;
  tool.pointerDown?.(ev);
});
// Listen on window so a box-select drag that leaves the canvas still finishes.
window.addEventListener("pointerup", (ev) => {
  if (dragPlace?.started && ev.button === 0) {
    dragPlace = null;
    downAt = null;
    return tool.click?.(ev);
  }
  dragPlace = null;
  tool.pointerUp?.(ev);
  if (ev.button !== 0 || !downAt) return;
  const moved = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y);
  downAt = null;
  if (moved < 5 && ev.target === canvas) tool.click?.(ev);
});
canvas.addEventListener("pointermove", (ev) => {
  if (dragPlace && !dragPlace.started && ev.buttons & 1 && Math.hypot(ev.clientX - dragPlace.down.clientX, ev.clientY - dragPlace.down.clientY) > 8) {
    dragPlace.started = true;
    tool.click?.(dragPlace.down);
  }
  tool.pointerMove?.(ev);
});
// Right-click (without dragging; a right-drag pans or orbits): context menu for what's under the
// cursor, or for the view on empty space.
let rightDown: { x: number; y: number } | null = null;
window.addEventListener("pointerdown", (ev) => {
  if (ev.button === 2) rightDown = { x: ev.clientX, y: ev.clientY };
}, { capture: true });
// Double-click (Revit): a section/elevation/callout marker opens its view, a viewport on a sheet
// opens the view it shows, and a component opens its family for editing.
canvas.addEventListener("dblclick", (ev) => {
  if (tool.name !== "select") return;
  const id = viewport.pick(ev);
  const el = id ? doc.get(id) : undefined;
  if (!el) return;
  if (el.category === Cat.View && el.id !== activeViewId) return ctx.setActiveView(el.id);
  if (el.category === Cat.Viewport) {
    const viewId = (el.params as { viewId?: ElementId }).viewId;
    if (viewId && doc.has(viewId)) return ctx.setActiveView(viewId);
  }
  if (el.category === Cat.FamilyInstance && !projectSession) {
    const familyId = (el.params as { familyId?: ElementId }).familyId;
    if (familyId && doc.has(familyId)) return ctx.editFamily(familyId);
  }
});
canvas.addEventListener("contextmenu", (ev) => {
  ev.preventDefault();
  if (!rightDown || Math.hypot(ev.clientX - rightDown.x, ev.clientY - rightDown.y) > 5) return;
  rightDown = null;
  openCanvasMenu(ev);
});

// ---- commands -------------------------------------------------------------

const commands: Record<string, () => void | Promise<void>> = {
  new() {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    leaveCollab();
    const fresh = new Document();
    applyResidentialTemplate(fresh);
    loadInto(fresh.toJSON(), null);
  },
  async open() {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    leaveCollab();
    try {
      const result = await openProject();
      if (result) {
        loadInto(result.json, result.path);
        if (isTauri()) addRecentFile(result.path);
      }
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
      const def = doc.transact(`Load family ${name}`, (tx) => loadFamily(tx, doc, fam, name));
      activeComponentKey = undefined;
      // A new mass (In-Place Mass) goes where it was modelled: at the origin of the active level.
      if (def.params.category === "Mass" && !doc.byCategory<FamilyInstanceParams>(Cat.FamilyInstance).some((i) => i.params.familyId === def.id)) {
        const inst = doc.transact(`Place ${name}`, (tx) =>
          placeFamilyInstance(tx, doc, def.id, familyTypeNames(def)[0] ?? "Default", { levelId: activeLevelId, position: { x: 0, y: 0 } }),
        );
        viewport.setShowMass(true);
        ctx.setSelection([inst.id]);
        return status(`${name} placed. Show Mass is on (Massing & Site); edit it with Edit family.`);
      }
      status(`Loaded ${name}. ${placeHint(def.params.category)}`);
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
      saveViewCamera();
      const path = await saveProject(doc.toJSON(), filePath);
      if (path) {
        if (isTauri()) addRecentFile(path);
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
  async render() {
    if (viewport.viewMode !== "3d") return status("Render: open a 3D view first.");
    closeRender?.();
    try {
      closeRender = await openRender({
        container: $<HTMLDivElement>("#viewport"),
        viewport,
        doc,
        status,
        savePng: async (bytes) => {
          const path = await saveBytes(bytes, "render.png", { name: "PNG image", extensions: ["png"] }, "image/png");
          if (path) status(`Saved ${path}.`);
        },
      });
    } catch (err) {
      status(`⚠ Render failed: ${(err as Error).message}`);
    }
  },
  nzChecks() {
    const pane = $<HTMLDivElement>("#nz-pane");
    pane.hidden = !pane.hidden;
    if (!pane.hidden) refreshNzChecks();
  },
  collaborate() {
    const pane = $<HTMLDivElement>("#collab-pane");
    pane.hidden = !pane.hidden;
    if (!pane.hidden) renderCollabPane();
  },
  clashes() {
    const pane = $<HTMLDivElement>("#clash-pane");
    pane.hidden = !pane.hidden;
    if (!pane.hidden) renderClashPane();
  },
  console() {
    const c = $<HTMLDivElement>("#console");
    c.hidden = !c.hidden;
    if (!c.hidden) c.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  },
  group() {
    if (!selection.length) return status("Group: select walls, floors, components or rooms (or one view's detail lines, text, symbols, details) first.");
    // All drafting → a detail group. Otherwise a model group: datums, views and annotation are left out.
    const detail = selection.every((id) => DETAIL_GROUPABLE.has(doc.get(id)?.category ?? ""));
    const ids = detail ? selection : selection.filter((id) => GROUPABLE.has(doc.get(id)?.category ?? ""));
    const skipped = selection.length - ids.length;
    if (!ids.length) return status("Group: none of the selection can be grouped (walls, floors, roofs, components, rooms).");
    try {
      const g = doc.transact("Create group", (tx) => createGroup(tx, doc, ids));
      ctx.setSelection([g.id]);
      status(`Created ${doc.get(g.typeId!)?.name}${skipped ? ` (${skipped} element(s) left out)` : ""}. Click a member to select the group; Alt+click for one element.`);
    } catch (err) {
      status(`\u26a0 ${(err as Error).message}`);
    }
  },
  placeGroupCopy() {
    const g = selection.map((id) => doc.get(id)).find((e) => e?.category === Cat.Group);
    if (!g) return status("Select a group first.");
    (tools.placegroup as PlaceGroupTool).source = g.id;
    setTool("placegroup");
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
  async importIfc() {
    if (projectSession) return status("Import IFC: close the family editor first.");
    try {
      const file = await openBytes({ name: "IFC", extensions: ["ifc"] });
      if (!file) return;
      status(`Reading ${file.name}\u2026`);
      // web-ifc (and its wasm) loads on first use.
      const ifc = await import("@open-bim/ifc");
      ifcApi ??= await ifc.createIfcApi(() => ifcWasmUrl);
      const r = await ifc.importIfc(doc, file.bytes, ifcApi);
      status(`Imported ${r.shapes} element(s) from ${file.name}${r.levelsCreated ? `, ${r.levelsCreated} new level(s)` : ""}. Undo removes the import.`);
      viewport.zoomToFit();
    } catch (err) {
      status(`\u26a0 IFC import failed: ${(err as Error).message}`);
    }
  },
  async exportDxf() {
    const v = activeViewId ? doc.get(activeViewId) : undefined;
    if (!v || (v.category === Cat.View && (v.params as ViewParams).kind === "3d")) return status("Export DXF: open a plan, section, elevation, legend or sheet.");
    try {
      const d = v.category === Cat.Sheet ? sheetDrawing(doc, viewport.geometryKernel, v as Sheet) : viewDrawing(doc, viewport.geometryKernel, v as View);
      const name = `${(v.category === Cat.Sheet ? `${(v as Sheet).params.number} ` : "") + (v.name ?? "View")}`.replace(/[\\/:*?"<>|]/g, "-");
      // Plans can go out in shared (map) coordinates when the project's location asks for it.
      const loc = projectSettings(doc)?.params.location;
      const shared = loc?.dxfShared && v.category === Cat.View && isPlanView(v as View) ? loc : undefined;
      const path = await saveCad(drawingDxf(d, doc, { shared }), `${name}.dxf`);
      if (path) status(`Exported to ${path}${v.category === Cat.Sheet ? " (paper mm)" : shared ? ` (EPSG:${shared.epsg}, metres)` : " (project mm)"}`);
    } catch (err) {
      cadError("Export", err);
    }
  },
  async importDxf() {
    const v = activeViewId ? doc.get<ViewParams>(activeViewId) : undefined;
    if (!v || v.category !== Cat.View || v.params.kind === "3d") return status("Import DXF: open a plan, section, elevation or legend first.");
    try {
      const file = await openCad();
      if (!file) return;
      const content = parseDxf(file.dxf);
      const imp = doc.transact(`Import ${file.name}`, (tx) => createCadImport(tx, doc, v.id, content, file.name));
      ctx.setSelection([imp.id]);
      status(`Imported ${content.segments.length / 4} line(s) and ${content.texts.length} text(s) from ${file.name} into ${v.name}. Move it with Offset in Properties.`);
    } catch (err) {
      cadError("Import", err);
    }
  },
  async linkProject() {
    if (projectSession) return status("Link: close the family editor first.");
    try {
      const r = await openProject();
      if (!r) return;
      const link = doc.transact(`Link ${r.path.split(/[\\/]/).pop()}`, (tx) => createLink(tx, r.json, r.path, "shared"));
      ctx.setSelection([link.id]);
      status(`Linked ${link.name} by shared coordinates. Change positioning or offset in Properties.`);
    } catch (err) {
      status(`\u26a0 Link failed: ${(err as Error).message}`);
    }
  },
  async exportGlb() {
    try {
      const name = (filePath?.split(/[\\/]/).pop() ?? "Untitled").replace(/\.obim$/i, "");
      const glb = exportGlb(exportParts(doc, viewport.geometryKernel), projectSettings(doc)?.params.info.name || name);
      const path = await saveBytes(glb, `${name}.glb`, { name: "glTF binary", extensions: ["glb"] }, "model/gltf-binary");
      if (path) status(`glTF exported to ${path}`);
    } catch (err) {
      status(`⚠ glTF export failed: ${(err as Error).message}`);
    }
  },
  async exportObj() {
    try {
      const name = (filePath?.split(/[\\/]/).pop() ?? "Untitled").replace(/\.obim$/i, "");
      const { obj, mtl } = exportObj(exportParts(doc, viewport.geometryKernel), `${name}.mtl`);
      const enc = new TextEncoder();
      const zip = zipStore([
        [`${name}.obj`, enc.encode(obj)],
        [`${name}.mtl`, enc.encode(mtl)],
      ]);
      const path = await saveBytes(zip, `${name}-obj.zip`, { name: "Zip", extensions: ["zip"] }, "application/zip");
      if (path) status(`OBJ + MTL exported to ${path}`);
    } catch (err) {
      status(`⚠ OBJ export failed: ${(err as Error).message}`);
    }
  },
  async exportIfc() {
    if (projectSession) return status("Export IFC: close the family editor first.");
    try {
      const name = (filePath?.split(/[\\/]/).pop() ?? "Untitled").replace(/\.obim$/i, "");
      const text = exportIfc(doc, { kernel: viewport.geometryKernel, fileName: `${name}.ifc` });
      const path = await saveText(text, `${name}.ifc`, { name: "IFC", extensions: ["ifc"] });
      if (path) status(`IFC exported to ${path}`);
    } catch (err) {
      status(`⚠ IFC export failed: ${(err as Error).message}`);
    }
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
  delete() {
    const ids = selection.filter((id) => doc.has(id));
    if (!ids.length) return status("Delete: select something first.");
    edit(`Delete ${ids.length} element(s)`, (tx) => ids.forEach((id) => doc.has(id) && tx.delete(id)));
    ctx.setSelection([]);
  },
  camera: () => setTool("camera"),
  tileViews: () => setPaneLayout("tile"),
  tile2: () => setPaneLayout("tile", 2),
  tile3: () => setPaneLayout("tile", 3),
  tile4: () => setPaneLayout("tile", 4),
  cascadeViews: () => setPaneLayout("cascade"),
  tabViews: () => setPaneLayout("tab"),
  keyboardShortcuts: () => openShortcutEditor(() => (shortcuts = shortcutTable())),
  view3d() {
    const v = views(doc).find((x) => x.params.kind === "3d");
    if (v) ctx.setActiveView(v.id);
    else status("\u26a0 No 3D view in this project");
  },
  viewPlan() {
    const v = floorPlanFor(doc, activeLevelId);
    if (v) ctx.setActiveView(v.id);
    else status("\u26a0 No floor plan for this level");
  },
  importKeynotes: () => ctx.importKeynotes(),
  exportKeynotes: () => ctx.exportKeynotes(),
  loadFamilyFile: () => ctx.loadFamilyFile(),
  newSheet() {
    edit("Create sheet", (tx) => {
      const s = createSheet(tx, doc);
      queueMicrotask(() => ctx.setActiveView(s.id));
    });
  },
  newLegend() {
    edit("New legend", (tx) => {
      const v = createLegend(tx, doc);
      queueMicrotask(() => ctx.setActiveView(v.id));
    });
  },
  newRevision() {
    edit("New revision", (tx) => {
      const r = createRevision(tx, doc, { date: new Date().toISOString().slice(0, 10) });
      queueMicrotask(() => ctx.setSelection([r.id]));
    });
    status("New revision: edit it in Properties (Project Browser \u2192 Revisions lists them).");
  },
  showMass() {
    viewport.setShowMass(!viewport.showMass);
    ribbon?.markTool();
    status(viewport.showMass ? "Show Mass on: conceptual masses show in every view." : "Show Mass off.");
  },
  inPlaceMass() {
    // Revit's In-Place Mass: a new mass family, placed where it was modelled when you finish.
    viewport.setShowMass(true);
    ctx.newFamily("Mass");
    status("In-Place Mass: model it with Extrusion / Blend / Revolve / Sweep, then Load into Project to place it.");
  },
  placeMass() {
    viewport.setShowMass(true);
    let def = familyDefs(doc).find((f) => f.params.category === "Mass");
    if (!def) {
      ctx.loadLibraryFamily("Mass - Box");
      def = familyDefs(doc).find((f) => f.params.category === "Mass");
    }
    if (!def) return;
    activeComponentKey = `${def.id}|${familyTypeNames(def)[0] ?? ""}`;
    setTool("component");
    refreshAll();
  },
  propertyFromBearings() {
    // Revit: Property Line → Create by entering distances and bearings. Start from a 20 × 30 m lot.
    const legs = [
      { bearing: 0, distance: 30000 },
      { bearing: 90, distance: 20000 },
      { bearing: 180, distance: 30000 },
      { bearing: 270, distance: 20000 },
    ];
    let id: ElementId | undefined;
    edit("Property line from bearings", (tx) => (id = createPropertyLine(tx, pointsFromLegs(doc, { x: 0, y: 0 }, legs)).id));
    if (id) ctx.setSelection([id]);
    status("Property line: type the bearings and distances from the survey plan in Properties.");
  },
  siteComponent: () => placeFromCategory("Site", "Tree - Deciduous"),
  placeAirTerminal: () => placeFromCategory("AirTerminal", "Supply Diffuser - Square"),
  placeElectricalFixture() {
    if (!familyDefs(doc).some((f) => f.params.category === "ElectricalFixture")) for (const n of ["Power Outlet - Double", "Switch - Light"]) ctx.loadLibraryFamily(n);
    placeFromCategory("ElectricalFixture", "Power Outlet - Double");
  },
  placeLightingFixture: () => placeFromCategory("LightingFixture", "Light - LED Downlight"),
  placeSwitchboard: () => placeFromCategory("ElectricalEquipment", "Switchboard - Residential"),
  placePlumbingFixture() {
    if (!familyDefs(doc).some((f) => f.params.category === "PlumbingFixture")) {
      for (const n of ["WC - Close Coupled", "Basin - Wall Hung", "Shower - Tray", "Bath - Built In", "Sink - Kitchen", "Tub - Laundry", "Hot Water Cylinder"]) ctx.loadLibraryFamily(n);
    }
    placeFromCategory("PlumbingFixture", "WC - Close Coupled");
    status("Plumbing Fixture: pick the fixture in the type selector, click to place (Space turns it). Waste and supply connectors are on each.");
  },
  placeMechanicalEquipment: () => placeFromCategory("MechanicalEquipment", "Ducted Heat Pump - Indoor Unit"),
  parkingComponent: () => placeFromCategory("Parking", "Parking Space"),
  gradedRegion() {
    const t = selection.map((id) => doc.get(id)).find((e) => e?.category === Cat.Toposolid);
    if (!t) return status("Graded Region: select a toposolid first.");
    edit("Graded region", (tx) => recordExistingGround(tx, doc, t.id));
    status("Graded Region: the ground as it is now is the existing ground. Edit spot heights or add pads; cut and fill show in Properties.");
  },
  manageLevels: () => openManage("levels"),
  manageMaterials: () => openMaterialBrowser(doc, status),
  manageParameters: () => openManage("parameters"),
  manageDesignOptions: () => openManage("designOptions"),
  manageRevisions: () => openManage("revisions"),
  manageFilters: () => openManage("filters"),
  systemBrowser: () => openManage("systems"),
  manageStatistics: () => openManage("statistics"),
  newOptionSet() {
    edit("New option set", (tx) => {
      let name = "Option Set 1";
      for (let i = 2; optionSets(doc).some((s) => s.name === name); i++) name = `Option Set ${i}`;
      createOptionSet(tx, doc, name);
    });
    status("New design option set: see Project Browser \u2192 Design Options.");
  },
  projectInfo() {
    let id = projectSettings(doc)?.id;
    if (!id) id = doc.transact("Create project settings", (tx) => ensureProjectSettings(tx, doc)).id;
    ctx.setSelection([id]);
  },
  findReplace: () => openFindReplace(textHost),
  checkSpelling: () => openSpelling(textHost),
  resetLayout: () => docking.reset(),
  attachTop: () => startAttach("top"),
  attachBase: () => startAttach("base"),
  visibilityGraphics() {
    const v = activeView();
    if (!v || v.category !== Cat.View) return status("Visibility/Graphics: open a view first (not a sheet or schedule).");
    vgDialog?.close();
    vgDialog = openDialog(`Visibility/Graphics \u2014 ${v.name ?? "view"}`, () => viewGraphicsEditor(ctx, v.id), () => (vgDialog = null));
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
  viewBar?.render();
  status(viewport.visibility.active ? `${message} \u00b7 temporary hide/isolate is on (U to reset)` : message);
}

/** File menu: recently opened or saved projects (desktop, where files can be reopened by path). */
function recentMenu(): MenuItem[] {
  const list = isTauri() ? recentFiles() : [];
  if (!list.length) return [];
  return [
    "-",
    { heading: "Recent" },
    ...list.map(
      (path): MenuItem => ({
        label: fileName(path),
        hint: path.length > 48 ? `…${path.slice(-46)}` : path,
        action: () => void openRecent(path),
      }),
    ),
  ];
}

async function openRecent(path: string): Promise<void> {
  if (dirty && !confirm("Discard unsaved changes?")) return;
  leaveCollab();
  try {
    const json = await readProjectAt(path);
    if (!json) return;
    loadInto(json, path);
    addRecentFile(path);
  } catch (err) {
    removeRecentFile(path);
    status(`⚠ Could not open ${fileName(path)}: ${(err as Error).message}`);
  }
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
/** The camera last put on screen for a 3D view (so orbiting isn't undone by redraws). */
let appliedCamera: { viewId: ElementId; json: string } | null = null;

/** Remember the open 3D view's camera in the view (not an undo step). */
function saveViewCamera(): void {
  const v = activeView();
  if (!v || v.params.kind !== "3d" || viewport.viewMode !== "3d") return;
  const cam = viewport.getCamera3d();
  const json = JSON.stringify(cam);
  if (JSON.stringify(v.params.camera ?? null) === json) return;
  appliedCamera = { viewId: v.id, json };
  doc.transact("Save view camera", (tx) => tx.update<ViewParams>(v.id, { camera: cam }), { undoable: false });
}

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
  if (!active || (active.category !== Cat.Sheet && active.category !== Cat.View)) {
    activeViewId = views(doc).find((v) => v.params.kind === "3d")?.id ?? views(doc)[0]?.id;
  }
  const target = activeViewId ? doc.get(activeViewId) : undefined;
  if (!target) return viewport.setViewMode("3d");
  configureViewport(viewport, target, true);
  if (target.category === Cat.Sheet) {
    if (!DRAWING_TOOLS.has(tool.name)) setTool("select");
    return;
  }
  if (viewport.viewMode === "drawing" && !DRAWING_TOOLS.has(tool.name)) setTool("select");
}

/**
 * Set a viewport up to show a view or sheet: mode, plan range or drawing, visual style, sun,
 * V/G and detail level. `primary` is the interactive pane (it restores saved 3D cameras once per
 * view); tiled panes always take the view's saved camera.
 */
function configureViewport(vp: Viewport, target: ModelElement, primary: boolean): void {
  if (target.category === Cat.Sheet) {
    vp.setSheet(target as Sheet);
    vp.setGraphicsResolver(() => defaultGraphics());
    vp.setAnnotationView(target.id);
    vp.setPlanLevel(undefined);
    return;
  }
  const v = target as View;
  // Visual style: 3D views default to Shaded, plans to Hidden Line (line work only).
  const planLike = v.params.kind === "floorPlan" || v.params.kind === "callout" || v.params.kind === "areaPlan";
  vp.setVisualStyle(v.params.kind === "3d" ? (v.params.visualStyle ?? "shaded") : v.params.kind === "legend" ? "hiddenLine" : (v.params.visualStyle ?? "hiddenLine"));
  // Sun, shadows and lighting (any model view): the true sun for the site, at the view's date and time.
  if (v.params.kind !== "legend") vp.setSun(viewSun(doc, v.params), !!v.params.shadows, v.params.lighting ?? {});
  else vp.setSun(null, false);
  if (isPlanView(v)) {
    vp.setPlanRange(viewRange(doc, v));
    vp.setViewMode("plan");
    vp.setPlanCrop(v.params.kind === "callout" ? (v.params.crop ?? null) : null);
  } else if (is2DView(v)) {
    vp.setDrawingView(v);
  } else {
    vp.setViewMode("3d");
    // Each 3D view keeps its own camera: restore it on opening (or when its saved camera changes).
    if (primary) {
      const json = JSON.stringify(v.params.camera ?? null);
      if (v.params.camera && (appliedCamera?.viewId !== v.id || appliedCamera.json !== json)) vp.setCamera3d(v.params.camera);
      appliedCamera = { viewId: v.id, json };
    }
  }
  // Visibility/Graphics: the view's own settings, or its template's.
  const g = effectiveGraphics(doc, v);
  vp.setGraphicsResolver((el) => elementGraphics(doc, g, el));
  vp.setAnnotationView(v.id);
  // Rooms show in floor plans and callouts of their level (area plans show areas instead).
  vp.setPlanLevel(vp.viewMode === "plan" && v.params.kind !== "areaPlan" ? (v.params.levelId ?? undefined) : undefined);
  vp.setViewGraphics({ detailLevel: g.detailLevel, scale: g.scale });
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
  if (mod && ev.key.toLowerCase() === "g") return run(ev, "group");
  if (ev.key === "`") return run(ev, "console");
  if (ev.key === "F9") return run(ev, "systemBrowser");
  if (mod) return;
  // Arrow keys nudge the selection (plans, sections, sheets); Shift nudges ten times further.
  if (ev.key.startsWith("Arrow") && tool.name === "select" && selection.length && viewport.viewMode !== "3d") {
    ev.preventDefault();
    return nudge(ev.key, ev.shiftKey);
  }
  // Keyboard shortcuts (editable: KS). Two-letter ones (MV, CO…) take over from the first letter's tool.
  const k = ev.key.length === 1 ? ev.key.toUpperCase() : "";
  const pair = k && lastKey && ev.timeStamp - lastKey.at < 1000 ? lastKey.key + k : "";
  lastKey = k ? { key: k, at: ev.timeStamp } : null;
  const runShortcut = (a: string) => {
    ev.preventDefault();
    return a.startsWith("cmd:") ? void commands[a.slice(4)]?.() : setTool(a.slice(5));
  };
  const two = pair ? shortcuts.get(pair) : undefined;
  if (two) {
    lastKey = null;
    // A command (e.g. WT) shouldn't leave the first letter's tool (W = wall) running.
    if (two.startsWith("cmd:") && tool.name !== "select") setTool("select");
    return runShortcut(two);
  }
  if (tool.key?.(ev)) return ev.preventDefault();
  if (ev.key === "Escape") return setTool("select");
  const one = k ? shortcuts.get(ev.shiftKey ? `Shift+${k}` : k) : undefined;
  if (one) return runShortcut(one);
});

let shortcuts = shortcutTable();
let lastKey: { key: string; at: number } | null = null;

/** Options strip for the active tool (Copy, Disjoin, Number…), over the top of the view. */
function renderToolOptions(options: ToolOption[] | null): void {
  const bar = $<HTMLDivElement>("#tool-options");
  bar.hidden = !options?.length;
  bar.replaceChildren(
    ...(options ?? []).map((o) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      if (o.kind === "select") {
        const sel = document.createElement("select");
        for (const opt of o.options) sel.append(new Option(opt.label, opt.value, false, opt.value === o.value));
        sel.onchange = () => o.set(sel.value);
        label.append(`${o.label} `, sel);
        return label;
      }
      if (o.kind === "check") {
        input.type = "checkbox";
        input.checked = o.value;
        input.onchange = () => o.set(input.checked);
        label.append(input, ` ${o.label}`);
      } else {
        input.type = "number";
        if (Number.isFinite(o.min)) input.min = String(o.min);
        input.value = String(o.value);
        input.onchange = () => o.set(Number(input.value));
        label.append(`${o.label} `, input);
      }
      return label;
    }),
  );
}

let vgDialog: { refresh(): void; close(): void } | null = null;

/** Attach Top/Base for the selected walls: pick the target next. */
function startAttach(end: "top" | "base"): void {
  (tools.attach as AttachTool).end = end;
  setTool("attach");
}

const textHost = {
  get doc() {
    return doc;
  },
  activeViewId: () => activeViewId,
  setActiveView: (id: ElementId) => ctx.setActiveView(id),
  setSelection: (ids: ElementId[]) => ctx.setSelection(ids),
  status,
};

/** "Walls", "Doors"… for the ribbon's Modify | <category> label; "Multi-Select" when mixed. */
function contextLabel(): string | null {
  const cats = [...new Set(selection.map((id) => doc.get(id)?.category).filter((c): c is string => !!c))];
  if (!cats.length) return null;
  if (cats.length > 1) return "Multi-Select";
  const c = cats[0]!;
  return c.endsWith("y") ? `${c.slice(0, -1)}ies` : c.endsWith("s") ? c : `${c}s`;
}

/** Elements like `el`: same type (or family type), else same category. */
function similar(el: ModelElement): ModelElement[] {
  const fam = (e: ModelElement) => (e.params as { familyId?: unknown; typeName?: unknown });
  return doc.all().filter((e) => {
    if (e.category !== el.category) return false;
    if (el.typeId) return e.typeId === el.typeId;
    if (el.category === Cat.FamilyInstance) return fam(e).familyId === fam(el).familyId && fam(e).typeName === fam(el).typeName;
    return true;
  });
}

function openCanvasMenu(ev: MouseEvent): void {
  const items: MenuItem[] = [];
  if (tool.name !== "select") items.push({ label: "Cancel", hint: "Esc", action: () => setTool("select") }, "-");
  let id = viewport.pick(ev);
  const hit = id ? doc.get(id) : undefined;
  const g = hit && groupOf(hit);
  if (g && doc.has(g)) id = g;
  const hiddenHit = id && viewport.revealing ? doc.get(id) : undefined;
  if (hiddenHit && viewport.isHidden(hiddenHit)) {
    // Reveal Hidden mode: bring a hidden element (or its whole category) back.
    const el = hiddenHit;
    items.push(
      { heading: `Hidden ${el.category}` },
      { label: "Unhide Element", action: () => unhide(el, false) },
      { label: `Unhide Category (${el.category})`, action: () => unhide(el, true) },
    );
    return showContextMenu(ev.clientX, ev.clientY, items);
  }
  if (id && tool.name === "select") {
    if (!selection.includes(id)) ctx.setSelection([id]);
    const el = doc.require(id);
    const type = el.typeId ? doc.get(el.typeId) : undefined;
    const many = selection.length > 1;
    const walls = selection.map((s) => doc.get(s)).filter((e): e is ModelElement => e?.category === Cat.Wall);
    const menuPoint = viewport.viewMode === "drawing" ? null : viewport.pickPlane(ev, 0);
    items.push(
      { heading: many ? `${selection.length} elements` : `${el.category}${type?.name ? `: ${type.name}` : el.name ? `: ${el.name}` : ""}` },
      { label: "Move", hint: "MV", action: () => setTool("move") },
      { label: "Copy", hint: "CO", action: () => setTool("copy") },
      { label: "Rotate", hint: "RO", action: () => setTool("rotate") },
      { label: "Mirror", hint: "MM", action: () => setTool("mirror") },
      { label: "Array", hint: "AR", action: () => setTool("array") },
    );
    // MEP: put the selection in a system (Revit: Create Duct/Piping/Power System), or an existing one.
    const conns = selection.map((s) => doc.get(s)).filter((e): e is ModelElement => !!e).map((e) => connectableClassifications(doc, e));
    const common = conns.length && conns.every((c) => c.length) ? SYSTEM_CLASSIFICATIONS.filter((c) => conns.every((list) => list.includes(c.value))) : [];
    const boards = panels(doc);
    for (const c of common) {
      if (c.domain === "electrical" && boards.length && !selection.some((id) => boards.some((b) => b.id === id))) {
        for (const b of boards) {
          const bname = b.name ?? doc.get((b.params as { familyId?: ElementId }).familyId ?? "")?.name ?? "switchboard";
          items.push({
            label: `Create ${c.label.toLowerCase()} circuit on ${bname}`,
            action: () => {
              let id: ElementId | undefined;
              edit(`Create ${c.label.toLowerCase()} circuit`, (tx) => (id = createCircuit(tx, doc, b.id, selection, c.value).id));
              if (id) ctx.setSelection([id]);
            },
          });
        }
        continue;
      }
      items.push({
        label: `Create ${c.label.toLowerCase()} system`,
        action: () => {
          let id: ElementId | undefined;
          edit(`Create ${c.label.toLowerCase()} system`, (tx) => (id = createSystem(tx, doc, c.value, selection).id));
          if (id) ctx.setSelection([id]);
        },
      });
      for (const s of mepSystems(doc).filter((x) => x.params.classification === c.value)) {
        if (selection.every((id) => s.params.memberIds.includes(id))) continue;
        items.push({ label: `Add to ${s.name}`, action: () => edit(`Add to ${s.name}`, (tx) => addToSystem(tx, doc, s.id, selection.filter((id) => !s.params.memberIds.includes(id)))) });
      }
    }
    if (walls.length) {
      items.push(
        { label: "Attach Top", action: () => startAttach("top") },
        { label: "Attach Base", action: () => startAttach("base") },
      );
      const attached = walls.filter((w) => (w.params as { topAttachId?: unknown; baseAttachId?: unknown }).topAttachId || (w.params as { baseAttachId?: unknown }).baseAttachId);
      if (attached.length) {
        items.push({
          label: "Detach Top/Base",
          action: () => edit("Detach", (tx) => attached.forEach((w) => (detachWall(tx, doc, w.id, "top"), detachWall(tx, doc, w.id, "base")))),
        });
      }
      // Disallow/Allow Join at the wall end nearest where the menu was opened.
      if (walls.length === 1 && menuPoint) {
        const w = walls[0]!.params as WallParams;
        const end = Math.hypot(w.start.x - menuPoint.x, w.start.y - menuPoint.y) <= Math.hypot(w.end.x - menuPoint.x, w.end.y - menuPoint.y) ? "start" : "end";
        const off = !!w.disallowJoin?.[end];
        items.push({
          label: off ? "Allow Join (this end)" : "Disallow Join (this end)",
          action: () => edit(off ? "Allow join" : "Disallow join", (tx) => tx.update<WallParams>(walls[0]!.id, { disallowJoin: { ...w.disallowJoin, [end]: !off } })),
        });
      }
      items.push({
        label: walls.length > 1 ? `Flip ${walls.length} walls` : "Flip orientation",
        action: () => edit(`Flip wall${walls.length > 1 ? "s" : ""}`, (tx) => walls.forEach((w) => flipWall(tx, doc, w.id))),
      });
    }
    items.push("-");
    if (type && !many) items.push({ label: "Edit Type", action: () => ctx.setSelection([type.id]) });
    items.push(
      {
        label: "Select All Instances: Visible in View",
        action: () => {
          const ids = similar(el).filter((e) => viewport.isVisible(e.id)).map((e) => e.id);
          ctx.setSelection(ids);
          status(`${ids.length} selected (visible in this view)`);
        },
      },
      {
        label: "Select All Instances: In Entire Project",
        action: () => {
          const ids = similar(el).map((e) => e.id);
          ctx.setSelection(ids);
          status(`${ids.length} selected in the project`);
        },
      },
      "-",
      { label: "Hide Element", hint: "H", action: () => void commands.hide?.() },
      { label: "Hide Category", hint: "\u21e7H", action: () => void commands.hideCategory?.() },
      { label: "Isolate Element", hint: "I", action: () => void commands.isolate?.() },
      "-",
      { heading: "Override Graphics in View" },
      { label: "By Element…", action: () => overrideGraphics("element") },
      { label: "By Category…", action: () => overrideGraphics("category") },
      { label: "By Filter…", action: () => void commands.visibilityGraphics?.() },
      "-",
      { label: "Visibility/Graphics\u2026", hint: "VV", action: () => void commands.visibilityGraphics?.() },
      "-",
      { label: "Group", hint: "Ctrl+G", action: () => void commands.group?.() },
      {
        label: "Delete",
        hint: "Del",
        action: () => {
          const ids = [...selection];
          edit(`Delete ${ids.length} element(s)`, (tx) => ids.forEach((d) => doc.has(d) && tx.delete(d)));
          ctx.setSelection([]);
        },
      },
    );
  } else {
    items.push(
      { label: "Visibility/Graphics\u2026", hint: "VV", action: () => void commands.visibilityGraphics?.() },
      { label: "Zoom to Fit", hint: "F", action: () => void commands.fit?.() },
      { label: "Reset Temporary Hide/Isolate", hint: "U", action: () => void commands.resetVisibility?.() },
      { label: "Reset Panel Layout", action: () => docking.reset() },
    );
    if (selection.length) items.push({ label: "Deselect All", action: () => ctx.setSelection([]) });
  }
  showContextMenu(ev.clientX, ev.clientY, items);
}

/**
 * Unhide an element, or its whole category: lifts temporary hide/isolate and, for a category the
 * view (or its template) hides in Visibility/Graphics, turns it back on there.
 */
function unhide(el: ModelElement, category: boolean): void {
  if (category) viewport.visibility.unhideCategories([el.category]);
  viewport.visibility.unhide([el.id]);
  const v = activeView();
  if (category && v?.category === Cat.View) {
    const owner = v.params.templateId && doc.has(v.params.templateId) ? doc.require<{ hiddenCategories: string[] }>(v.params.templateId) : v;
    const hidden = (owner.params as { hiddenCategories: string[] }).hiddenCategories ?? [];
    if (hidden.includes(el.category)) {
      edit(`Unhide ${el.category}`, (tx) => tx.update(owner.id, { hiddenCategories: hidden.filter((c) => c !== el.category) }));
    }
  }
  afterVisibility(category ? `${el.category} unhidden` : "Element unhidden");
  if (viewport.isHidden(el)) status(`⚠ Still hidden by Visibility/Graphics (its category, a filter or the phase). Try Unhide Category, or VV.`);
}

/** Nudge distance for the zoom: about three screen pixels, rounded to 1, 2 or 5 × 10ⁿ mm. */
function nudgeStep(): number {
  const raw = Math.max(1, viewport.mmPerPixel() * 3);
  const p = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 5, 10].map((m) => m * p).find((v) => v >= raw) ?? raw);
}

function nudge(key: string, far: boolean): void {
  const d = nudgeStep() * (far ? 10 : 1);
  const move = { ArrowLeft: { x: -d, y: 0 }, ArrowRight: { x: d, y: 0 }, ArrowUp: { x: 0, y: d }, ArrowDown: { x: 0, y: -d } }[key];
  if (!move) return;
  const ids = selection.filter((id) => doc.has(id));
  try {
    doc.transact("Nudge", (tx) => transformElements(tx, doc, ids, translation(move)));
    status(`Nudged ${d} mm${far ? "" : " (Shift + arrow nudges ×10)"}.`);
  } catch (e) {
    status(`⚠ ${(e as Error).message}`);
  }
}

/** Override Graphics in View for the selection (By Element) or its category (By Category). */
function overrideGraphics(kind: "element" | "category"): void {
  const v = activeView();
  if (!v || v.category !== Cat.View) return status("Override Graphics: open a view first (not a sheet or schedule).");
  const ids = selection.filter((id) => doc.has(id));
  if (!ids.length) return status("Override Graphics: select something first.");
  const category = doc.require(ids[0]!).category;
  openOverrideDialog(doc, kind === "element" ? { kind, viewId: v.id, ids } : { kind, viewId: v.id, category }, status);
}

/** Run a model change, reporting errors in the status bar. */
function edit(name: string, fn: Parameters<Document["transact"]>[1]): void {
  try {
    doc.transact(name, fn);
  } catch (e) {
    status(`\u26a0 ${(e as Error).message}`);
  }
}

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
  if (tool.name === "detailcomponent") {
    const dt = tools.detailcomponent as DetailComponentTool;
    const fams = dt.families();
    label.textContent = "Detail item";
    sel.disabled = !fams.length;
    sel.replaceChildren(...fams.map((f) => new Option(f.name ?? f.id, f.id, false, f.id === (dt.familyId ?? fams[0]?.id))));
    sel.onchange = () => {
      dt.familyId = sel.value;
      dt.activate();
    };
    return;
  }
  if (tool.name === "component") {
    // Component: every loaded family's types, "Family : Type".
    const current = ctx.activeComponent();
    const opts = familyDefs(doc)
      .filter((d) => !isDetailFamily(d))
      .flatMap((d) => familyTypeNames(d).map((t) => ({ key: `${d.id}|${t}`, label: `${d.name} : ${t}` })));
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

/** Status bar selection count (Revit's funnel): click to filter the selection by category. */
function refreshSelectionFilter(): void {
  const b = $<HTMLButtonElement>("#sel-filter");
  b.hidden = selection.length === 0;
  b.textContent = `⧩ ${selection.length}`;
}

function openSelectionFilter(): void {
  const byCat = new Map<string, ElementId[]>();
  for (const id of selection) {
    const el = doc.get(id);
    if (el) byCat.set(el.category, [...(byCat.get(el.category) ?? []), id]);
  }
  const keep = new Set(byCat.keys());
  const render = () => {
    const box = document.createElement("div");
    const list = document.createElement("div");
    list.className = "sel-filter-list";
    for (const [cat, ids] of [...byCat].sort((a, b) => a[0].localeCompare(b[0]))) {
      const cb = Object.assign(document.createElement("input"), { type: "checkbox", checked: keep.has(cat) });
      cb.onchange = () => (cb.checked ? keep.add(cat) : keep.delete(cat));
      list.append(cb, Object.assign(document.createElement("span"), { textContent: cat }), Object.assign(document.createElement("span"), { className: "muted", textContent: String(ids.length) }));
    }
    const all = Object.assign(document.createElement("button"), { textContent: "Check all" });
    all.onclick = () => (byCat.forEach((_, c) => keep.add(c)), dlg.refresh());
    const none = Object.assign(document.createElement("button"), { textContent: "Check none" });
    none.onclick = () => (keep.clear(), dlg.refresh());
    const ok = Object.assign(document.createElement("button"), { textContent: "OK", className: "primary" });
    ok.onclick = () => {
      ctx.setSelection([...byCat].filter(([c]) => keep.has(c)).flatMap(([, ids]) => ids));
      dlg.close();
    };
    const buttons = document.createElement("div");
    buttons.className = "buttons";
    buttons.style.marginTop = "10px";
    buttons.append(all, none, ok);
    box.append(list, buttons);
    return box;
  };
  const dlg = openDialog("Filter", render);
}

function refreshPanels(): void {
  refreshSelectionFilter();
  grips?.refresh();
  ribbon?.setContext(contextLabel());
  vgDialog?.refresh();
  refreshTypeSelector();
  renderBrowser($("#browser-body"), ctx);
  makeCollapsible($("#browser-body"));
  viewBar?.render();
  renderProperties($("#properties-body"), ctx);
  makeCollapsible($("#properties-body"), "p:");
  const active = activeViewId ? doc.get(activeViewId) : undefined;
  if (active?.category === Cat.Schedule) renderSchedulePane($("#schedule-pane"), ctx, active as Schedule);
}

/** Place a family of a category (loading the library one if the project has none). */
function placeFromCategory(category: string, libraryName: string): void {
  let def = familyDefs(doc).find((f) => f.params.category === category);
  if (!def) {
    ctx.loadLibraryFamily(libraryName);
    def = familyDefs(doc).find((f) => f.params.category === category);
  }
  if (!def) return;
  activeComponentKey = `${def.id}|${familyTypeNames(def)[0] ?? ""}`;
  setTool("component");
  refreshAll();
}

/** A project settings section (Revit's Manage tab dialogs), live while open. */
function openManage(key: string): void {
  let dlg: { refresh(): void; close(): void } | null = null;
  const off = doc.on(() => dlg?.refresh());
  dlg = openDialog(MANAGE_SECTIONS[key] ?? key, () => {
    const box = projectSection(ctx, key);
    box.classList.add("manage-dialog");
    return box;
  }, () => off());
}

function setPaneLayout(layout: PaneLayout, count?: number): void {
  if (!panes) return;
  if (layout !== "tab" && (viewBar?.openViews().length ?? 0) < 2) status("Open two or more views (they show as tabs below the view), then tile them.");
  panes.setLayout(layout, count);
}

function refreshAll(): void {
  if (!doc.has(activeLevelId)) activeLevelId = levels(doc)[0]?.id ?? "";
  refreshToolbar();
  refreshPanels();
  panes?.refresh();
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
    refreshNzChecks();
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
  ribbon?.setMode(!!familyInfo(doc));
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
  const cat = familyInfo(fam)?.params.category;
  status(
    cat === "DetailItem" || cat === "ViewMarker"
      ? `Family editor: ${familyName(fam)}. Draw with Annotate → Detail Line, Region and Text${cat === "ViewMarker" ? " (paper mm; {n}, {name}, {sheet} in text)" : " (full size)"}.`
      : `Family editor: ${familyName(fam)}. Sketch forms with Extrusion / Blend / Revolve / Sweep; set parameters and types in Properties.`,
  );
}

/** Where a newly loaded family gets used. */
function placeHint(category: string): string {
  if (category === "DetailItem") return "Place it with Annotate → Detail → Component.";
  if (category === "ViewMarker") return "Pick it in a section's, elevation's or callout's Properties.";
  return "Place it with the Component tool (C).";
}

let stopFlex: () => void = () => {};

/** Load (or reload, by name) a family document into the open project. */
function loadFamilyIntoProject(fam: Document, name: string): void {
  if (projectSession) return status("Finish the open family first (Load into Project or Close Family).");
  try {
    const reload = familyDefs(doc).some((f) => f.name === name);
    const def = doc.transact(`${reload ? "Reload" : "Load"} family ${name}`, (tx) => loadFamily(tx, doc, fam, name));
    if (def.params.category !== "DetailItem" && def.params.category !== "ViewMarker") activeComponentKey = `${def.id}|${familyTypeNames(def)[0] ?? ""}`;
    status(`${reload ? "Reloaded" : "Loaded"} ${name}. ${placeHint(def.params.category)}`);
  } catch (err) {
    status(`⚠ ${(err as Error).message}`);
  }
}

/** Survey CSV (E, N, RL in metres) into a toposolid's spot heights, via shared coordinates. */
async function importSurveyPoints(id: ElementId): Promise<void> {
  const t = doc.get<ToposolidParams>(id);
  if (!t) return;
  try {
    const text = await openText({ name: "Survey points (CSV)", extensions: ["csv", "txt"] });
    if (!text) return;
    const pts = parseSurveyCsv(doc, text, t.params.levelId);
    if (!pts.length) throw new Error("No E, N, RL rows found");
    doc.transact("Import survey points", (tx) => tx.update<ToposolidParams>(id, { points: [...t.params.points, ...pts] }));
    status(`Added ${pts.length} survey point(s). Points outside the boundary only shape its edges.`);
  } catch (err) {
    status(`\u26a0 Survey import failed: ${(err as Error).message}`);
  }
}

let closeRender: (() => void) | undefined;

/** CAD import/export errors; a missing DWG converter asks for its path. */
function cadError(what: "Import" | "Export", err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  status(`⚠ ${what} failed: ${msg}`);
  if (/No DWG converter|Converter not found/.test(msg)) {
    const path = prompt("Path to ODAFileConverter.exe (or LibreDWG's dwg2dxf), then try again:", dwgConverterPath() ?? "");
    if (path !== null) setDwgConverterPath(path);
  }
}

function refreshNzChecks(): void {
  const pane = $<HTMLDivElement>("#nz-pane");
  if (!pane.hidden) renderNzChecks(pane, { doc, select: (ids) => ctx.setSelection(ids) });
}

// ---- multi-user editing -------------------------------------------------------------

const COLLAB_STORE = "open-bim.collab";
const PEER_COLOURS = ["#e8590c", "#2f9e44", "#1971c2", "#ae3ec9", "#f08c00", "#0c8599", "#c2255c"];
let collab: { client: SyncClient; binding: Binding; room: string } | null = null;
type CollabSettings = { server: string; room: string; token: string; name: string };

function collabSettings(): CollabSettings {
  let saved: Partial<CollabSettings> = {};
  try {
    saved = JSON.parse(localStorage.getItem(COLLAB_STORE) ?? "{}") as Partial<CollabSettings>;
  } catch {
    /* no saved settings */
  }
  return { server: "ws://localhost:4455", room: "", token: "", name: "", ...saved };
}

function leaveCollab(): void {
  if (!collab) return;
  collab.binding.destroy();
  collab.client.close();
  collab = null;
  status("Left the shared session. The model stays open as a local copy.");
  if (!$<HTMLDivElement>("#collab-pane").hidden) renderCollabPane();
}

/** Share the open project into an empty room, or join a room's model (replacing the open one). */
async function startCollab(mode: "share" | "join", s: CollabSettings): Promise<void> {
  leaveCollab();
  if (!s.room.trim() || !s.name.trim()) return status("Collaborate: enter a project name and your name.");
  if (projectSession) return status("Collaborate: close the family editor first.");
  if (mode === "join" && dirty && !confirm("Joining replaces the open model. Discard unsaved changes?")) return;
  try {
    localStorage.setItem(COLLAB_STORE, JSON.stringify(s));
  } catch {
    /* settings just aren't remembered */
  }
  const ydoc = newYDoc();
  const colour = PEER_COLOURS[Math.floor(Math.random() * PEER_COLOURS.length)]!;
  const client = new SyncClient(ydoc, s.server.trim(), s.room.trim(), { token: s.token || undefined, user: { name: s.name.trim(), colour } });
  status(`Connecting to ${s.server}\u2026`);
  try {
    await Promise.race([client.synced, new Promise((_, rej) => setTimeout(() => rej(new Error("no answer from the server")), 10000))]);
  } catch (err) {
    client.close();
    return status(`\u26a0 Could not connect: ${(err as Error).message}`);
  }
  const occupied = ydoc.getMap("elements").size > 0;
  if (mode === "share" && occupied) {
    client.close();
    return status(`\u26a0 "${s.room}" already holds a model. Use Join instead, or pick another name.`);
  }
  if (mode === "join" && !occupied) {
    client.close();
    return status(`\u26a0 "${s.room}" is empty. Use Share this project to start it.`);
  }
  const binding = bindDocument(doc, ydoc);
  collab = { client, binding, room: s.room.trim() };
  if (mode === "join") {
    filePath = null;
    dirty = false;
    selection = [];
    activeLevelId = levels(doc)[0]?.id ?? "";
    activeViewId = floorPlanFor(doc, activeLevelId)?.id ?? views(doc)[0]?.id;
    refreshAll();
    viewport.zoomToFit();
  }
  const paneOpen = () => !$<HTMLDivElement>("#collab-pane").hidden;
  client.onStatus((st) => {
    status(st === "connected" ? `Reconnected to "${s.room}".` : st === "offline" ? "\u26a0 Sync server unreachable; edits will be sent when it is back." : "Reconnecting\u2026");
    if (paneOpen()) renderCollabPane();
  });
  client.awareness.on("change", () => paneOpen() && renderCollabPane());
  status(mode === "share" ? `Sharing as "${collab.room}". Others can now join it.` : `Joined "${collab.room}".`);
  renderCollabPane();
}

function renderCollabPane(): void {
  const pane = $<HTMLDivElement>("#collab-pane");
  const el = (tag: string, text = "") => Object.assign(document.createElement(tag), { textContent: text });
  const items: Node[] = [el("h2", "Collaborate")];
  const bar = el("div");
  bar.className = "buttons";
  if (collab) {
    const c = collab.client;
    const state = c.status === "connected" ? "connected" : c.status === "offline" ? "offline (edits queued)" : "connecting";
    items.push(el("p", `Project "${collab.room}" on ${c.url} \u2014 ${state}.`));
    const peers = c.peers();
    items.push(el("strong", peers.length ? "Also here" : "Nobody else is here yet."));
    for (const p of peers) {
      const row = el("div");
      row.className = "peer";
      const sw = el("span");
      sw.className = "swatch";
      sw.style.background = p.colour;
      const sel = (p.selection ?? []).filter((id) => doc.has(id));
      row.append(sw, el("span", `${p.name}${sel.length ? ` \u2014 ${sel.length} selected` : ""}`));
      row.title = "Select what they have selected";
      row.onclick = () => sel.length && ctx.setSelection(sel);
      items.push(row);
    }
    const leave = el("button", "Leave") as HTMLButtonElement;
    leave.onclick = leaveCollab;
    bar.append(leave);
  } else {
    const s = collabSettings();
    const field = (label: string, key: keyof CollabSettings, type = "text", hint = "") => {
      const lab = el("label");
      const input = Object.assign(document.createElement("input"), { type, value: s[key], placeholder: hint });
      input.oninput = () => (s[key] = input.value);
      lab.append(label, input);
      return lab;
    };
    items.push(
      el("p", "Several people edit one model live through an Open-BIM sync server (npm run serve -w @open-bim/collab), which keeps the shared copy."),
      field("Server", "server", "text", "ws://host:4455"),
      field("Project", "room", "text", "e.g. smith-house"),
      field("Access token", "token", "password", "if the server needs one"),
      field("Your name", "name"),
    );
    const share = el("button", "Share this project") as HTMLButtonElement;
    share.onclick = () => void startCollab("share", s);
    const join = el("button", "Join") as HTMLButtonElement;
    join.onclick = () => void startCollab("join", s);
    bar.append(share, join);
  }
  const close = el("button", "Close") as HTMLButtonElement;
  close.onclick = () => (pane.hidden = true);
  bar.append(close);
  items.push(bar);
  pane.replaceChildren(...items);
}

// ---- interference check ----------------------------------------------------------

const CLASH_CATEGORIES: [string, string][] = [
  [Cat.Wall, "Walls"],
  [Cat.Floor, "Floors"],
  [Cat.Roof, "Roofs"],
  [Cat.Ceiling, "Ceilings"],
  [Cat.Column, "Columns"],
  [Cat.Beam, "Beams"],
  [Cat.PadFooting, "Pad footings"],
  [Cat.StripFooting, "Strip footings"],
  [Cat.Stair, "Stairs"],
  [Cat.Ramp, "Ramps"],
  [Cat.FamilyInstance, "Components"],
  [Cat.Duct, "Ducts"],
  [Cat.DuctFitting, "Duct fittings"],
  [Cat.Pipe, "Pipes"],
  [Cat.PipeFitting, "Pipe fittings"],
  [Cat.CableTray, "Cable trays"],
  [Cat.Conduit, "Conduits"],
  [Cat.DirectShape, "Imported (IFC)"],
  [Cat.Link, "Linked models"],
];
const clashSets = { a: new Set<string>([Cat.Beam, Cat.Column]), b: new Set<string>([Cat.Wall, Cat.Floor, Cat.Roof]) };

function renderClashPane(results?: ReturnType<typeof findClashes>): void {
  const pane = $<HTMLDivElement>("#clash-pane");
  const el = (tag: string, text = "") => Object.assign(document.createElement(tag), { textContent: text });
  const title = el("h2", "Interference Check");
  const cats = el("div");
  cats.className = "cats";
  cats.append(el("strong", "Category set A"), el("strong", "Category set B"));
  for (const [cat, label] of CLASH_CATEGORIES) {
    for (const side of ["a", "b"] as const) {
      const lab = el("label");
      const cb = Object.assign(document.createElement("input"), { type: "checkbox", checked: clashSets[side].has(cat) });
      cb.onchange = () => (cb.checked ? clashSets[side].add(cat) : clashSets[side].delete(cat));
      lab.append(cb, ` ${label}`);
      cats.append(lab);
    }
  }
  const run = el("button", "Run check") as HTMLButtonElement;
  run.onclick = () => {
    status("Checking for clashes\u2026");
    setTimeout(() => {
      try {
        const r = findClashes(doc, viewport.geometryKernel as never, { a: [...clashSets.a], b: [...clashSets.b] });
        status(`${r.length} clash(es) found${r.length && !r[0]!.exact ? " (bounding-box estimate; OpenCascade still loading)" : ""}.`);
        renderClashPane(r);
      } catch (err) {
        status(`\u26a0 Clash check failed: ${(err as Error).message}`);
      }
    }, 10);
  };
  const close = el("button", "Close") as HTMLButtonElement;
  close.onclick = () => (pane.hidden = true);
  const bar = el("div");
  bar.className = "buttons";
  bar.append(run, close);
  const items: Node[] = [title, cats, bar];
  if (results) {
    if (!results.length) items.push(el("p", "No clashes."));
    else {
      const table = el("table");
      const head = el("tr");
      head.append(el("th", "#"), el("th", "Element A"), el("th", "Element B"), el("th", "Overlap"));
      table.append(head);
      const name = (id: string) => {
        const e = doc.get(id);
        return e ? `${e.category} ${e.name ?? (e.typeId ? (doc.get(e.typeId)?.name ?? "") : "")}`.trim() : "(deleted)";
      };
      results.forEach((c, i) => {
        const tr = el("tr");
        tr.className = "clash";
        tr.append(el("td", String(i + 1)), el("td", name(c.a)), el("td", name(c.b)), el("td", `${(c.volume / 1e6).toFixed(c.volume < 1e6 ? 3 : 1)} L`));
        tr.onclick = () => ctx.setSelection([c.a, c.b]);
        table.append(tr);
      });
      items.push(table);
    }
  }
  pane.replaceChildren(...items);
}

/** Reload a link: re-read its file on desktop, or pick it again in the browser. */
async function reloadLinkFile(id: ElementId): Promise<void> {
  const link = doc.get(id) as Link | undefined;
  if (!link) return;
  try {
    // Desktop: re-read the same file; browser: pick it again.
    let json = await readProjectAt(link.params.path);
    let path = link.params.path;
    if (!json) {
      const r = await openProject();
      if (!r) return;
      json = r.json;
      path = r.path;
    }
    doc.transact(`Reload ${link.name}`, (tx) => reloadLink(tx, id, json!, path));
    status(`Reloaded ${link.name}.`);
  } catch (err) {
    status(`\u26a0 Reload failed: ${(err as Error).message}`);
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

// ---- plugins & scripting console ----------------------------------------------

const plugins = new PluginHost({
  doc: () => doc,
  selection: () => selection,
  setSelection: (ids) => ctx.setSelection(ids),
  activeViewId: () => activeViewId,
  activeLevelId: () => activeLevelId,
  status,
});
mountConsole(
  $("#console"),
  plugins,
  async () => {
    const text = await openText({ name: "JavaScript plugin", extensions: ["js", "mjs"] });
    return text ? { text, name: "Plugin" } : null;
  },
  () => refreshPanels(),
);
// Scripts and plugins can reach the API from the browser devtools too.
(globalThis as { openBim?: unknown }).openBim = plugins.api;
void plugins.restore();
