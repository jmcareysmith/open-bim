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

## Phase 3 — Families & parameters (current)
- [x] Family editor: reference planes, sketches, extrude/revolve/sweep/blend/void — profiles editable as formula points; no graphical profile editing after creation yet
- [x] 2D constraint solver (dimensions drive geometry) — PlaneGCS adopted: labelled + EQ dimensions flex reference planes; forms follow planes by name. Sketch-level locks/angles later
- [x] Formulas, conditionals, type catalogs, nested/shared families — nested with parameter associations; "shared" nested (scheduled separately) later
- [ ] Project, shared and global parameters
- [ ] Family library (doors, windows, furniture) in an open format

## Phase 4 — Data & documentation
- Rooms, areas, area plans
- Tags, keynotes, legends
- Schedules + material takeoffs, CSV/XLSX export
- Revisions, groups
- Plugin API + scripting console

## Phase 5 — Interoperability
- IFC4 export, then import (web-ifc; IfcOpenShell if needed)
- DXF/DWG import & export
- Shared coordinates, links
- glTF/OBJ export

## Phase 6 — Advanced modelling
- Stairs, railings, ramps
- Curtain walls
- Stacked walls
- Toposolids & site
- Structural columns, beams, foundations
- Phasing, design options, clash detection

## Phase 7 — Collaboration, rendering, NZ tools
- CRDT document model (Yjs/Automerge) for multi-user editing
- Cloud sync
- Realistic rendering + AI render
- NZ H1 compliance and NZS 3604 bracing modules

## Phase 8 — MEP & visual programming
## Phase 9 — Analysis, rebar, point clouds
