# Roadmap

Each phase ends with something usable. Work one feature per session; tick items off in
`REVIT_FEATURE_MAP.md` as they land.

## Phase 0 — Foundations
- [x] Monorepo: `packages/core`, `packages/geometry`, `apps/desktop` (Tauri 2 + Vite + TS)
- [x] Element store with stable IDs, categories, types/instances, parameters
- [x] Transactions with undo/redo
- [x] Levels and basic walls (with wall types and layers)
- [x] Regeneration: changing a level's elevation moves its walls
- [x] Geometry kernel interface + simple extrusion kernel
- [x] three.js 3D viewport with orbit controls
- [x] Save/load project as JSON (`.obim`)
- [x] Run on Windows PC via `npm run tauri dev`
- [x] App icon + CI (GitHub Actions: tests + build) — typecheck, tests, web build on Ubuntu; Tauri build on Windows

## Phase 1 — Architectural modelling (done)
- [x] Wall drawing tool (click-click in plan/3D work plane), snapping, ortho — plan is a clipped top-down view; true 2D plans in Phase 2
- [x] Wall joins (L, T, X) — whole-wall mitres; per-layer cleanup comes with layered geometry
- [x] Grids — straight; arc and multi-segment grids later
- [x] Reference planes
- [x] Floors and ceilings from sketch boundary (polygon with holes) — no "pick walls" or slope arrows yet
- [x] Roofs by footprint with per-edge slope — walls don't attach to roofs yet; complex footprints approximate
- [x] OpenCascade (opencascade.js) kernel: booleans for openings — wall openings; floor/roof openings later
- [x] Doors and windows hosted in walls, cutting openings — parametric types; loadable families in Phase 3
- [x] Selection, properties panel, type selector, temporary hide/isolate
- [x] Project units & settings

## Phase 2 — Views & drawing production (done)
- [x] View system: each view = camera + view range + visibility rules + detail level — 3D camera not yet saved per view
- [x] Floor plans via cut plane + hidden-line removal → 2D vector — exact mesh-based HLR (not OCCT); line weights come with materials
- [x] Sections, elevations, callouts — straight sections only (no jogs); callouts of floor plans
- [x] Detail lines, filled regions, text, dimensions (live, associative) — aligned dims in plans (sections: levels via API); no leaders yet
- [x] Materials with cut/surface patterns — graphics only; appearance (textures) and thermal properties later
- [x] Visibility/Graphics, filters, view templates — visible / halftone / line colour overrides; no line weights or patterns overrides yet
- [x] Sheets, title blocks, viewports, vector PDF export — built-in title block; no 3D viewports or schedules on sheets yet

## Phase 3 — Families & parameters (done)
- [x] Family editor: reference planes, sketches, extrude/revolve/sweep/blend/void — profiles editable as formula points; no graphical profile editing after creation yet
- [x] 2D constraint solver (dimensions drive geometry) — PlaneGCS adopted: labelled + EQ dimensions flex reference planes; forms follow planes by name. Sketch-level locks/angles later
- [x] Formulas, conditionals, type catalogs, nested/shared families — nested with parameter associations; "shared" nested (scheduled separately) later
- [x] Project, shared and global parameters — shared parameters for projects (family shared params later); not yet in schedules (Phase 4)
- [x] Family library (doors, windows, furniture) in an open format — `packages/library`, `.obim-family` JSON files

## Phase 4 — Data & documentation (done)
- [x] Rooms, areas, area plans — room separators, room bounding; GFA/NLA area schemes, boundaries from walls
- [x] Tags, keynotes, legends — tag by category, keynote files/tags, legend views with type swatches and keynote legends
- [x] Schedules + material takeoffs, CSV/XLSX export — not yet on sheets; no calculated fields or in-table editing
- [x] Revisions, groups — model groups (place copies, apply to all instances); detail groups later
- [x] Plugin API + scripting console — JS plugins (ES modules) and console; see docs/PLUGINS.md

## Phase 5 — Interoperability (done)
- [x] IFC4 export, then import (web-ifc; IfcOpenShell if needed) — import as DirectShapes (no conversion to native walls yet)
- [x] DXF/DWG import & export — DXF (R12) export of views/sheets and import into a view; DWG (desktop) through an installed converter — ODA File Converter or LibreDWG CLI — so no DWG library is linked
- [x] Shared coordinates, links — NZTM2000 location, IFC map conversion; .obim links (one colour, not scheduled)
- [x] glTF/OBJ export — .glb (node per element, metres Y-up) and zipped OBJ + MTL

## Phase 6 — Advanced modelling (done)
- [x] Stairs, railings, ramps — straight runs with landings (no winders/curved runs yet); D1/AS1, F4/AS1, NZS 4121 checks
- [x] Curtain walls — wall types with a curtain grid (equal divisions, mullions, glazed panels); no per-panel editing yet
- [x] Stacked walls — member wall types bottom to top, one variable segment
- [x] Toposolids & site — spot heights (survey CSV via shared coordinates), Delaunay surface, contours; no pads/sub-regions yet
- [x] Structural columns, beams, foundations — section types (rect/circle/I/SHS), pads, strips; no analytical model or beam plan symbols yet
- [x] Phasing, design options, clash detection — phase filters, option sets, OCCT volume clashes

## Phase 7 — Collaboration, rendering, NZ tools (done)
- [x] CRDT document model (Yjs) for multi-user editing — per-param merge, remote edits kept out of local undo, orphan repair, presence
- [x] Cloud sync — self-hosted sync server (`packages/collab`, rooms saved to disk, shared access token); no accounts or hosted service yet
- [x] Realistic rendering — progressive GPU path tracer (three-gpu-pathtracer) of the 3D view; sun for the site, date and time; glass; material roughness/metalness/transparency; Save PNG
- [x] AI render — img2img from the path-traced render: self-hosted (Stable Diffusion WebUI API: AUTOMATIC1111/Forge) or Gemini with the user's own API key
- [x] NZ H1 compliance — schedule method: construction R-values on types, climate zones, glazing limit (provisional minimums, editable per project)
- [x] NZS 3604 bracing module — panels on walls, automatic bracing lines per storey/direction, wind + EQ demand (provisional estimate or tabulated override), line minimum and spacing checks

## Phase 7a — Close known gaps (done)
- [x] Modify tools: Move, Copy, Rotate, Mirror, Array (MV, CO, RO, MM, AR) — hosted elements follow their hosts; moved walls drag joined walls (Disjoin to stop); typed distance/angle; mirror by drawn axis (no pick-axis yet); linear arrays in the UI (radial in the API)
- [x] Align, Offset, Trim/Extend, Split (walls, lines, beams, grids) — align to wall faces/centrelines, grids, planes, polygon edges; trim to corner or to a boundary (multiple); doors kept in place or refused if cut; plans/3D only
- [x] Drag to edit: grips on wall/line/datum ends, drag to move, temporary dimensions (click to type) — also sketch vertices, stair run ends, door slide, point elements; plans and sections/sheets (annotations); joined wall corners follow
- [x] Walls attach top/base to floors, ceilings and roofs — tops follow sloped roof undersides (kinks at ridges/hips), floor/ceiling undersides; bases to a floor's top; detach restores own height
- [x] Wall joins: per-layer cleanup, disallow join, clean crossing (X) walls
- [x] Floors: pick walls (with offset), slope arrows
- [x] 3D views save their camera; perspective camera views
- [x] Schedules on sheets; calculated fields
- [x] Beam plan symbols (dashed centre lines at Coarse/Medium)
- [x] Annotation symbols — north arrow (up or true north), graphic scale bar, break line; views and sheets; paper-sized
- [x] Detail components — "Detail Item" families (detail lines + filled regions in one plan view), placed per view with rotation/mirror; library: timber sections, concrete block, steel angle. Not parametric yet (fixed size per family)
- [x] View marker families — "View Marker" family category (elevation mark, section head/tail, callout head; paper size, {n}/{name}/{sheet} text); picked per view in Properties; library styles
- [x] Override Graphics in View — by element/category (right-click; by filter via V/G): visible, halftone, transparency, projection/cut lines (pattern, colour, weight), surface/cut patterns (foreground/background: visible, pattern, colour). Weights show in PDF only (screen lines are 1 px)
- [x] Detail groups — one view's detail lines, regions, text, symbols, detail components and clouds; place copies in any plan/section/elevation
- [x] Find/Replace and Check Spelling for text notes (Annotate → Text)
- [x] Fold the interactive viewport onto `viewDrawing` (one drawing path for screen and sheet/PDF) — cut/projection line work shared (`lineworkDrawing`); datums/annotations on screen still from `buildLines`

## Phase 7b — Revit-style interface (done)
- [x] Ribbon: tabs and labelled panels, split-button dropdowns, contextual Modify tab, options bar — Architecture/Structure/Insert/Annotate/Massing & Site/Analyse/Collaborate/View/Manage/Modify (+ Create in the family editor); own line icons; "Modify | <category>" label
- [x] File menu (New, Open, Save, Export ▸, Import ▸, recent files) and Quick Access Toolbar
- [x] Drag and drop from the Project Browser: views/schedules/legends onto sheets, families into views
- [x] Dockable panels (Properties, Project Browser): dock, tab, float, collapse; layout remembered — drag titles/tabs; dock widths resizable; light theme (Jeremy: no dark chrome)
- [x] View tabs (tile/cascade), status bar with selection filter, view control bar (scale, detail level, visual style, hide/isolate) — done: open-view tabs along the bottom (close, close others), view control bar (scale, detail level, Wireframe/Hidden Line/Shaded/Consistent Colours/Realistic/Rendered, temporary hide/isolate, reveal hidden); collapsible browser groups; status-bar selection filter (⧩ count → category filter); Tile/Cascade/Tab Views (WT/WC/TW; live pane per open view)
- [x] Right-click menus (Select All Instances, Edit Type, Hide in View…), two-letter shortcuts, shortcut editor — menus done (element: modify tools, Flip, Edit Type, Select All Instances, hide/isolate, V/G, Group, Delete; empty space: V/G dialog, Zoom to Fit, Reset); two-letter shortcuts; Keyboard Shortcuts editor (KS or File menu; saved per machine)

## Phase 8 — MEP & visual programming (current)
- [x] Connectors and MEP systems (supply/return air, cold/hot water, sanitary, power); system browser
- [x] Ducts with auto fittings (elbows, tees, transitions), round/rectangular types, sizing from airflow
- [ ] Pipes with auto fittings, falls on waste pipes, pipe materials
- [ ] Mechanical equipment and air terminals (library families with connectors)
- [ ] Plumbing fixtures and drainage; G13/AS1 discharge units, pipe size and fall checks
- [ ] Electrical: fixtures and devices, circuits, switchboard schedules with load totals
- [ ] Cable tray and conduit
- [ ] MEP display (single-line at Coarse, plan symbols), MEP in schedules and clash checks
- [ ] Visual programming engine: node graphs with incremental re-run, saved in the project
- [ ] Node editor and node library (selection, parameters, geometry, maths/lists, element creation)

## Phase 9 — Analysis, rebar, point clouds
