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
- Phase 0 done except CI green (runs on Windows via `npm run tauri dev`). Phases 1 and 2 done.
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
- Known gaps: joins whole-wall (no per-layer cleanup), no disallow-join, crossing walls overlap; walls
  don't attach to floors/roofs; grids straight only, no grip editing (no drag-to-edit anywhere yet);
  floors lack pick-walls/slope arrows; roofs exact for convex/L/T/U only; doors/windows parametric;
  dimensions only in plans via the tool; no 3D view camera saved per view; viewport (interactive)
  and sheet/PDF drawing paths are separate (fold the viewport onto `viewDrawing` later).
- Families (Phase 3 started): family editor (Browser → Families → New family / Edit family) with
  Extrusion/Blend/Revolve/Sweep (+ Void), parameters with formulas, family types; Load into Project;
  Component tool (C) places them (free-standing, or in walls for Door/Window families).
- Next: Phase 3 — 2D constraint solver (evaluate PlaneGCS), then type catalogs / nested families,
  project/shared/global parameters, family library.
