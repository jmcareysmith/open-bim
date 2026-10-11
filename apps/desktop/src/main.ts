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
  isDrawingView,
  type View,
  type ViewParams,
  typeCategoryOf,
  validateHosted,
  type CeilingParams,
  type ElementId,
  type FloorParams,
  type RoofParams,
  type LevelParams,
} from "@open-bim/core";
import { OcctKernel, SimpleKernel } from "@open-bim/geometry";
import occtWasmUrl from "replicad-opencascadejs/wasm?url";
import { openProject, saveProject } from "./io.ts";
import { renderBrowser, renderProperties, type PanelContext } from "./panels.ts";
import { buildSample } from "./sample.ts";
import {
  GridTool,
  CalloutTool,
  DetailLineTool,
  DimensionTool,
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

const doc = new Document();
buildSample(doc);

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
  doc,
  viewport,
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
  detailline: new DetailLineTool(ctx),
  region: new SketchTool(ctx, "region"),
  text: new TextTool(ctx),
  dimension: new DimensionTool(ctx),
};
/** Tools that work in sections/elevations (the rest need a plan or 3D work plane). */
const DRAWING_TOOLS = new Set(["select", "detailline", "region", "text"]);
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
  async save() {
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
  if (!activeView()) activeViewId = views(doc).find((v) => v.params.kind === "3d")?.id ?? views(doc)[0]?.id;
  const v = activeView();
  if (!v) return viewport.setViewMode("3d");
  if (v.params.kind === "floorPlan" || v.params.kind === "callout") {
    viewport.setPlanRange(viewRange(doc, v));
    viewport.setViewMode("plan");
    viewport.setPlanCrop(v.params.kind === "callout" ? (v.params.crop ?? null) : null);
  } else if (isDrawingView(v)) {
    viewport.setDrawingView(v);
  } else {
    viewport.setViewMode("3d");
  }
  // Visibility/Graphics: the view's own settings, or its template's.
  const g = effectiveGraphics(doc, v);
  viewport.setGraphicsResolver((el) => elementGraphics(doc, g, el));
  viewport.setAnnotationView(v.id);
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
}

function refreshAll(): void {
  if (!doc.has(activeLevelId)) activeLevelId = levels(doc)[0]?.id ?? "";
  refreshToolbar();
  refreshPanels();
  updateTitle();
}

function updateTitle(): void {
  const name = filePath?.split(/[\\/]/).pop() ?? "Untitled";
  const project = projectSettings(doc)?.params.info.name;
  document.title = `${dirty ? "• " : ""}${name}${project ? ` (${project})` : ""} — Open-BIM`;
}

doc.on((c) => {
  if (c.name !== "Load") dirty = true;
  selection = selection.filter((id) => doc.has(id));
  refreshAll();
  if (c.name.startsWith("Undo") || c.name.startsWith("Redo")) status(c.name);
});

refreshAll();
setTool("select");
viewport.zoomToFit();

// Start on the fast extrusion kernel; switch to OpenCascade (booleans for openings) once its WASM loads.
OcctKernel.create({ locateFile: () => occtWasmUrl })
  .then((k) => viewport.setKernel(k))
  .catch((err) => {
    console.error(err);
    status("\u26a0 OpenCascade failed to load \u2014 openings won't cut walls until restart.");
  });
