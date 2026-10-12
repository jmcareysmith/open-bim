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
- [ ] App icon + CI (GitHub Actions: tests + build)

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
- [x] DXF/DWG import & export — DXF (R12) export of views/sheets and import into a view; DWG pending a licence decision
- [x] Shared coordinates, links — NZTM2000 location, IFC map conversion; .obim links (one colour, not scheduled)
- [x] glTF/OBJ export — .glb (node per element, metres Y-up) and zipped OBJ + MTL

## Phase 6 — Advanced modelling (done)
- [x] Stairs, railings, ramps — straight runs with landings (no winders/curved runs yet); D1/AS1, F4/AS1, NZS 4121 checks
- [x] Curtain walls — wall types with a curtain grid (equal divisions, mullions, glazed panels); no per-panel editing yet
- [x] Stacked walls — member wall types bottom to top, one variable segment
- [x] Toposolids & site — spot heights (survey CSV via shared coordinates), Delaunay surface, contours; no pads/sub-regions yet
- [x] Structural columns, beams, foundations — section types (rect/circle/I/SHS), pads, strips; no analytical model or beam plan symbols yet
- [x] Phasing, design options, clash detection — phase filters, option sets, OCCT volume clashes

## Phase 7 — Collaboration, rendering, NZ tools (current)
- [x] CRDT document model (Yjs) for multi-user editing — per-param merge, remote edits kept out of local undo, orphan repair, presence
- [x] Cloud sync — self-hosted sync server (`packages/collab`, rooms saved to disk, shared access token); no accounts or hosted service yet
- [x] Realistic rendering — progressive GPU path tracer (three-gpu-pathtracer) of the 3D view; sun for the site, date and time; glass; material roughness/metalness/transparency; Save PNG
- [x] AI render — img2img from the path-traced render: self-hosted (Stable Diffusion WebUI API: AUTOMATIC1111/Forge) or Gemini with the user's own API key
- [x] NZ H1 compliance — schedule method: construction R-values on types, climate zones, glazing limit (provisional minimums, editable per project)
- [x] NZS 3604 bracing module — panels on walls, automatic bracing lines per storey/direction, wind + EQ demand (provisional estimate or tabulated override), line minimum and spacing checks

## Phase 8 — MEP & visual programming
## Phase 9 — Analysis, rebar, point clouds
