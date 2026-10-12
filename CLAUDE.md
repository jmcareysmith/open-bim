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
- Phase 0 done except CI green (runs on Windows via `npm run tauri dev`). Phases 1–4 done.
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
- Family constraints: label a dimension between reference planes with a parameter, or set EQ;
  planes flex (PlaneGCS) on every edit; forms use plane names in formulas (e.g. x = Left).
- Type catalogs (import/export CSV in Family Types); nested families (Load from project → Component,
  associate parameters with host formulas).
- Parameters: project parameters (per category, instance/type), shared parameter files, global
  parameters driving element values (browser → Parameters; element properties).
- Family library: Browser → Families → Load from library (`packages/library`) or Load family file;
  family editor → Save Family File (`.obim-family`, open JSON).
- Rooms (Room / Separator tools, plans) and area plans (browser → New area plan; GFA/NLA,
  boundaries from walls; Area / Area Boundary tools).
- Tags (Tag / Keynote tools; Mark property), keynote table (browser → Project → Load keynotes),
  legends (Views → New legend; add components / keynote legend in its properties).
- Schedules/Quantities and material takeoffs (browser → Schedules; fields, filter, sort/group,
  totals; Export CSV / Excel). Not yet placeable on sheets; no calculated fields.
- Revisions (browser → Revisions; Cloud tool; sheet revision schedule) and model groups (Group /
  Ctrl+G; Place copy; Apply to other instances; Ungroup).
- Plugins + scripting console (toolbar Console or `; docs/PLUGINS.md, examples/plugins).
- IFC: Export IFC (IFC4, packages/ifc) and Import IFC (web-ifc → DirectShapes on matching levels).
- DXF: Export DXF (open view/sheet) and Import DXF (into the open view as a CadImport). DWG not done
  (needs a licence decision: LibreDWG is GPL; ODA is proprietary).
- Next: Phase 5 — shared coordinates/links, then glTF/OBJ.
