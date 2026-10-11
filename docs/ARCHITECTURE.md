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

**Serialisation** — `doc.toJSON()` / `Document.fromJSON()`. Project file `.obim` is
JSON for now; move to SQLite (via Rust) when files get large, keeping the same element schema.

## Geometry (`packages/geometry`)

`GeometryKernel` interface converts elements into `MeshData`
(`positions: Float32Array, indices: Uint32Array, normals`) plus edge data.

- `SimpleKernel` (now): extrusions of 2D profiles. Enough for straight walls and slabs.
- `OcctKernel` (Phase 1): opencascade.js (WASM) for booleans (openings), fillets,
  sweeps, and hidden-line removal for 2D drawings.

Element → geometry builders live here (`buildWall`, `buildFloor`…), keyed by category.
Datums (grids, later reference planes) have no solid; `buildLines()` returns `LineData`
(segment pairs + text labels) drawn at z = 0. Datums span every level, so the view
places them — the 3D viewport draws them on the active level's work plane.

**Grids & reference planes** — Datum lines (`datumLines()`); tools snap to both. `Grid` elements hold a plan line; the element name is the grid label and must be
unique. New grids continue the latest series (1→2, A→B, skipping I and O). The wall and grid
tools snap to grid endpoints, intersections and lines.

## Desktop app (`apps/desktop`)

- three.js scene; one `THREE.Object3D` per element, keyed by element id.
- Two views share the scene: 3D (perspective, orbit) and Plan (orthographic, top-down, clipped to
  the level's `planViewRange` — level to 1200 mm cut plane). Tools work the same in both.
- Listens to `doc.on('changed')` and rebuilds only regenerated elements.
- Tools (wall tool, select tool…) are state machines that turn pointer input into transactions.
- Rust side exposes commands for open/save via Tauri plugins (dialog + fs).

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
| Tauri over Electron | Smaller, faster, Rust backend for heavy native work. |

## Licence
Code: MIT (see LICENSE). Note opencascade.js/OCCT are LGPL-2.1 — fine for dynamic use as WASM.
