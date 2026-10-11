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

## Session tips
- Run /mcp first to check context7 and playwright are connected.
- Claude Pro has usage limits that reset every few hours: do one feature per session, check it with
  `npm run tauri dev`, then start the next feature fresh.
- End each session by updating the "Current state" section below and pushing to GitHub.

## Current state (update at the end of each session)
- Phase 0 done except CI green (runs on Windows via `npm run tauri dev`).
- Working: levels, wall/floor types with layers, walls, floors, undo/redo, regeneration,
  3D viewport (middle = pan, right = orbit, wheel = zoom), wall tool (W) with grid/ortho/endpoint snap,
  select + delete, properties panel, project browser, save/open `.obim`,
  automatic wall joins (L/T/X mitres, tee stems stop at face; `core/model/joins.ts`, `geometry/src/joins.ts`),
  grids (G tool, auto-named, unique names, drawn on the active level; walls snap to grid lines/intersections).
- Known gaps: joins are whole-wall (no per-layer cleanup); no "disallow join"; walls crossing
  mid-span overlap; very acute mitres are squared off; no wall attach top/base; no 2D views;
  grids are straight only (no arc/multi-segment), no bubble on/off per end, can't drag grid ends.
- Next: Phase 1 — reference planes, then floor sketch tool, then OpenCascade kernel + doors/windows.
