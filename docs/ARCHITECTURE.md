# Architecture

## Goals
- Revit-class BIM authoring, fully open source.
- Data-first: the model is a database of elements; geometry and drawings are *derived*.
- Core logic has no UI or platform dependencies, so it can run in the desktop app,
  a browser, a test runner, or a headless server.

## Layers

```
apps/desktop (Tauri 2)
 ├─ src/            UI: viewport, panels, tools  (TypeScript, three.js)
 └─ src-tauri/      Native shell: file IO, menus, OS integration (Rust)
        │
packages/ifc        IFC4 export (hand-written STEP) and import (web-ifc)
        │
packages/library    Built-in parametric families (written against the core family API)
        │
packages/geometry   Kernel interface + implementations → mesh/edge data
        │
packages/core       Document, elements, parameters, transactions, regeneration
```

Dependencies only point downward. `core` never imports `geometry`; `geometry` never imports three.js.

## Core concepts (`packages/core`)

**Document** — owns every element, keyed by `ElementId` (UUID string). Single source of truth.

**Element** — `{ id, category, typeId?, params }`. Categories mirror Revit
(`Level`, `Wall`, `WallType`, `Floor`, `Door`, …). Category-specific shape lives in
`params` and is typed through TypeScript interfaces per category.

**Types vs instances** — a type is itself an element (e.g. `WallType` holds layers).
Instances reference it with `typeId`. Changing a type parameter affects all instances.

**Parameters** — plain JSON-serialisable values. Lengths are stored in **millimetres** (number).
Angles in radians. Later: parameter definitions with units, groups, formulas.

**Transactions** — every change goes through `doc.transact(name, fn)`. Inside, edits are
recorded as before/after snapshots per element. Commit pushes onto the undo stack;
an exception rolls back. Undo/redo replays snapshots. Nothing edits the store directly.

**Regeneration** — after each transaction the document computes which elements are
*dirty* (changed directly, or depending on something that changed) and emits a
`changed` event with `{ added, modified, removed, regenerate }`. Dependencies are
declared by each category (e.g. a Wall depends on its base level, top level and type).
The viewport rebuilds geometry only for the `regenerate` set.

Some relationships are spatial rather than stored references — e.g. walls whose ends meet.
A category can declare `related(doc, el)`; regeneration adds one hop of related elements,
evaluated on both the old and new state of each change (so a wall moved away from a corner
still regenerates the wall it left). Related elements never cascade deletes.

**Wall joins** — derived from geometry, not stored (Revit's default auto-join). `wallJoins()`
in core classifies each wall end: *corner* (other wall ends within 1 mm: two = L, three or
more = T/X junction) or *tee* (end lies within another wall's thickness, clear of its ends).
Walls only join if they overlap vertically. `joinedWallFootprint()` in geometry mitres L
corners, stops tee stems at the through wall's face, and splits multi-wall junctions into
wedges; neighbours compute identical cut points so footprints tile with no overlap.

**Sketches** — floor/ceiling (later roof) boundaries are closed loops. `regionFromLoops()` takes the
largest loop as the boundary and the rest as holes; `validateRegion()` rejects self-crossing loops,
holes outside the boundary and overlapping holes, and normalises winding (boundary CCW, holes CW).

**Roofs** — footprint roofs store a CCW boundary and a per-edge slope (radians, or null = gable).
The surface is the lower envelope of the eave planes, each limited to the wedge between the
hip/valley/gable lines at its ends (`roofPlanes`, `roofHeightAt` in core). Exact for convex and
typical L/T/U plans; a full weighted straight skeleton is needed only for split events.
Geometry cuts the footprint along every line where the lowest plane can change, so each convex
cell is one plane, then extrudes the surface by the type thickness (vertical).

**Project settings** — one `ProjectSettings` element per document holds Project Information
(name, number, client, address) and Project Units (length mm/cm/m, area, angle, decimals).
Values stay in mm / radians; units only drive `formatLength`/`parseLength` etc. in the UI. Typed
suffixes override the unit ("2.4m"); inputs never round coarser than 1 mm. Older files without
the element use defaults and get one on demand.

**Annotation** — detail lines, filled regions, text notes and dimensions are view-owned elements
(`viewId`, cascade with the view) in that view's 2D space; the viewport shows them only in their
view. Text sizes are paper mm × view scale. Dimensions store references (wall face / centre,
grid, reference plane, level, or a fixed point) with the pick point; each regeneration projects
the pick onto the reference's current position, so dimensions are live, and referenced elements are
dependencies (moving them regenerates the dimension; deleting them deletes it).

**Materials** — `Material` elements (shading colour, cut pattern, surface pattern). Type layers
reference them by `materialId` (name kept for display and legacy files) and depend on them, so
material edits regenerate instances and used materials can't be deleted. Patterns are line families
(`patterns.ts`): drafting patterns in paper mm × view scale, model patterns at real size. At
Medium/Fine detail, cut regions split into layers (`layerRegions`: layer boundary planes mapped
into the view frame) and get their material's cut pattern; surface patterns are hatched on faces
facing the viewer and hidden with the same exact HLR test. Wall layers: exterior on the wall's
left (draw clockwise, as in Revit); `flipWall` swaps sides and keeps hosted elements in place.

**Visibility/Graphics** — views (and `ViewTemplate`s) carry hidden categories, per-category
overrides (visible / halftone / colour) and applied `ViewFilter`s (category list + AND rules on
name, type name or any parameter; references compare by name). `effectiveGraphics` takes the
template's settings when a view has one; `elementGraphics` resolves category settings, then filters
in priority order (first to set a property wins). Templates aren't view dependencies, so deleting
one just returns its views to their own settings.

**Sheets & PDF** — `Sheet` (number, paper size, title block fields) and `Viewport` (view + centre in
paper mm; a view goes on one sheet). `viewDrawing` turns any plan/callout/section/elevation into 2D
vector primitives (strokes tagged cut/beyond/hatch/surface/annotation/datum/symbol, fills, texts)
honouring V/G, detail level and patterns; `sheetDrawing` lays out the title block and viewports at
view scale; `writePdf` is a dependency-free vector PDF writer (Helvetica, WinAnsi). The sheet display
and the PDF render the same primitives. (The interactive viewport still has its own plan/section
path; folding it onto `viewDrawing` is a later clean-up.)

**Families** — a family is its own `Document` (Revit's family editor): reference level, views,
centre reference planes, `FamilyInfo` (category, hosting, types with values, current type),
`FamilyParameter`s (type/instance, optional formula) and forms (`Extrusion`, `Blend`, `Revolution`,
`Sweep`; solid or void; on an XY/XZ/YZ work plane). Every form coordinate and depth is a `Num` —
a number or a formula (`expr.ts`: arithmetic, comparisons, and/or/not, if(), min/max/round, degree
trig; no eval). `familyValues` evaluates parameters in dependency order. Loading embeds the family
JSON in the project as a `FamilyDef`; `FamilyInstance`s place a type free-standing (level, position,
rotation) or wall-hosted (along, sill, flip; cut = the family's Width × Height). Geometry: forms are
meshed in their plane frames; the OCCT kernel sews them into solids and cuts voids; instance meshes
are cached per family version and parameter values. The desktop app swaps documents (project ⇄
family) keeping each one's undo, view and selection.

**Family constraints** — dimensions between reference planes in a family can carry a `label`
(a parameter) or `equality` (EQ). `planeSystem` turns them into a constraint problem; the solver is
PlaneGCS (FreeCAD's sketcher solver, LGPL, WASM, pinned 1.2.0) behind `setFamilySolver`: each free
plane keeps its direction and only slides along its normal, labels are point-to-line distances, EQ
puts the outer planes' midpoint on the middle one. `enableFamilyFlex` runs the solve as a commit hook
(`Document.addCommitHook`), so flexing joins the edit's undo step and over-constrained edits roll
back. Named planes are formula variables (x of vertical planes, y of horizontal), and
`familyValues` re-solves per type, so instances of every type get their own plane positions.

**Type catalogs & nesting** — `typeCatalogCsv` / `importTypeCatalog` read and write Revit-style
catalogs (`Name##length##millimeters` headers, unit conversion). Families can contain FamilyDefs and
FamilyInstances of other families; a nested instance's `associations` map its parameters to
formulas over the host's, evaluated per host type (`instanceValues(doc, inst, hostValues)`), and
`familyMesh` includes nested instance meshes.

**Family library & files** — `packages/library` builds families in code (`LIBRARY`: doors, windows,
tables, chair, NZ-size beds, base cabinet with a void toe kick, revolved round table), so they are
reviewable and diffable. `familyFile` / `readFamilyFile` wrap a family document as an open
`.obim-family` JSON file (`format: "open-bim-family"`, `version: 1`). Hosted families: X along the
wall, Y across, origin at the opening's bottom centre; a "Default Sill" parameter sets the sill.
The family mesh cache is keyed per kernel, so SimpleKernel and OCCT results never mix.

**Parameters** — `ProjectParameter` (name, data type, categories, instance/type binding, optional
shared GUID) stores values under `params.custom` on the element or its type; filters can test them.
Shared parameter files (Revit's tab-separated *META/*GROUP/*PARAM format) import as project
parameters and export with GUIDs. `GlobalParameter`s (value or formula) drive numeric element
parameters through `params.globals` associations, re-applied by a commit hook in every transaction.
Picking prefers solids under the cursor over line work, and line work over floors/ceilings/roofs.

**Rooms** — a `Room` is a point on a level plus number, upper limit and offsets; its boundary is
derived, never stored: `geometry/src/rooms.ts` subtracts room-bounding walls' joined footprints
(tested at 1200 mm above the room base) and `RoomSeparator` lines (0.02 mm strips) from the plan with
polygon-clipping, and takes the free region containing the point (null when it reaches the outside).
Walls and separators list every room as `related`, so boundaries, areas and tags follow edits.
Rooms and separators are level-scoped (`planLevelOf`): drawn only in plans of their level.

**Area plans** — a `View` of kind `areaPlan` with an `areaScheme` (gross = GFA, rentable = NLA).
`Area`s and `AreaBoundary` lines are owned by the area plan (annotation-style); an area is the
region of its plan's boundary lines around its point. `areaLoopsFromWalls` derives boundaries:
the outside of the wall union (GFA) or the inside face of external walls (NLA, PCNZ).

**Tags** — a `Tag` is view-owned and points at a host (dependency: deleting the host deletes the
tag, moving it regenerates it). Its text is read from the host when drawn (`tagText`: Mark, else type
name; rooms "Name Number"; keynote tags the element's or type's `keynote`), and its position is an
offset from the host's anchor (`elementAnchor`, projected into the view), so tags follow their hosts
in plans, sections and elevations. Tagging a door/window without a Mark numbers it.

**Keynotes** — the keynote table (key, text, parent) lives in `ProjectSettings` and reads/writes
Revit's tab-delimited keynote file. `keynote` keys sit on elements, types and materials; a keynote
tag shows the element's own key, else its type's, else its structure layer material's.

**Legends** — a `View` of kind `legend` holds no model (`is2DView`: drawn in its own 2D space like
sections). `LegendComponent`s draw a type from its current definition (layered swatch with cut
hatches, door/window elevation) and `KeynoteLegend`s tabulate `keynotesInView` for one view or all.
Tags and project settings list keynote legends as `related`, so the tables stay current.

**Schedules** — a `Schedule` element (core) is only a definition: category, field keys, filters,
sort/group levels (header/footer), itemise, grand totals; kind `takeoff` adds a row per layer.
`geometry/src/schedules.ts` holds the field registry (common, per-category, takeoff and project
parameters) and computes a `ScheduleTable` on demand — walls net of openings, roofs by sloped top
area, rooms/areas from their boundaries — keeping model units until display. `tableCsv` and
`tableXlsx` (hand-written OOXML in a stored zip, no dependencies) export it.

**Revisions** — `Revision`s are numbered from their sequence (alphabetic or numeric counted
separately). `RevisionCloud`s are view- or sheet-owned annotation on a revision (issued revisions
are locked). A sheet's revisions are those clouded on it or in its placed views, plus `revisionIds`
added by hand; the title block shows the current revision and a revision schedule.

**Groups** — a `GroupType` plus `Group` instances (origin, rotation). Members are ordinary
elements with `params.groupId`, which `Document` treats as a dependency of any element, so deleting
a group deletes its members. Placing a group copies the source instance's members through a rigid
plan transform (`transformedParams`), remapping host ids; "apply to all" re-copies one instance into
the others. Clicking a member selects its group (Alt+click: the member).

**Plugins & scripting** — `core/src/scripting.ts` runs scripts (`runScript`: expression or
statements, async, with a named scope) and normalises plugin modules (`pluginFromModule`). The
desktop `PluginHost` (`apps/desktop/src/plugins.ts`) builds the version-1 `OpenBimApi` (live doc,
core/geometry exports, selection, views, commands), loads plugin source as a blob-URL ES module,
and keeps loaded plugins in local storage. Plugins are trusted code (like Revit macros). See
`docs/PLUGINS.md`.

**IFC** — `packages/ifc` writes IFC4 STEP itself (`StepWriter`, no dependency): project → site →
building → storeys, elements (IfcWall/Slab/Roof/Covering/Door/Window/Space/Furniture/Proxy) with
triangulated bodies (from the kernel, so OCCT gives cut walls) in storey placements, element types,
material layer sets with surface colours, Pset_*Common + an "Open-BIM" set (Mark, Keynote, project
parameters) and Qto_*BaseQuantities. GlobalIds come from element UUIDs, so re-exports are stable.
Tests re-read the output with web-ifc. Import (`importIfc`, web-ifc loaded on demand) maps
storeys to levels (reusing levels within 1 mm) and every product body to a `DirectShape` (stored
mesh in model mm/Z-up, IFC class, GlobalId, colour, flattened "Pset.Property" values), in one
transaction.

**DXF** — `geometry/src/dxf.ts` writes any `Drawing` (views in model mm, sheets in paper mm) as
R12 ASCII DXF with layers "<Category>-<Kind>", a DASHED linetype and TEXT, and parses DXF line work
(LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC, TEXT/MTEXT, nested INSERTs; $INSUNITS to mm). Imports are
`CadImport` elements owned by one view (Revit's "current view only"), moved by an offset.

**Shared coordinates** — `ProjectSettings.location` (EPSG code, default NZTM2000 2193; eastings,
northings, height in metres; rotation of project north anticlockwise from grid north). `toShared` /
`fromShared` convert; IFC export writes `IfcMapConversion` + `IfcProjectedCRS`, and DXF plans can be
exported in map metres.

**Links** — a `Link` stores the linked project's JSON snapshot plus its path (reload re-reads it),
positioning (origin to origin, or by the two projects' shared coordinates via `linkTransform`),
offset and rotation. `geometry/src/links.ts` builds every linked element with the host's kernel,
merges them (cached per kernel and snapshot) and applies the transform, so links draw in 3D and in
plan cuts. Linked elements are read-only and not scheduled or tagged yet.

**Visualisation export** — `geometry/src/gltf.ts`: `exportParts` builds every element's mesh with
its colour; `exportGlb` writes binary glTF 2.0 (one node per element with id/category extras, a
material per colour, metres Y-up) and `exportObj` writes OBJ + MTL (zipped by the app).

**Stairs** — `Stair` (base/top level + offsets, runs as centrelines) with a `StairType` (max riser,
going, width, waist, landing thickness). `stairLayout` (core) derives risers from the height, splits
them over runs by drawn length (last run takes the rest), builds landings in the arriving run's
frame, and reports NZBC D1/AS1 private-stair checks. Geometry sweeps a sawtooth profile per run and
extrudes landings; the plan symbol is a walking line with an arrow and "UP". `Railing`s follow a
sketched plan path at their level, or a stair side (`hostId` + side) along the nosing line; the
type gives height, rail and baluster sections and the clear gap (NZBC F4/AS1: ≤ 100 mm). New stairs
get railings on both sides. `Ramp`s share the stair run model: the rise is spread over runs by
length (`rampLayout`), runs are sloping slabs, landings come from the shared `landingsBetween`,
and the gradient is checked against 1:12.

**Curtain walls** — a wall type with `curtain` (max grid spacings, mullion/panel sizes and
materials) instead of solid layers (it keeps one layer at mullion depth for joins and footprints).
`geometry/src/curtain.ts` divides the wall equally and builds panels and mullions as boxes with
per-vertex colours (`MeshData.colors`); OCCT skips opening cuts for curtain walls. Stacked wall
types list member wall types bottom to top (`stack`, one variable height) and copy their thickest
member's layers for joins; each segment is the joined footprint narrowed to its own thickness.

**Site** — a `Toposolid` is a boundary plus spot heights (z relative to its level). `core/site.ts`
triangulates them (Bowyer–Watson Delaunay; boundary vertices get inverse-distance heights, triangles
outside the boundary are dropped) and parses survey CSVs (E, N, RL metres) through the shared
coordinates. Geometry adds sides and a flat bottom `thickness` below the lowest point; plans draw
contours by marching the triangles, labelling every fifth.

**Structure** — `StructuralType` sections (rect, circle, I, SHS; NZ defaults created on first use)
for `Column`s (level to level, rotated about their point) and `Beam`s (swept along their line, top
at level + offset). `PadFooting`s are boxes under a point; `StripFooting`s run under a wall (deleted
with it). `elementMaterial` reads a type's or element's `materialId` for colour.

**Phasing** — ordered phases in `ProjectSettings.phases`; phased model elements carry
`phaseCreated` / `phaseDemolished` (no created phase = the last phase). A view's `phase` and
`phaseFilter` (Show All / Complete / New / Previous + Demo) go through `effectiveGraphics` into
`elementGraphics`, which hides or overrides (existing halftone, demolished red) by `phaseStatus`.

**Design options** — option sets live in `ProjectSettings.designOptions` (options, primary);
elements carry `designOption`; views choose per set (`ViewParams.designOptions`, default primary).
`elementGraphics` hides elements of options a view doesn't show. `acceptPrimary` moves the primary's
elements into the main model and deletes the other options' elements.

**Clash detection** — `findClashes` pairs elements of two category sets by overlapping bounding
boxes, skips hosted pairs, and asks the kernel for the shared volume (`OcctKernel.intersectionVolume`:
BRepAlgoAPI_Common + volume properties), so touching elements don't clash; without OCCT it falls back
to the box overlap.

**Modify tools** — `model/modify.ts`: one 2D affine transform (`translation`, `rotationAbout`,
`mirrorAcross`, `compose`) drives Move/Copy/Rotate/Mirror/Array through `transformElements` and
`arrayElements`, with a per-category mapping of the plan points each element stores. Hosted
elements ride on their wall (sliding along it when moved alone); copies bring dependants (doors,
stair railings, strip footings) and remap their host ids; groups move rigidly via `moveGroup` /
`placeGroup`. Mirroring reverses loops (sketches stay counter-clockwise; roof slopes remapped by
`normaliseFootprint`), swaps wall and section-line ends, flips door hands and railing sides. Moving
walls drags joined wall ends (corners and tees) unless `disjoin`. App: `apps/desktop/src/modifytools.ts`.
`model/edits.ts` adds Align / Offset / Trim-Extend / Split on lines (`Line2`): walls offer their
centreline and both faces; trims keep hosted elements in place (shifting positions when the start
moves) and refuse to cut through them; splits move hosted elements past the cut to the new wall.
App: `apps/desktop/src/edittools.ts`.

**Serialisation** — `doc.toJSON()` / `Document.fromJSON()`. Project file `.obim` is
JSON for now; move to SQLite (via Rust) when files get large, keeping the same element schema.

## Geometry (`packages/geometry`)

`GeometryKernel` interface converts elements into `MeshData`
(`positions: Float32Array, indices: Uint32Array, normals`) plus edge data.

- `SimpleKernel`: extrusions of 2D profiles (walls, floors, ceilings, roofs). Fast, synchronous.
- `OcctKernel`: OpenCascade via `replicad-opencascadejs` (a maintained opencascade.js build,
  LGPL, ~23 MB WASM). Builds walls with openings (prism of the joined footprint minus boxes,
  `BRepAlgoAPI_Cut`, meshed with `BRepMesh_IncrementalMesh`) and delegates everything else to
  `SimpleKernel`. Created async (`await OcctKernel.create({ locateFile })`); the desktop app
  starts on `SimpleKernel` and swaps in OCCT when the WASM has loaded. Later: fillets, sweeps,
  hidden-line removal for 2D drawings. Every OCCT object is `delete()`d after use.

**Hosted openings** — `WallOpening` (and later doors/windows) store `hostId`, `position` along
the location line, `width`, `sillHeight`, `height`. They depend on the host (cascade delete)
and list it as `related`, so changing an opening regenerates the wall. `wallCuts()` gives each
wall's cut boxes in wall coordinates; categories opt in with `registerWallCutter(category, resolve)`,
where `resolve` gives the cut size — doors and windows take theirs from `DoorType`/`WindowType`
(parametric for now: frame + leaf/glass; door swings are plan-only `LineData`). Loadable
families replace these in Phase 3.

Element → geometry builders live here (`buildWall`, `buildFloor`…), keyed by category.
Datums (grids, later reference planes) have no solid; `buildLines()` returns `LineData`
(segment pairs + text labels) drawn at z = 0. Datums span every level, so the view
places them — the 3D viewport draws them on the active level's work plane.

**Grids & reference planes** — Datum lines (`datumLines()`); tools snap to both. `Grid` elements hold a plan line; the element name is the grid label and must be
unique. New grids continue the latest series (1→2, A→B, skipping I and O). The wall and grid
tools snap to grid endpoints, intersections and lines.

## Desktop app (`apps/desktop`)

- three.js scene; one `THREE.Object3D` per element, keyed by element id.
- Views are `View` elements (core `viewdefs.ts`): kind (floorPlan | 3d), level, Revit view range
  (top / cut / bottom / depth offsets), scale, detail level, hidden categories. The browser lists
  them; the active view drives the viewport. With nothing selected, Properties shows the view.
- Plan drawings (`planLinework` in geometry): every solid is sliced at the cut plane (loops →
  outline + poché, and caps that hide what's inside cut elements), and feature edges between the
  view depth and the cut are projected with exact hidden-line removal against all triangles below
  the cut (per-edge hidden intervals; uniform grid for candidates). Mesh-based rather than OCCT HLR:
  works for every kernel and is exact for planar faces. Doors/windows use plan symbols instead.
  In plan, solids are hidden (still pickable) and the drawing is shown.
- Sections and elevations: a `ViewFrame` (right / up / view direction) maps meshes into view
  coordinates, then the same `planLinework` runs with the cut at the section line and the far clip
  as depth; results are cropped to the view (`sectionLinework`). Levels and grids are annotated in
  drawing space; plans show section heads, elevation markers and callout boxes (`buildViewMarker`).
  Callouts are cropped plans (extra clip planes). The viewport draws sections/elevations in a
  separate 2D scene ("drawing" mode).
- Two viewport modes share the scene: 3D (perspective, orbit) and Plan (orthographic, top-down, clipped to
  the view's range — view depth up to the cut plane). Tools work the same in both.
- Listens to `doc.on('changed')` and rebuilds only regenerated elements.
- Tools (wall tool, select tool…) are state machines that turn pointer input into transactions.
- Select: click, Shift+click, box select (left→right = fully inside, right→left = crossing).
- Type selector (toolbar) picks the type for the active placing tool, or retypes the selection.
- Temporary hide/isolate (`TemporaryVisibility` in core): per-view, never saved; H / I / Shift+H /
  Shift+I / U, with a cyan viewport border while active (Revit convention).
- Rust side exposes commands for open/save via Tauri plugins (dialog + fs).

## Rendering
- `core/model/solar.ts`: NZTM2000 → latitude/longitude and NOAA sun position; `sunDirection`
  gives the sun in project axes from the project location and rotation (grid convergence ignored).
- `apps/desktop/src/render.ts`: Render (3D view) builds a separate scene from the viewport's visible
  solids (`Viewport.renderMeshes`) and path traces it progressively with three-gpu-pathtracer
  (lazy-loaded): directional sun + gradient sky, ground plane, ACES tone mapping. Meshes flag their
  glazing index range (`MeshData.glass`: windows, curtain panels), split into glass meshes.
  Materials carry optional render appearance (roughness, metalness, transparency).

## NZ compliance
- H1 (`core/model/h1.ts`): schedule method. Envelope types carry a construction R-value
  (`ThermalTypeParams.rValue`, including framing); wall types an exterior/interior function, floor
  types a slab/suspended/intermediate kind (automatic by level and concrete layers when unset).
  `h1Check` compares each envelope type in use with the zone minimum and the glazing share
  (windows + curtain walls over gross exterior wall area) with its limit. Requirements are a
  per-project table (`ProjectSettingsParams.h1`) seeded with provisional H1/AS1 values.
- Bracing (`core/model/bracing.ts`): walls carry NZS 3604 bracing panels (`bracing`: system,
  offset, length); systems are a project table of BU/m ratings (wind, EQ). `bracingCheck` groups
  each storey's walls into lines per direction (within `lineTolerance`), sums capacity, and compares
  with demand: wind = q(zone speed) × Cp × elevation above mid-storey, EQ = coefficient × seismic
  weight above mid-storey, both × 20 BU/kN, unless overridden per storey with NZS 3604 table
  values. Lines must carry max(100 BU, 50% of demand / lines) and be ≤ 6 m apart. All provisional.
- The desktop NZ Checks pane (`apps/desktop/src/nzchecks.ts`) shows the reports.

- AI render (`apps/desktop/src/airender.ts`): sends the render canvas (PNG) with a prompt that
  pins the geometry to an image-to-image model — a self-hosted Stable Diffusion WebUI API
  (`/sdapi/v1/img2img`, run with `--api --cors-allow-origins=*`) by default, or Gemini's
  Interactions API (`gemini-3.1-flash-image`, editable) with the user's own key, kept in
  localStorage. Request building and response parsing are pure and tested with a fake fetch.

## DWG
- `src-tauri/src/cad.rs`: `dwg_to_dxf` / `dxf_to_dwg` commands run an external converter the user
  installs (ODA File Converter, else LibreDWG `dwg2dxf`/`dxf2dwg`; path override remembered in
  localStorage) in a temp folder. The app's DXF parser/writer does the rest. Nothing GPL or
  proprietary is linked, keeping the MIT licence. Browser builds offer DXF only.

## Collaboration (`packages/collab`)
- Multi-user editing binds a `Document` to a Yjs `Y.Doc` (`bindDocument`): a map of element id →
  Y.Map (category, name, typeId, params as a nested Y.Map), so concurrent edits to different params
  of one element merge and the same param resolves last-writer-wins.
- Local transactions (and undo/redo) write into the Y.Doc. Remote updates arrive through
  `doc.applyRemote`, which is not undoable and drops local undo/redo steps touching those elements,
  so undo never overwrites someone else's work. Merges can leave dangling references (one person
  deletes a type another just used); `doc.orphans()` finds them and the binding deletes them.
- `SyncClient` speaks the y-websocket wire protocol (sync + awareness) to the sync server
  (`src/server.ts`, run with `npm run serve -w @open-bim/collab`): one room per project, saved to
  `<room>.ybin`, one shared access token (`OPEN_BIM_TOKEN`). Presence carries name, colour and
  selection. Reconnects with backoff; offline edits are sent on reconnect.
- No per-user accounts, element borrowing or hosted service yet; use TLS (wss://) in front of the
  server when it is exposed to the internet.

## Units & coordinates
- Internal: millimetres, right-handed, **Z up** (Revit convention). three.js scene is
  rotated so Z is up.
- Project base point at origin; shared coordinates added in Phase 5.

## Key decisions
| Decision | Why |
|---|---|
| TypeScript core | Same code in desktop, browser and tests; huge ecosystem; fast iteration. Hot paths can move to Rust/WASM later. |
| OpenCascade for B-rep | Writing a robust solid-modelling kernel is a multi-year project; OCCT is mature and LGPL. |
| JSON snapshots for undo | Simple and correct; optimise to diffs only if profiling demands it. |
| IFC as interchange | Open standard; Revit .rvt is closed. |
| Yjs for multi-user | Mature CRDT, small, works offline; a plain WebSocket relay server is enough, self-hostable. |
| Tauri over Electron | Smaller, faster, Rust backend for heavy native work. |

## Licence
Code: MIT (see LICENSE). Note opencascade.js/OCCT are LGPL-2.1 — fine for dynamic use as WASM.
