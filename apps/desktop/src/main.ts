import {
  Cat,
  Document,
  applyResidentialTemplate,
  levels,
  planViewRange,
  type CeilingParams,
  type ElementId,
  type FloorParams,
  type LevelParams,
} from "@open-bim/core";
import { SimpleKernel } from "@open-bim/geometry";
import { openProject, saveProject } from "./io.ts";
import { renderBrowser, renderProperties, type PanelContext } from "./panels.ts";
import { buildSample } from "./sample.ts";
import { GridTool, ReferencePlaneTool, SelectTool, SketchTool, WallTool, type Tool, type ToolContext } from "./tools.ts";
import { Viewport, type ViewMode } from "./viewport.ts";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

// ---- state ----------------------------------------------------------------

const doc = new Document();
buildSample(doc);

let selection: ElementId[] = [];
let activeLevelId: ElementId = levels(doc)[0]!.id;
let activeWallTypeId: ElementId = doc.byCategory(Cat.WallType)[0]!.id;
let filePath: string | null = null;
let dirty = false;

const viewport = new Viewport($("#viewport"), doc, new SimpleKernel());
const status = (text: string) => ($("#status").textContent = text);

const ctx: ToolContext & PanelContext = {
  doc,
  viewport,
  activeLevelId: () => activeLevelId,
  activeWallTypeId: () => activeWallTypeId,
  selection: () => selection,
  setSelection(ids) {
    selection = ids;
    viewport.setSelection(ids);
    refreshPanels();
  },
  setActiveLevel(id) {
    activeLevelId = id;
    refreshAll();
  },
  editBoundary(id) {
    const el = doc.require<FloorParams | CeilingParams>(id);
    const name = el.category === Cat.Ceiling ? "ceiling" : "floor";
    activeLevelId = el.params.levelId;
    setTool(name);
    refreshAll();
    (tools[name] as SketchTool).edit(id);
  },
  viewMode: () => viewport.viewMode,
  setViewMode(mode: ViewMode) {
    viewport.setViewMode(mode);
    refreshAll();
  },
  status,
};

// ---- tools ----------------------------------------------------------------

const tools: Record<string, Tool> = { select: new SelectTool(ctx), wall: new WallTool(ctx), grid: new GridTool(ctx),
  refplane: new ReferencePlaneTool(ctx),
  floor: new SketchTool(ctx, "floor"),
  ceiling: new SketchTool(ctx, "ceiling"),
};
let tool: Tool = tools.select!;

function setTool(name: string): void {
  tool.deactivate?.();
  tool = tools[name] ?? tools.select!;
  tool.activate?.();
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => {
    b.classList.toggle("active", b.dataset.tool === tool.name);
  });
}

const canvas = viewport.renderer.domElement;
let downAt: { x: number; y: number } | null = null;
canvas.addEventListener("pointerdown", (ev) => {
  if (ev.button === 0) downAt = { x: ev.clientX, y: ev.clientY };
});
canvas.addEventListener("pointerup", (ev) => {
  if (ev.button !== 0 || !downAt) return;
  const moved = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y);
  downAt = null;
  if (moved < 5) tool.click?.(ev);
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
};

function loadInto(json: ReturnType<Document["toJSON"]>, path: string | null): void {
  doc.load(json);
  filePath = path;
  dirty = false;
  selection = [];
  activeLevelId = levels(doc)[0]?.id ?? "";
  activeWallTypeId = doc.byCategory(Cat.WallType)[0]?.id ?? "";
  viewport.setSelection([]);
  refreshAll();
  viewport.zoomToFit();
  status(path ? `Opened ${path}` : "New project");
}

document.querySelectorAll<HTMLButtonElement>("[data-cmd]").forEach((b) => {
  b.onclick = () => void commands[b.dataset.cmd!]?.();
});
document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => {
  b.onclick = () => setTool(b.dataset.tool!);
});
document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b) => {
  b.onclick = () => ctx.setViewMode(b.dataset.view as ViewMode);
});

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
  if (ev.key.toLowerCase() === "f") return run(ev, "fit");
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

  const wt = $<HTMLSelectElement>("#active-wall-type");
  wt.replaceChildren(
    ...doc.byCategory(Cat.WallType).map((t) => new Option(t.name ?? t.id, t.id, false, t.id === activeWallTypeId)),
  );
  wt.onchange = () => (activeWallTypeId = wt.value);

  $<HTMLButtonElement>('[data-cmd="undo"]').disabled = !doc.canUndo;
  $<HTMLButtonElement>('[data-cmd="redo"]').disabled = !doc.canRedo;
  $<HTMLButtonElement>('[data-cmd="undo"]').title = doc.undoName ? `Undo ${doc.undoName} (Ctrl+Z)` : "Undo";
  $<HTMLButtonElement>('[data-cmd="redo"]').title = doc.redoName ? `Redo ${doc.redoName} (Ctrl+Y)` : "Redo";

  const lv = doc.get<LevelParams>(activeLevelId);
  if (lv) {
    viewport.setWorkPlane(lv.params.elevation);
    viewport.setPlanRange(planViewRange(doc, activeLevelId));
  }
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === viewport.viewMode);
  });
}

function refreshPanels(): void {
  renderBrowser($("#browser-body"), ctx);
  renderProperties($("#properties-body"), ctx);
}

function refreshAll(): void {
  if (!doc.has(activeLevelId)) activeLevelId = levels(doc)[0]?.id ?? "";
  if (!doc.has(activeWallTypeId)) activeWallTypeId = doc.byCategory(Cat.WallType)[0]?.id ?? "";
  refreshToolbar();
  refreshPanels();
  updateTitle();
}

function updateTitle(): void {
  const name = filePath?.split(/[\\/]/).pop() ?? "Untitled";
  document.title = `${dirty ? "• " : ""}${name} — Open-BIM`;
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
