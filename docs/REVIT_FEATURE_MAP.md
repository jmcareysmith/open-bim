# Revit Feature Map

Everything Revit does, grouped by area, with the Open-BIM phase that delivers it.
Status: ⬜ not started · 🟨 in progress · ✅ done

## 1. Core model
| Feature | Phase | Status |
|---|---|---|
| Element database with stable IDs | 0 | 🟨 |
| Element categories (Walls, Floors, Doors…) | 0 | 🟨 |
| Types vs instances (type parameters / instance parameters) | 0 | 🟨 |
| Transactions, undo/redo | 0 | 🟨 |
| Regeneration (change a level → hosted elements update) | 0–1 | 🟨 |
| Project units & settings | 1 | ✅ |
| Shared coordinates, project base point, survey point, true north | 5 | 🟨 |
| Phasing (existing / new / demolished, phase filters) | 6 | ✅ |
| Design options | 6 | ✅ |
| Groups (model & detail) | 4 | 🟨 |
| Links (linked models) | 5 | 🟨 |

## 2. Datums
| Feature | Phase | Status |
|---|---|---|
| Levels | 0 | 🟨 |
| Grids | 1 | 🟨 |
| Reference planes | 1 | ✅ |
| Scope boxes | 2 | ⬜ |

## 3. Architectural modelling
| Feature | Phase | Status |
|---|---|---|
| Basic walls (layered compound structure) | 0–1 | 🟨 |
| Wall joins, cleanup, wall attach top/base | 1 | 🟨 |
| Stacked walls | 6 | ✅ |
| Curtain walls, grids, mullions, panels | 6 | 🟨 |
| Floors (sketch-based, layered, slope arrows) | 1 | 🟨 |
| Roofs (footprint, extrusion, slopes, fascia/gutter) | 1 | 🟨 |
| Ceilings | 1 | 🟨 |
| Doors & windows (hosted, cut openings) | 1 | 🟨 |
| Openings (shaft, wall, vertical) | 1 | 🟨 |
| Stairs (run, landing, sketch) & railings | 6 | ✅ |
| Ramps | 6 | ✅ |
| Components / furniture (loadable families) | 3 | ✅ |
| Model in-place | 3 | ⬜ |
| Rooms, room separation, room bounding | 4 | ✅ |
| Areas & area plans (GFA, NLA) | 4 | ✅ |
| Toposolid / topography, building pads, site components | 6 | 🟨 |

## 4. Structural
| Feature | Phase | Status |
|---|---|---|
| Structural columns, beams, braces | 6 | 🟨 |
| Foundations (isolated, strip, slab) | 6 | 🟨 |
| Structural framing systems | 6 | ⬜ |
| Rebar | 9 | ⬜ |
| Analytical model | 9 | ⬜ |

## 5. MEP
| Feature | Phase | Status |
|---|---|---|
| Ducts, pipes, fittings, routing | 8 | ⬜ |
| Systems (supply, return, sanitary…) | 8 | ⬜ |
| Electrical circuits, panels, cable trays, conduit | 8 | ⬜ |
| Fixtures & equipment | 8 | ⬜ |
| Sizing & pressure-loss calcs | 9 | ⬜ |

## 6. Families & parameters
| Feature | Phase | Status |
|---|---|---|
| System families (walls, floors, roofs) | 1 | ⬜ |
| Loadable family editor (sketch, extrude, revolve, sweep, blend, void) | 3 | 🟨 |
| Reference planes + dimension constraints (parametric solver) | 3 | 🟨 |
| Formulas & conditionals in parameters | 3 | ✅ |
| Nested & shared families | 3 | 🟨 |
| Type catalogs | 3 | ✅ |
| Family library (open `.obim-family` format; doors, windows, furniture, casework) | 3 | ✅ |
| Shared parameters, project parameters, global parameters | 3 | ✅ |
| Family visibility (detail level, view direction) | 3 | ⬜ |

## 7. Views
| Feature | Phase | Status |
|---|---|---|
| 3D view (orbit, pan, zoom, section box) | 0–1 | 🟨 |
| Floor plans (cut plane, view range) | 2 | ✅ |
| Reflected ceiling plans | 2 | ⬜ |
| Elevations | 2 | ✅ |
| Sections & callouts | 2 | 🟨 |
| Drafting views | 2 | ⬜ |
| Legends | 4 | ✅ |
| Detail levels (coarse/medium/fine) | 2 | 🟨 |
| Visibility/Graphics overrides, filters | 2 | 🟨 |
| View templates | 2 | ✅ |
| Hidden-line, shaded, realistic styles | 2 | 🟨 |
| Camera / perspective views | 2 | ⬜ |
| Temporary hide/isolate | 1 | ✅ |

## 8. Annotation & documentation
| Feature | Phase | Status |
|---|---|---|
| Dimensions (aligned, linear, angular, radial, spot) | 2 | 🟨 |
| Text, leaders | 2 | 🟨 |
| Tags (by category, multi-category, material) | 4 | 🟨 |
| Keynotes | 4 | ✅ |
| Detail lines, filled regions, detail components, insulation | 2 | 🟨 |
| Symbols, north arrow, section/elevation heads | 2 | ⬜ |
| Revision clouds & revisions | 4 | ✅ |
| Sheets, title blocks, viewports | 2 | 🟨 |
| Print / PDF export (vector) | 2 | ✅ |

## 9. Schedules & data
| Feature | Phase | Status |
|---|---|---|
| Schedules (fields, filters, sorting, grouping, totals) | 4 | ✅ |
| Calculated fields | 4 | ⬜ |
| Material takeoffs | 4 | ✅ |
| Key schedules | 4 | ⬜ |
| Schedule export (CSV / XLSX) | 4 | ✅ |

## 10. Materials & visualisation
| Feature | Phase | Status |
|---|---|---|
| Materials (graphics, appearance, physical, thermal) | 2 | 🟨 |
| Surface / cut patterns | 2 | ✅ |
| Realistic rendering | 7 | ⬜ |
| AI render (Gemini-style) | 7 | ⬜ |
| Sun & shadow studies | 7 | ⬜ |

## 11. Interoperability
| Feature | Phase | Status |
|---|---|---|
| Native project file (.obim) save/open | 0–1 | 🟨 |
| IFC export (IFC4 / IFC4x3) | 5 | 🟨 |
| IFC import | 5 | 🟨 |
| DWG/DXF import & export | 5 | 🟨 |
| PDF / image underlays | 5 | ⬜ |
| Point clouds | 9 | ⬜ |
| glTF / OBJ export | 5 | ✅ |
| Revit .rvt import | — | Not feasible (closed format); use IFC |

## 12. Collaboration
| Feature | Phase | Status |
|---|---|---|
| Multi-user editing (worksharing equivalent, CRDT based) | 7 | ⬜ |
| Element borrowing / ownership | 7 | ⬜ |
| Cloud sync | 7 | ⬜ |
| Clash detection / interference check | 6 | ✅ |

## 13. Analysis
| Feature | Phase | Status |
|---|---|---|
| Energy analysis | 9 | ⬜ |
| NZ H1 compliance (R-values, schedule method) | 7 | ⬜ |
| NZS 3604 bracing | 7 | ⬜ |
| Structural analysis export | 9 | ⬜ |

## 14. Extensibility
| Feature | Phase | Status |
|---|---|---|
| Plugin API (TypeScript) | 4 | ✅ |
| Scripting console | 4 | ✅ |
| Visual programming (Dynamo equivalent) | 8 | ⬜ |
| Add-in manager | 4 | 🟨 |
