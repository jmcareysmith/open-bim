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

## Current state (update at the end of each session)
- Phase 0 done except: first run on Windows (`npm run tauri dev`) and CI green.
- Working: levels, wall/floor types with layers, walls, floors, undo/redo, regeneration,
  3D viewport (middle = pan, right = orbit, wheel = zoom), wall tool (W) with grid/ortho/endpoint snap,
  select + delete, properties panel, project browser, save/open `.obim`.
- Known gaps: walls overlap at corners (no joins yet); no 2D views.
- Next: Phase 1 — wall joins, then grids, then floor sketch tool, then OpenCascade kernel + doors/windows.
