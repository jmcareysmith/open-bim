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
  Flip), floors/ceilings/roofs from sketches (Ceiling ▾ Automatic: click inside walls — geometry `wallEnclosure`) (roofs: per-edge slope or gable), doors (D) and windows (N)
  as parametric hosted types (doors: architraves both faces, lever handles, trim/timber vertex colours; windows:
  sashes, mullion over 1000 wide, exterior sill), wall openings, shaft openings (Architecture → Opening → Shaft: sketch; cut floors and
  ceilings between base/top levels via polygon difference — core/model/shafts.ts, kernel `extrudeCut`), grids (G), reference planes (R), project units + info.
- Kernels: SimpleKernel (extrusions) and OcctKernel (OpenCascade via replicad-opencascadejs, async load;
  boolean wall openings).
- Views are elements: floor plans per level, detail callouts of sections/elevations (View → Callout in a section: a section
  with `parentId` on the same cut, trimmed to the box; boxed with a bubble in the parent, not in plans), drafting views (kind `drafting`, core `createDraftingView`, `isAnnotationView` with legends), jogged sections (section Properties → Split segment; `jogs`, core `sectionSegments`; shaded underlay not jogged), reflected ceiling plans (View → Plan ▾; kind `ceilingPlan`, cut 2300
  looking up — geometry `planViewLinework` mirrors meshes in Z), callouts, sections (S), building elevations, {3D}. Plans and
  sections are true 2D drawings from mesh hidden-line removal (`geometry/src/hlr.ts`), with layer cut
  patterns at Medium/Fine and material surface patterns. V/G per view, rule filters, view templates.
- Annotation (view-owned): live aligned dimensions (M), detail lines (L), filled regions, text (T; leaders via
  Properties → Add leader), batt insulation (Annotate → Detail → Insulation; width in Properties).
- Sheets with a built-in title block or a Title Block family (sheet Properties → Title block; New family →
  Title Block, paper mm, {Sheet Number}/{Sheet Name}/{Project Name}/{Date}/{Revision}/{Scale}… in text;
  library "Title Block - A1 Simple"), viewports, and vector PDF export (`geometry/src/pdf.ts`).
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
  (true north option), scale bar, break line or coordinate point (E/N/RL from shared coordinates; core `symbolCoordinates`). Detail → Component ▾ places Detail Item
  families (library or your own: New family → Detail Item, draw detail lines/regions); Component ▾ Repeating detail repeats one
  along a line at its width (`repeat` on the component, core `detailCopies`). Detail Group (or
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
- 3D views: white background, shaded three.js ViewCube in an N/E/S/W compass ring (viewcube.ts; click
  face/edge/corner, right-click Orthographic/Perspective; {3D} orthographic), Section box (view Properties;
  drag the blue arrows; `sectionBox` param; cut faces drawn grey).
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
- Project Browser is Revit's: Views (all), Sheets (all) just below (Jeremy), Legends, Schedules, Families
  (system families Walls/Floors/…/Ducts/Pipes and loadable ones, by category → family → type),
  Groups (model/detail), Links. Project Information, Materials, Project Parameters, Levels,
  Filters & Templates, Design Options, Revisions, System Browser (F9) and Model Statistics are
  Manage-tab dialogs (`projectSection` in panels.ts).
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
  lines between joined walls of the same material. Wrapping at ends and at inserts (wall type Properties): the exterior/
  interior finish layers carry round free ends, and into door/window/opening jambs the plan cuts (exterior/interior/both halves), at Medium/Fine. Disallow Join per end (Properties / right-click).
- Known gaps: join cleanup is plan-only (3D solids overlap at crossings);
  floors: Pick Walls (sketch options strip: face/core/centre line + offset) and slope arrows (floor
  Properties → Add slope arrow; tail/head heights; plane top, sheared slab, 1:n arrow in plan); roofs exact for convex/L/T/U only; doors/windows parametric;
  angular dimensions in plans and sections (sections: picked drawn edges become fixed `line` DimRefs, level lines stay
  live; viewport `pickSegment`), radial plan-only (Dimension ▾ Angular / Radial; core/model/angulardims.ts).
  Screen and sheet/PDF share `lineworkDrawing` for cut/projection line work.
- Families (Phase 3 started): family editor (Browser → Families → New family / Edit family) with
  Extrusion/Blend/Revolve/Sweep (+ Swept Blend: sweep Properties → Make swept blend, `endProfile`) (+ Void), parameters with formulas, family types; Load into Project;
  Component tool (C) places them (free-standing, or in walls for Door/Window families).
- Family constraints: label a dimension between reference planes with a parameter, or set EQ; label an angular
  dimension between two planes with an Angle parameter (the second plane pivots on its start; `PlaneSystem.angles`);
  planes flex (PlaneGCS) on every edit; forms use plane names in formulas (e.g. x = Left).
- Type catalogs (import/export CSV in Family Types); nested families (Load from project → Component,
  associate parameters with host formulas). Shared (Family Types → Shared): nested instances also exist in the
  project as FamilyInstances with `nestedOf`/`nestedKey` (core `syncSharedNested` hook; nested family loaded by name;
  drawn by the host's mesh, kernel returns null for them) so schedules count them.
- Parameters: project parameters (per category, instance/type), shared parameter files, global
  parameters driving element values (browser → Parameters; element properties).
- Family library: Browser → Families → Load from library (`packages/library`) or Load family file;
  family editor → Save Family File (`.obim-family`, open JSON).
- Rooms (Room / Separator tools, plans) and area plans (browser → New area plan; GFA/NLA,
  boundaries from walls; Area / Area Boundary tools).
- Tags (Tag ▾ by category / multi-category / material, Keynote tools; Mark property), keynote table (browser → Project → Load keynotes),
  legends (Views → New legend; add components / keynote legend in its properties).
- Schedules/Quantities and material takeoffs (browser → Schedules; fields, filter, sort/group,
  totals; Export CSV / Excel). Calculated values (formula over fields by name; m, m², m³; numbers
  total) and schedules on sheets (sheet Properties → Place view; any number of sheets; drawn as a table).
- Revisions (browser → Revisions; Cloud tool; sheet revision schedule) and model groups (Group /
  Ctrl+G; Place copy; Apply to other instances; Ungroup) and detail groups (view drafting).
- Plugins + scripting console (toolbar Console or `; docs/PLUGINS.md, examples/plugins); Manage → Add-ins (Add-in Manager:
  on/off — off ones stay installed but don't load at start-up, remove, load; plugins.ts `installed`/`setEnabled`).
- IFC: Export IFC (File → Export → IFC4 or IFC4X3, packages/ifc `schema` option) and Import IFC (web-ifc → DirectShapes on matching levels;
  they show/style as their IFC class's category — core `ifcClassCategory`). DirectShape Properties → Convert to native / Convert all
  (geometry/ifcnative.ts `convertDirectShapes`: boxy IfcWall → Wall by min-area rectangle, IfcSlab → Floor from its top faces,
  types matched by thickness or "Imported Wall/Floor <t>"; IfcDoor/IfcWindow shapes in them become WallOpenings).
- DXF/DWG: Export DXF/DWG (open view/sheet) and Import DXF/DWG (into the open view as a CadImport).
  DWG is desktop-only via an installed ODA File Converter or LibreDWG (src-tauri/src/cad.rs);
  not tested with a real converter (none installed here).
- Shared coordinates (Project Information & Units → Location; NZTM2000; survey point position; plan Properties → Base and
  survey points shows both marks with E/N/RL — geometry `basePointMarks`) and links (browser → Links →
  Link project…; by shared coordinates or origin; Reload). Links draw in one colour or their own material colours (link Properties); schedules can Include elements in links
  (`includeLinks`); link Properties → Bind Link (core/model/bind.ts: model elements copied in, types/materials/families
  shared by name, levels matched by elevation, views/annotation left behind; uses modify `transformParams`).
- glTF (.glb) and OBJ (+MTL, zipped) export.
- Stairs (Stair tool: run ends, Enter; D1/AS1 checks), ramps (1:12 check), railings (sketched or
  on stairs/ramps, F4/AS1 gap). Runs are straight; L/U by drawing runs; stair Properties → Turns: landings or 2–4 winders per square turn
  (provisional walking-line going check); railings round the corners. Curved runs: stair Properties → Run n
  curve (wedge treads along the arc, walking-line going check, railings and walking line follow).
- Curtain walls: wall type "Curtain Wall - Aluminium 1200 x 1500" (grid, mullion type rectangular/circular, border
  mullions in type properties). Per wall (Properties → Curtain grid and panels): elevation diagram (click panel
  = glass → solid → empty → door; click grid line = remove/restore segment), typed line positions; `curtainEdits`.
  Mullion profiles (core MULLION_PROFILES: rectangular, circular, trapezoid, capped): type interior/border
  profile; click a selected curtain wall (or Tab over it) to pick a mullion/panel (apps/desktop/src/curtainpart.ts,
  mesh `parts`, viewport pickPart/setPartHighlight) → Properties: profile (segment or whole line), remove, panel kind.
- Stacked walls: browser Types → New stacked wall type (segments in its properties).
- Toposolids: Toposolid tool (sketch boundary) + Import survey CSV (E,N,RL m) in Properties; contours.
- Structure: Beam System (click a floor; core `createBeamSystem` makes a BeamSystem element owning beams by `systemId`; `enableBeamSystems` commit hook re-lays them when the floor or settings change) / Column / Beam / Brace (sloped beam, `endOffset`, `brace`; core `createBrace`) / Footing / Foundation Slab (floor of type "Foundation Slab - 300 Concrete", core `ensureFoundationSlabType`) tools; sections (NZ timber/steel/concrete) as Structural types.
  Beams show a dashed centreline in plans of their level (plus their cut where the view range cuts them).
- Phasing (view Phase / Phase filter; element Phase created/demolished; Demolish tool), design options
  (browser → Design Options; element Design option; per-view option), Clashes panel (OCCT volumes).
- Multi-user editing (Phase 7): toolbar Collaborate → Share this project / Join, via the sync server
  (`npm run serve -w @open-bim/collab`; PORT, OPEN_BIM_DATA, OPEN_BIM_TOKEN). Defaults chosen without
  Jeremy's answer: Yjs, self-hosted, one shared token, no accounts. Revisit if he wants a hosted service.
- Render (toolbar, from a 3D view): path traced, sun from site/date/time, Save PNG. Materials have
  roughness/metalness/transparency. Realistic style shows textures (Material Browser → Texture: an image,
  else drawn from colour + surface pattern; world-position mapping in viewport, apps/desktop/src/textures.ts); no AI render (needs a service decision).
- H1 energy: toolbar NZ Checks; R-values in type properties (Energy (H1)); zone and provisional
  minimums in Project Information → H1 energy. Jeremy said build with my own figures for now.
- Bracing: wall Properties → Bracing (NZS 3604) panels; zones/weights/systems in Project Information;
  NZ Checks → NZS 3604 bracing (enter tabulated demand there). Demand is a provisional estimate.
- AI render: Render pane → AI render… (self-hosted SD WebUI API, or Gemini with the user's key).
  Tested against a mock server only, not a real model.
- MEP (Phase 8, core/model/mep.ts): MEP family categories (mechanical equipment, air terminals,
  plumbing/electrical fixtures, lighting); family editor → Family Types → Add connector (system,
  position, facing, size, flow L/s, load W, units as formulas). Systems: right-click elements →
  Create … system / Add to …; browser → MEP Systems (by classification, flow/load totals).
- Ducts (core/model/ducts.ts, geometry/src/ducts.ts): Systems tab → Duct (DT): click to route,
  middle elevation/size/system in the options strip, change elevation between clicks for a riser,
  click a connector to join it. Fittings (elbow, transition, tee, cross) are elements kept by a
  commit hook (`enableDuctFittings`); a run ending on another's side splits it for a tee.
  Plans show duct outlines on their level. System Properties → Size ducts (velocity method).
- Pipes (core/model/pipes.ts; routing shared with ducts in core/model/runs.ts): Systems → Pipe
  (PI); DN sizes; types by material/use (PE-X, copper, uPVC sanitary/stormwater); drainage falls
  as drawn (minimum 1:40 ≤DN65, 1:60 DN80–100, 1:100 above — provisional, Jeremy's go-ahead to use
  own figures); `pipeFallChecks`. Fittings: elbow/transition/tee/cross, as for ducts.
- Model In-Place (Architecture → Model In-Place ▾ category; main.ts `modelInPlace`, `inPlacePending`: Load into Project places it at the level origin). Long menus scroll.
- Massing (Phase 8a): Mass family category; Massing & Site → Show Mass (session toggle; masses
  translucent blue, not on sheets/PDF), In-Place Mass (family editor; Load into Project places it
  at the origin), Place Mass (library Mass - Box/Cylinder/Gable). V/G category "Mass".
- Mass floors: select a mass → Properties → Mass Floors (tick levels); area/perimeter from the
  mass's plan cut at the level (geometry/massfloors.ts); gross floor area and volume; schedule
  category Mass Floors.
- Model by Face (Massing & Site): Wall / Curtain Wall (vertical face; exterior on the face; height
  of the face, rectangular), Roof (top face: pitched from its low edge, or flat), Floor (mass floor,
  or a mass for all its floors) — apps/desktop/src/facetool.ts, geometry/src/faces.ts.
- Site: Building Pad (sketch inside a toposolid; ground graded to its underside, 300 mm edge
  batter), Subregion (draped material area; plan fill), Graded Region (record existing ground);
  cut/fill (m³) in toposolid and pad Properties — core/model/site.ts `cutFill`.
- Property lines (Massing & Site → Property Line: sketch, or ▾ by bearings and distances): NZ
  survey-style DMS whole-circle bearings from the project's survey north, distances in m, area;
  legs editable in Properties (core/model/property.ts). Site / Parking Component (library Tree -
  Deciduous, Parking Space). Toposolid contour labels: index / all / none.
- HVAC library (packages/library): Supply Diffuser - Square, Return Grille, Exhaust Fan - Ceiling,
  Ducted Heat Pump - Indoor Unit (supply/return/power/condensate), Heat Pump - Outdoor Unit.
  Systems → Air Terminal / Mechanical Equipment place them (terminals and lights at 2400).
- Plumbing library: WC, basin, shower, bath, kitchen sink, laundry tub (sanitary connectors carry
  discharge units + outlet DN; DN15 hot/cold), hot water cylinder. Systems → Plumbing Fixture.
  NZ Checks → G13 drainage (core/model/drainage.ts): units per drain from its outlet, capacity by
  DN and fall, outlet size, no reducing downstream, falls. Capacities provisional.
- Electrical (core/model/electrical.ts): library Power Outlet - Double (150 W provisional), Switch,
  LED Downlight, Switchboard - Residential; Systems → Switchboard / Device / Lighting Fixture.
  Select fixtures → right-click → Create power/lighting circuit on <board> (numbered, breaker 20/10 A);
  board Properties → Switchboard schedule (load W, current at 230 V, breaker check, connected load).
- Cable tray (CT) and conduit (CN): Systems → Electrical; runs with automatic fittings like ducts
  (core/model/containment.ts; ContainmentTool). Width/depth or size + middle elevation.
- MEP display: Coarse plans draw runs single-line (no fittings); ceiling/wall MEP items get plan
  symbols on their level (geometry/mepsymbols.ts); line builders take the detail level.
  MEP categories in schedules (system/size/length) and clash checks.
- Object Styles (Manage → Object Styles; core/model/objectstyles.ts): pens per category for
  projection/cut (+ colour, pattern); Revit-like line weights table by scale (`penWidth`); views
  start from them, V/G overrides on top. Plans/sections draw wide lines on screen (LineSegments2)
  and in PDF (`Stroke.width`); Thin Lines (TL, QAT, View tab) shows 1 px.
- 3D views: white background, no ground grid; ViewCube top right (apps/desktop/src/viewcube.ts:
  faces/corners turn the view, ⌂ home, right-click Orthographic/Perspective/Fit); {3D} is
  orthographic by default (view `projection`; camera views perspective).
- Coarse: layered types draw cuts hollow unless the type sets Coarse Scale Fill Pattern/colour (type
  Properties → Graphics; `coarseFill`). Graphic Display Options (view bar ▾ next to Shadows): style, show
  edges, view transparency, silhouettes (pen; screen-space depth pass in viewport.ts), shadows, lighting,
  depth cueing — view `display` param.
- Wall sweeps/reveals (core/model/sweeps.ts, geometry/src/sweeps.ts): wall type or wall Properties →
  Sweeps and reveals (built-in profiles: skirting, chair rail, cornice, plinth, band; reveals cut by OCCT);
  sweeps run the joined face and stop at openings. Edit Profile: wall Properties → Profile (Gable, Step,
  Points, or Sketch when a section/elevation along the wall is open: click corners, Enter — profiletool.ts,
  core `wallProfileMapping`; `profile` in wall coords).
- Roof ▾ → Roof by Extrusion (two corners in plan; profile across the shorter side; Properties: Gable/Mono/
  Curved or points, extrusion start/end; walls attach to it). Roof Properties → Eaves: fascia, gutter (quad/
  half round), soffit depth, barge board up gable rakes, vertical openings (Properties → Sketch opening; `openings`) (`trims`; core `roofRakes`; core `roofEaves`, geometry `roofTrimMeshes`, `profilePrism`).
- Dimensions in sections/elevations (Aligned tool: levels, grids and walls crossing the view stay live —
  `resolveRef(doc, ref, viewId)`; other clicks are fixed points). Spot Elevation (EL; Annotate → Dimension;
  core/model/spots.ts): floor/roof/toposolid top live, else the section point or plan level; +2.700 m text.
  Temporary dimensions (length + off-axis angle) while drawing walls, detail lines and beams.
- Colour schemes (core/model/colorschemes.ts; dialog apps/desktop/src/colorschemes.ts): plan Properties →
  Colour scheme (+ Edit…), or Annotate → Color Fill ▾ Edit Color Scheme; rooms by name/department/occupancy/
  number/area range (areas by name/area); stable automatic colours, stored per value with visibility. Rooms
  aren't filled without a scheme (fill kept hidden for picking). Color Fill Legend tool places the legend.
  Rooms have Department and Occupancy.
- Floor shape editing (core/model/floorshape.ts): floor Properties → Shape editing: Add Point (click on the
  floor; height, e.g. −20 drain), points list, Reset Shape; top triangulated through points (floorTopAt via
  hook), bottom flat. Slab edge (thickening/rebated/nosing profiles) along the outline.
- Curved walls and grids (core/model/arcs.ts: `curve` = sagitta, + left): Wall ▾ Arc (start, end, bow) or
  Properties → Curve, or drag the arc's middle grip; arc walls' footprint is the band along the arc, mitred
  at corner joins on the end tangents; tees into or out of arcs; layers in plan are annular bands (geometry layers.ts), sweeps lofted round the arc (sweeps.ts `loftArc`) (plan join cleanup included — tee core extension, crossings and wrapping work on arcs via wallcleanup `wallFrame`; Edit Profile on arcs: sweeps.ts `arcProfileMesh`, 2° strips; curtain walls bend their
  straight-built grid onto the arc (curtain.ts `frameAt`), stacked walls narrow radially). Doors/windows/openings/hosted families sit square to the
  arc (core `tangentLine`, `alongArc`); flipping keeps the arc. Grids draw along the arc (not in sections or
  dimensions). Length label shows the arc length.
- Phase 8b is done (2026-11-09).
- Visual programming (Phase 8 done): Manage → Visual Programming (apps/desktop/src/grapheditor.ts): graphs
  per project (New/Rename/Delete), library (search, click to add), drag output dot → input dot to link,
  click a link to remove, Delete removes a node, unlinked inputs take values, Run (one undo step) or
  Automatic; values/errors under nodes. Engine: core/model/graphs.ts (+ graphnodes.ts library), see
  ARCHITECTURE.md. Next (Jeremy): back to Revit parity (arc-wall gaps, curved stairs, angular/radial
  dimensions, barge boards, elevation sketch profiles). Jeremy caps usage: 75% of weekly by Wednesday.
- Phase 9 started (items set in ROADMAP). Rebar (core/model/rebar.ts, geometry/src/rebar.ts): floor / wall (face mats) / pad footing /
  beam / column / strip footing Properties → Reinforcement → Add; area mats or cages laid out from the host
  (`rebarBars`), NZ bar sizes, mass (`rebarQuantities`), schedule category Structural Rebar. Bars sit inside the
  concrete, so in 3D they show only with the host hidden/transparent (no "view unobscured" yet).
- Point clouds (core/model/pointclouds.ts): Insert → Point Cloud (or File → Import): LAS 1.0–1.4 and ASCII XYZ/PTS/TXT/CSV
  in metres, thinned to 200k points, stored base64 float32 in the element; map coordinates (>10 km) go through the
  shared coordinates, else centred on the origin. Viewport draws THREE.Points (scan colours, sRGB→linear); move only;
  plans clip them by the view range, sections draw `sectionPoints` (geometry); tools snap to scan points on the storey.
  Sheets/PDF: geometry `pointCloudFills` (0.5 mm squares grouped by colour, max 60k per view).
- Analytical model (core/model/analytical.ts `analyticalModel`): derived, not stored — column axes, beam/brace centrelines
  snapped to column axes within 300, nodes merged within 300, column bases on pads or the lowest level are pinned
  supports, wall mid-surface and floor mid-depth panels. Structure → Analytical Model toggles a 3D overlay (viewport).
  End fixity: beam Properties → Start/End pinned|fixed (`startFixity`/`endFixity`; beamCheck uses fixed-fixed / propped
  coefficients), column Properties → Base support auto|pinned|fixed|none (`baseSupport`); IFC writes Fixed/Pinned conditions.
- Loads and beam checks (core/model/loads.ts, PROVISIONAL figures in its header): beam Properties → Loads and check:
  add G/Q/W line (kN/m) or point loads (kN); `beamCheck` — simply supported, NZS 1170.0 ULS combos, self-weight,
  steel 300 / timber SG8 / concrete f'c 30 with its rebar cage's bottom bars, SLS deflection L/250. Load arrows
  (geometry `buildLoadLines`). Floor Properties → Area loads (kPa) reach beams over their tributary width (beam
  `tributary`, else auto); column Properties → Axial check (`columnCheck`: beam reactions via the analytical model).
- IFC export now writes columns (IfcColumn), beams (IfcBeam), braces (IfcMember BRACE) and footings (IfcFooting), plus the
  Structural Analysis View (packages/ifc/src/structural.ts): IfcStructuralAnalysisModel with curve/surface members,
  profiles (IfcMaterialProfileSet), point connections (pinned supports), G/Q/W load cases and actions; forces in N.
  Checked by opening in web-ifc only (no analysis program here).
- Energy analysis (core/model/energy.ts `energyAnalysis`, NZ Checks → Energy analysis): fabric UA from the H1 take-off (walls
  net of openings; unset R-values take the H1 minimum), ventilation 0.5 ach, peak load at the zone design temperature,
  annual heating by degree-days (no gains), H1 calculation-method reference comparison. Zone figures provisional.
  Analyse panes (NZ Checks, Clashes, Collaborate) sit above the ViewCube (z-index 7).
- Scope boxes (core/model/scopeboxes.ts): View → Scope Box (two corners in a plan); plan Properties → Scope box sets the
  crop (`planCrop` used by drawings and the viewport); box Properties edit bounds/heights; movable. Grid Properties → Scope box
  limits straight grids to it (`datumExtent`). Levels aren't
  limited by them yet.
- Image underlays (core/model/images.ts, view-owned like CAD imports): Insert → Image re-encodes to JPEG (≤4000 px,
  on white), 200 mm paper width by default; Properties: width, position, opacity; move only. Drawings carry
  `images` (transformDrawing/sheets), the PDF writer embeds them as DCTDecode XObjects; viewport `imagePlane`. PDFs: page 1
  rendered by pdfjs-dist (apps/desktop/src/pdfunderlay.ts, lazy-loaded), sized paper mm × view scale.
- Key schedules (core/model/keyschedules.ts): browser → Schedules → New key schedule (category); creates the key text
  project parameter ("Room Style"); its Properties pick fields (the category's project parameters) and edit key rows.
  Elements choose a key (select in Project parameters); keyed parameters read from the row (`customValue` →
  `keyedValue` in parameters.ts) and are read-only on the element.
- Pressure loss (core/model/mepcalcs.ts `systemPressure`): duct/pipe system Properties → Pressure loss — flows from the
  equipment, Darcy–Weisbach (Swamee–Jain) per run, joint K (elbow by angle, tee 0.2/0.6, size change 0.1), critical
  path to the worst terminal (Select critical path). Fluid/roughness figures provisional; drainage defers to G13.
- Family form visibility (core family.ts `FormVisibility`, `formShown`): family editor form Properties → Visible in
  (Coarse/Medium/Fine/Plan). Kernels' `build(doc, el, display)` passes the view's detail level and plan-ness to the family
  mesher as reserved values `__detail`/`__plan` (cached per value set; nested families inherit). Viewport rebuilds
  instances on detail-level, view-mode and section changes; drawings pass the view's. Front/Back vs Left/Right: `__side` from the
  view direction against the instance's axes (`viewDir` in the display).
- Materials have density and conductivity (Material Browser → Physical and thermal; template values provisional). H1 and
  energy use a type's R-value if set, else `layeredR` (Σ t/λ + 0.15 surfaces; core h1.ts `constructionR`).
- Rebar sets get bar marks (S/W/B/C/F + n), optional cogged ends on slab/pad mats (12d towards the other face), and laps:
  runs over the stock length (12 m default) split into pieces lapping 40d (`rebarBars` → `lapped`; provisional).
- Autosave (apps/desktop/src/autosave.ts): every 3 min while dirty (not in the family editor) the project goes to IndexedDB;
  Save clears it; at start-up a leftover autosave prompts "Recover it?" (loads it, marked unsaved).
