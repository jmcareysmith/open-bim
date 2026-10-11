# Roadmap

Each phase ends with something usable. Work one feature per session; tick items off in
`REVIT_FEATURE_MAP.md` as they land.

## Phase 0 — Foundations (current)
- [x] Monorepo: `packages/core`, `packages/geometry`, `apps/desktop` (Tauri 2 + Vite + TS)
- [x] Element store with stable IDs, categories, types/instances, parameters
- [x] Transactions with undo/redo
- [x] Levels and basic walls (with wall types and layers)
- [x] Regeneration: changing a level's elevation moves its walls
- [x] Geometry kernel interface + simple extrusion kernel
- [x] three.js 3D viewport with orbit controls
- [x] Save/load project as JSON (`.obim`)
- [ ] Run on Windows PC via `npm run tauri dev`
- [ ] App icon + CI (GitHub Actions: tests + build)

## Phase 1 — Architectural modelling
- Wall drawing tool (click-click in plan/3D work plane), snapping, ortho
- Wall joins (L, T, X) with mitred layers
- Grids, reference planes
- Floors and ceilings from sketch boundary (polygon with holes)
- Roofs by footprint with per-edge slope
- OpenCascade (opencascade.js) kernel: booleans for openings
- Doors and windows hosted in walls, cutting openings
- Selection, properties panel, type selector, temporary hide/isolate
- Project units & settings

## Phase 2 — Views & drawing production
- View system: each view = camera + view range + visibility rules + detail level
- Floor plans via cut plane + hidden-line removal (OCCT HLR) → 2D vector
- Sections, elevations, callouts
- Detail lines, filled regions, text, dimensions (live, associative)
- Materials with cut/surface patterns
- Visibility/Graphics, filters, view templates
- Sheets, title blocks, viewports, vector PDF export

## Phase 3 — Families & parameters
- Family editor: reference planes, sketches, extrude/revolve/sweep/blend/void
- 2D constraint solver (dimensions drive geometry) — evaluate PlaneGCS (FreeCAD's solver) compiled to WASM
- Formulas, conditionals, type catalogs, nested/shared families
- Project, shared and global parameters
- Family library (doors, windows, furniture) in an open format

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
