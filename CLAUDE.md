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
  grids (G tool, auto-named, unique names, drawn on the active level; walls snap to grid lines/intersections),
  reference planes (R tool, dashed green, optional unique name), plan view per level (clipped at 1200 mm cut),
  floor + ceiling sketch tools (loops → boundary + holes, validated; Edit boundary re-sketches),
  footprint roofs (Roof tool; per-edge slope or gable in properties; sample has a hipped roof),
  OpenCascade kernel (loads async; cuts wall openings), Opening tool (click a wall),
  doors (D) and windows (N): parametric types, hosted, cut walls, door swing in plan, flip facing/hand,
  box select, toolbar type selector (per tool / retype selection), temporary hide/isolate (H, I, Shift+H/I, U),
  project information + units (browser → Project; mm/cm/m, typed suffixes like "2.4m").
- Phase 1 done (all roadmap items ticked; see notes on each for what's deferred).
- Known gaps: joins are whole-wall (no per-layer cleanup); no "disallow join"; walls crossing
  mid-span overlap; very acute mitres are squared off; walls don't attach to floors/roofs; plan is a
  clipped 3D view, not true 2D; grids straight only, no bubble toggles, no grip editing (drag ends);
  floors have no "pick walls" / slope arrows; roofs exact only for convex/L/T/U footprints;
  doors/windows are parametric (no families); grids drawn over walls win picks (no Tab-cycling).
- Views are elements (floor plan per level + {3D}); view properties show when nothing is selected.
- Next: Phase 2 — true 2D floor plans (cut + projection linework, OCCT HLR), then sections/elevations.
