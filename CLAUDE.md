# CLAUDE.md

Open-BIM: an open-source, ground-up Revit-class BIM authoring app. Tauri 2 desktop, TypeScript core.
Owner: Jeremy (NZ, construction/property). Prefers concise communication.

## Read first
- `docs/ARCHITECTURE.md` — layers, core concepts, decisions
- `docs/ROADMAP.md` — phases; work the current phase top-down
- `docs/REVIT_FEATURE_MAP.md` — update status when a feature lands

## Layout
- `packages/core` — document, elements, transactions, regeneration (no DOM, no three.js)
- `packages/geometry` — kernel interface + builders (no three.js; outputs typed arrays)
- `packages/collab` — Yjs binding, sync client and self-hosted sync server (multi-user editing)
- `apps/desktop` — Vite + three.js UI; `src-tauri/` Rust shell

## Commands
- `npm install` — install all workspaces
- `npm test` — vitest across packages
- `npm run typecheck` — tsc across packages
- `npm run dev` — web-only dev server (fast UI iteration)
- `npm run tauri dev` — desktop app

## Rules
- All model changes go through `doc.transact()`. Never mutate elements directly.
- Lengths in millimetres; Z is up.
- `core` must not import `geometry` or any UI lib. `geometry` must not import three.js.
- Every new element category: add params interface, dependencies, a geometry builder, and tests.
- Write tests for core/geometry logic before or alongside code. Keep `npm test` green.
- Small, focused commits. Update docs when architecture changes.
- NZ context: metric, NZS 3604 / H1 relevant later; use NZ English in UI text.

## Session tips
- Run /mcp first to check context7 and playwright are connected.
- Claude Pro has usage limits that reset every few hours: do one feature per session, check it with
  `npm run tauri dev`, then start the next feature fresh.
- End each session by updating the "Current state" section below and pushing to GitHub.

## Current state (update at the end of each session)
- Phases 0–7b done. Order agreed with Jeremy: Phase 7a (close known gaps), 7b (Revit-style
  interface: ribbon, menus, drag and drop), then 8 (MEP & visual programming).
- Modelling: levels, layered wall/floor/ceiling/roof types with materials, walls (W; auto L/T/X joins,
  Flip), floors/ceilings/roofs from sketches (roofs: per-edge slope or gable), doors (D) and windows (N)
  as parametric hosted types, wall openings, grids (G), reference planes (R), project units + info.
- Kernels: SimpleKernel (extrusions) and OcctKernel (OpenCascade via replicad-opencascadejs, async load;
  boolean wall openings).
- Views are elements: floor plans per level, callouts, sections (S), building elevations, {3D}. Plans and
  sections are true 2D drawings from mesh hidden-line removal (`geometry/src/hlr.ts`), with layer cut
  patterns at Medium/Fine and material surface patterns. V/G per view, rule filters, view templates.
- Annotation (view-owned): live aligned dimensions (M), detail lines (L), filled regions, text (T).
- Sheets with a built-in title block, viewports, and vector PDF export (`geometry/src/pdf.ts`).
- UI: box select, type selector, temporary hide/isolate (H/I/U), properties for everything, browser.
- Modify: Move/Copy/Rotate/Mirror/Array (MV, CO, RO, MM, AR; toolbar). Type a value + Enter; options
  strip (Copy, Multiple, Disjoin, Number) top-left of the view. Mirror by drawn axis only.
  Align (AL), Offset (OF), Trim/Extend (TR; corner or to boundary), Split (SL) — plans/3D only.
  Grips on the selection (Select tool, plans/sections/sheets): drag ends/vertices; click a line's
  length label to type a new length; press on a selected element and drag to move it. Selected
  walls show a flip arrow (exterior side). Right-click (no drag): element menu, or on empty space
  the view menu with Visibility/Graphics (dialog; also VV). In 3D, orbit pivots on the selection.
- Panels: Project Browser / Properties dock left or right (drag the title), tab together (drop on
  the other's title), or float (drop elsewhere, or ⧉); empty-space menu → Reset Panel Layout.
  UI chrome is light grey (Jeremy asked: no black menus). Browser groups fold (click headings).
- Ribbon (apps/desktop/src/ribbon.ts + ribbondefs.ts, icons.ts): File menu (with Recent, desktop
  only, local storage; untested in the Tauri app), QAT, Revit-order tabs;
  Annotate: Dimension, Detail (line, region, cloud), Text (+ Check Spelling, Find/Replace), Tag (+
  Keynote ▾ load/export keynote files), Revisions, Groups. Symbol ▾ places a north arrow
  (true north option), scale bar or break line. Detail → Component ▾ places Detail Item
  families (library or your own: New family → Detail Item, draw detail lines/regions). Detail Group (or
  Ctrl+G on one view's drafting) makes a detail group; Place Group puts copies in the open view. Options bar under the ribbon holds Level/Type.
- View markers: bubbles with the view's number and a filled arrow, or a View Marker family picked in
  the view's Properties (library: several heads/tails/marks; New family → View Marker for your own); Elevation tool places one
  elevation facing the nearest wall (Elevation ▾: N/E/S/W set). Sections, callouts, grids and
  ref planes place by two clicks or press-drag-release.
- Selecting a section/elevation shows its view extent (dashed, hatched) with grips for the line ends
  and far clip (elevations move by their marker; callouts by corner grips). Arrow keys nudge the
  selection (step follows the zoom; Shift ×10).
- Grid bubbles, view markers and reference plane labels scale with the view scale (paper size ×
  1:n), on screen and on sheets; grids are dash-dot with solid ends; section tails are a bar in the
  view direction.
- 3D views keep their own camera (`camera` param, saved without an undo step on leaving the view
  or saving); View → 3D View ▾ → Camera: eye then target in a plan makes a perspective view at
  1750 eye height (eye/target elevation and field of view in Properties).
- Keyboard Shortcuts (KS, or File menu): edit one/two-letter keys per command (apps/desktop/src/shortcuts.ts;
  local storage). Single letters fire at once; a second letter within 1 s takes over.
- View windows (apps/desktop/src/panes.ts): Tile / Cascade / Tab Views (View → Windows, WT/WC/TW,
  or the ▦ ▾ at the end of the view tabs: Tile all / 2 / 3 / 4 most recent, Cascade, Tab Views).
  Each open view is a live window (a Viewport each, up to 9): drag the title bar, resize by the
  edges (snap to the area and each other), double-click to maximise, × closes. The active window
  holds the interactive viewport; click another to work in it.
- Status bar: ⧩ selection count at the right; click to filter the selection by category.
- Drag from the Project Browser: views/legends/schedules onto the open sheet (placed where dropped);
  families into a view start placing them (detail items via the detail component tool).
- Double-click: section/elevation/callout marker opens its view; sheet viewport opens its view;
  a component opens its family in the family editor.
- Wall attach: Modify → Attach Top/Base (or right-click a wall), then click the roof/floor/ceiling;
  Properties shows it with Detach. Dragging a wall end only drags joined walls that are selected too.
- Override Graphics in View: right-click → By Element / By Category (dialog: visible, halftone,
  transparency, projection/cut lines, surface/cut patterns fg/bg) or By Filter (V/G). Stored as
  view `elementOverrides` / category overrides (template if any); line weights only in PDF.
- Reveal Hidden mode: right-click a magenta element → Unhide Element / Unhide Category. Docking:
  drop on a docked panel's top/bottom half to split it there.
- View control bar also has (3D) Sun Settings (solar study: Still / Single-Day / Multi-Day with a
  Play preview, or Lighting by azimuth/altitude; sun brightness) and Shadows on/off with a ▾
  Shadows & Lighting dialog (shadow intensity, ambient light, ambient shadows = GTAO, depth cueing
  = fog) — view `sun` / `lighting` params, and Materials (Material Browser dialog). Every model view (plans,
  callouts, sections, elevations, 3D) has visual styles, sun, shadows, ambient shadows and depth
  cueing: shaded plans/sections show the coloured model under the line work (sections render the
  model through a camera on the cut plane, clipped to the crop, then the drawing over it).
- Under the view: open-view tabs (bottom, Revit-style per Jeremy) and the view control bar (scale,
  detail level, visual style for 3D, temporary hide/isolate, reveal hidden in magenta).
- Wall join cleanup in plans (`geometry/src/wallcleanup.ts`): layers give way by priority (structure
  first), tee stems' cores run to the through wall's core, crossing walls clean (thicker wins), no
  lines between joined walls of the same material. Disallow Join per end (Properties / right-click).
- Known gaps: join cleanup is plan-only (3D solids overlap at crossings); grids straight only;
  floors: Pick Walls (sketch options strip: face/core/centre line + offset) and slope arrows (floor
  Properties → Add slope arrow; tail/head heights; plane top, sheared slab, 1:n arrow in plan); roofs exact for convex/L/T/U only; doors/windows parametric;
  dimensions only in plans via the tool; 3D views are perspective only (no orthographic 3D).
  Screen and sheet/PDF share `lineworkDrawing` for cut/projection line work.
- Families (Phase 3 started): family editor (Browser → Families → New family / Edit family) with
  Extrusion/Blend/Revolve/Sweep (+ Void), parameters with formulas, family types; Load into Project;
  Component tool (C) places them (free-standing, or in walls for Door/Window families).
- Family constraints: label a dimension between reference planes with a parameter, or set EQ;
  planes flex (PlaneGCS) on every edit; forms use plane names in formulas (e.g. x = Left).
- Type catalogs (import/export CSV in Family Types); nested families (Load from project → Component,
  associate parameters with host formulas).
- Parameters: project parameters (per category, instance/type), shared parameter files, global
  parameters driving element values (browser → Parameters; element properties).
- Family library: Browser → Families → Load from library (`packages/library`) or Load family file;
  family editor → Save Family File (`.obim-family`, open JSON).
- Rooms (Room / Separator tools, plans) and area plans (browser → New area plan; GFA/NLA,
  boundaries from walls; Area / Area Boundary tools).
- Tags (Tag / Keynote tools; Mark property), keynote table (browser → Project → Load keynotes),
  legends (Views → New legend; add components / keynote legend in its properties).
- Schedules/Quantities and material takeoffs (browser → Schedules; fields, filter, sort/group,
  totals; Export CSV / Excel). Calculated values (formula over fields by name; m, m², m³; numbers
  total) and schedules on sheets (sheet Properties → Place view; any number of sheets; drawn as a table).
- Revisions (browser → Revisions; Cloud tool; sheet revision schedule) and model groups (Group /
  Ctrl+G; Place copy; Apply to other instances; Ungroup) and detail groups (view drafting).
- Plugins + scripting console (toolbar Console or `; docs/PLUGINS.md, examples/plugins).
- IFC: Export IFC (IFC4, packages/ifc) and Import IFC (web-ifc → DirectShapes on matching levels).
- DXF/DWG: Export DXF/DWG (open view/sheet) and Import DXF/DWG (into the open view as a CadImport).
  DWG is desktop-only via an installed ODA File Converter or LibreDWG (src-tauri/src/cad.rs);
  not tested with a real converter (none installed here).
- Shared coordinates (Project Information & Units → Location; NZTM2000) and links (browser → Links →
  Link project…; by shared coordinates or origin; Reload). Links draw in one colour, aren't scheduled.
- glTF (.glb) and OBJ (+MTL, zipped) export.
- Stairs (Stair tool: run ends, Enter; D1/AS1 checks), ramps (1:12 check), railings (sketched or
  on stairs/ramps, F4/AS1 gap). Straight runs only (no winders/curved runs).
- Curtain walls: wall type "Curtain Wall - Aluminium 1200 x 1500" (grid in type properties).
- Stacked walls: browser Types → New stacked wall type (segments in its properties).
- Toposolids: Toposolid tool (sketch boundary) + Import survey CSV (E,N,RL m) in Properties; contours.
- Structure: Column / Beam / Footing tools; sections (NZ timber/steel/concrete) as Structural types.
  Beams show a dashed centreline in plans of their level (plus their cut where the view range cuts them).
- Phasing (view Phase / Phase filter; element Phase created/demolished; Demolish tool), design options
  (browser → Design Options; element Design option; per-view option), Clashes panel (OCCT volumes).
- Multi-user editing (Phase 7): toolbar Collaborate → Share this project / Join, via the sync server
  (`npm run serve -w @open-bim/collab`; PORT, OPEN_BIM_DATA, OPEN_BIM_TOKEN). Defaults chosen without
  Jeremy's answer: Yjs, self-hosted, one shared token, no accounts. Revisit if he wants a hosted service.
- Render (toolbar, from a 3D view): path traced, sun from site/date/time, Save PNG. Materials have
  roughness/metalness/transparency. No textures, no AI render (needs a service decision).
- H1 energy: toolbar NZ Checks; R-values in type properties (Energy (H1)); zone and provisional
  minimums in Project Information → H1 energy. Jeremy said build with my own figures for now.
- Bracing: wall Properties → Bracing (NZS 3604) panels; zones/weights/systems in Project Information;
  NZ Checks → NZS 3604 bracing (enter tabulated demand there). Demand is a provisional estimate.
- AI render: Render pane → AI render… (self-hosted SD WebUI API, or Gemini with the user's key).
  Tested against a mock server only, not a real model.
- Next: Phases 7a and 7b done. Phase 8 (MEP & visual programming).
