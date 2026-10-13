import { SCHEDULE_CATEGORIES, SYMBOL_KINDS, TAKEOFF_CATEGORIES, type SymbolKind } from "@open-bim/core";
import type { MenuItem } from "./dialog.ts";
import type { RibbonItem, RibbonTab } from "./ribbon.ts";

// What's on each ribbon tab (Revit's layout, Open-BIM's tools). Tools/commands by name.

export interface RibbonMenus {
  libraryFamilies(): { name: string; category: string }[];
  loadLibraryFamily(name: string): void;
  newSchedule(category: string, kind: "schedule" | "takeoff"): void;
  cmd(name: string): void;
  placeSymbol(kind: SymbolKind): void;
  detailFamilies(): { id: string; name: string }[];
  libraryDetailItems(): string[];
  placeDetail(familyId: string): void;
  loadDetail(name: string): void;
}

export function ribbonTabs(m: RibbonMenus, voidToggle: () => HTMLElement): RibbonTab[] {
  const scheduleMenu = (kind: "schedule" | "takeoff"): MenuItem[] => [
    { heading: kind === "schedule" ? "New schedule of…" : "New material takeoff of…" },
    ...SCHEDULE_CATEGORIES.filter(([c]) => kind === "schedule" || TAKEOFF_CATEGORIES.has(c)).map(([c, label]) => ({ label, action: () => m.newSchedule(c, kind) })),
  ];
  const libraryMenu = (): MenuItem[] => {
    const fams = m.libraryFamilies();
    const out: MenuItem[] = [];
    for (const cat of [...new Set(fams.map((f) => f.category))]) {
      out.push({ heading: cat });
      for (const f of fams.filter((x) => x.category === cat)) out.push({ label: f.name, action: () => m.loadLibraryFamily(f.name) });
    }
    return out;
  };

  const modify: RibbonItem[] = [
    { label: "Move", icon: "move", tool: "move", title: "Move (MV)" },
    { label: "Copy", icon: "copy", tool: "copy", title: "Copy (CO)" },
    { label: "Rotate", icon: "rotate", tool: "rotate", title: "Rotate (RO)" },
    { label: "Mirror", icon: "mirror", tool: "mirror", title: "Mirror — draw axis (MM)" },
    { label: "Array", icon: "array", tool: "array", title: "Array (AR)" },
    { label: "Delete", icon: "delete", cmd: "delete", title: "Delete the selection (Del)" },
    { label: "Align", icon: "align", tool: "align", title: "Align (AL)" },
    { label: "Offset", icon: "offset", tool: "offset", title: "Offset (OF)" },
    { label: "Trim/Extend", icon: "trim", tool: "trim", title: "Trim/Extend (TR)" },
    { label: "Split", icon: "split", tool: "split", title: "Split element (SL)" },
  ];

  return [
    {
      id: "create",
      label: "Create",
      mode: "family",
      panels: [
        {
          title: "Forms",
          items: [
            { label: "Extrusion", icon: "extrusion", tool: "extrusion", large: true, title: "Sketch a profile (plan = XY, Front = XZ, Right = YZ), Enter" },
            { label: "Blend", icon: "blend", tool: "blend", large: true, title: "Sketch the bottom loop, then the top loop, Enter" },
            { label: "Revolve", icon: "revolve", tool: "revolution", large: true, title: "Sketch a profile in an elevation; it turns about the centre line" },
            { label: "Sweep", icon: "sweep", tool: "sweep", large: true, title: "Click a path in plan, Enter" },
            { label: "Void", html: voidToggle },
          ],
        },
        {
          title: "Model",
          items: [
            { label: "Component", icon: "component", tool: "component", large: true, title: "Place a nested family (C)" },
            { label: "Ref Plane", icon: "refplane", tool: "refplane", large: true, title: "Reference plane (R)" },
          ],
        },
        {
          title: "Family Editor",
          items: [
            { label: "Save Family File", icon: "save", cmd: "saveFamilyFile", large: true },
            { label: "Load into Project", icon: "load", cmd: "loadFamily", large: true },
            { label: "Close Family", icon: "close", cmd: "closeFamily", large: true, title: "Close without loading" },
          ],
        },
      ],
    },
    {
      id: "architecture",
      label: "Architecture",
      mode: "project",
      panels: [
        {
          title: "Build",
          items: [
            { label: "Wall", icon: "wall", tool: "wall", large: true, title: "Wall (W)" },
            { label: "Door", icon: "door", tool: "door", large: true, title: "Door (D)" },
            { label: "Window", icon: "window", tool: "window", large: true, title: "Window (N)" },
            { label: "Component", icon: "component", tool: "component", large: true, title: "Place a loaded family (C)", menu: libraryMenu },
            { label: "Roof", icon: "roof", tool: "roof", title: "Roof by footprint" },
            { label: "Ceiling", icon: "ceiling", tool: "ceiling" },
            { label: "Floor", icon: "floor", tool: "floor" },
            { label: "Column", icon: "column", tool: "column", title: "Column" },
          ],
        },
        {
          title: "Circulation",
          items: [
            { label: "Stair", icon: "stair", tool: "stair", large: true },
            { label: "Ramp", icon: "ramp", tool: "ramp" },
            { label: "Railing", icon: "railing", tool: "railing" },
          ],
        },
        { title: "Opening", items: [{ label: "Wall Opening", icon: "opening", tool: "opening", large: true }] },
        {
          title: "Room & Area",
          items: [
            { label: "Room", icon: "room", tool: "room", large: true },
            { label: "Room Separator", icon: "separator", tool: "roomseparator" },
            { label: "Area", icon: "area", tool: "area", title: "Area (area plans)" },
            { label: "Area Boundary", icon: "separator", tool: "areaboundary", title: "Area boundary (area plans)" },
          ],
        },
        {
          title: "Datum",
          items: [
            { label: "Grid", icon: "grid", tool: "grid", title: "Grid (G)" },
            { label: "Ref Plane", icon: "refplane", tool: "refplane", title: "Reference plane (R)" },
          ],
        },
      ],
    },
    {
      id: "structure",
      label: "Structure",
      mode: "project",
      panels: [
        {
          title: "Structure",
          items: [
            { label: "Beam", icon: "beam", tool: "beam", large: true },
            { label: "Column", icon: "column", tool: "column", large: true },
          ],
        },
        { title: "Foundation", items: [{ label: "Footing", icon: "footing", tool: "footing", large: true, title: "Footing: strip (click a wall) or pad (click a point)" }] },
      ],
    },
    {
      id: "systems",
      label: "Systems",
      mode: "project",
      panels: [
        {
          title: "HVAC",
          items: [
            { label: "System Browser", icon: "duct", cmd: "systemBrowser", title: "MEP systems, their members and totals (F9)" },
            { label: "Duct", icon: "duct", tool: "duct", large: true, title: "Duct: route runs; elbows, tees and transitions are automatic (DT)" },
            { label: "Air Terminal", icon: "component", cmd: "placeAirTerminal", title: "Place an air terminal at ceiling height (loads Supply Diffuser - Square if there's none; pick others in the type selector)" },
            { label: "Mechanical Equipment", icon: "component", cmd: "placeMechanicalEquipment", title: "Place mechanical equipment (loads Ducted Heat Pump - Indoor Unit if there's none)" },
          ],
        },
        {
          title: "Plumbing & Piping",
          items: [
            { label: "Pipe", icon: "pipe", tool: "pipe", large: true, title: "Pipe: route runs; bends, junctions and reducers are automatic; drainage falls (PI)" },
            { label: "Plumbing Fixture", icon: "component", cmd: "placePlumbingFixture", title: "Place a plumbing fixture (loads WC, basin, shower, bath, sinks and a hot water cylinder from the library if there are none)" },
          ],
        },
      ],
    },
    {
      id: "insert",
      label: "Insert",
      mode: "project",
      panels: [
        { title: "Link", items: [{ label: "Link Project", icon: "link", cmd: "linkProject", large: true }] },
        {
          title: "Import",
          items: [
            { label: "Import IFC", icon: "import", cmd: "importIfc", large: true },
            { label: "Import DXF/DWG", icon: "import", cmd: "importDxf", large: true, title: "Import CAD into this view" },
          ],
        },
        {
          title: "Load from Library",
          items: [
            { label: "Load Family", icon: "family", large: true, menu: libraryMenu, title: "Load a family from the built-in library" },
            { label: "Load Family File", icon: "load", cmd: "loadFamilyFile", large: true, title: "Load an .obim-family file" },
          ],
        },
      ],
    },
    {
      id: "annotate",
      label: "Annotate",
      mode: "both",
      panels: [
        { title: "Dimension", items: [{ label: "Aligned", icon: "dimension", tool: "dimension", large: true, title: "Aligned dimension (DI / M)" }] },
        {
          title: "Detail",
          items: [
            { label: "Detail Line", icon: "detailline", tool: "detailline", large: true, title: "Detail line (L)" },
            { label: "Region", icon: "region", tool: "region", title: "Filled region" },
            {
              label: "Component",
              icon: "detailcomp",
              tool: "detailcomponent",
              title: "Detail component (\u25be: pick or load a detail item)",
              menu: () => {
                const loaded = m.detailFamilies();
                const lib = m.libraryDetailItems().filter((n) => !loaded.some((f) => f.name === n));
                return [
                  { heading: "Loaded detail items" },
                  ...(loaded.length ? loaded.map((f) => ({ label: f.name, action: () => m.placeDetail(f.id) })) : [{ label: "(none yet)", disabled: true, action: () => {} }]),
                  { heading: "Load from library" },
                  ...lib.map((n) => ({ label: n, action: () => m.loadDetail(n) })),
                ];
              },
            },
            { label: "Revision Cloud", icon: "cloud", tool: "cloud" },
          ],
        },
        {
          title: "Text",
          items: [
            { label: "Text", icon: "text", tool: "text", large: true, title: "Text note (T)" },
            { label: "Check Spelling", icon: "spell", cmd: "checkSpelling" },
            { label: "Find/Replace", icon: "find", cmd: "findReplace" },
          ],
        },
        {
          title: "Tag",
          items: [
            { label: "Tag by Category", icon: "tag", tool: "tag", large: true },
            {
              label: "Keynote",
              icon: "keynote",
              tool: "keynote",
              large: true,
              menu: () => [
                { heading: "Keynoting settings" },
                { label: "Load Keynote File…", action: () => m.cmd("importKeynotes") },
                { label: "Export Keynote File…", action: () => m.cmd("exportKeynotes") },
              ],
            },
          ],
        },
        {
          title: "Symbol",
          items: [
            {
              label: "Symbol",
              icon: "symbol",
              tool: "symbol",
              large: true,
              title: "Place a symbol (▾: north arrow, scale bar, break line)",
              menu: () => [{ heading: "Symbol" }, ...SYMBOL_KINDS.map((k) => ({ label: k.label, action: () => m.placeSymbol(k.value) }))],
            },
          ],
        },
        {
          title: "Revisions",
          items: [
            { label: "Cloud", icon: "cloud", tool: "cloud", large: true, title: "Revision cloud (latest open revision)" },
            { label: "New Revision", icon: "revision", cmd: "newRevision", large: true },
          ],
        },
        {
          title: "Groups",
          items: [
            { label: "Create Group", icon: "group", cmd: "group", title: "Group the selection (Ctrl+G)" },
            { label: "Place Group", icon: "copy", cmd: "placeGroupCopy" },
            { label: "Detail Group", icon: "group", cmd: "group", title: "Group one view's detail lines, text, symbols and details (Ctrl+G); Place Group copies it" },
          ],
        },
      ],
    },
    {
      id: "site",
      label: "Massing & Site",
      mode: "project",
      panels: [
        {
          title: "Conceptual Mass",
          items: [
            { label: "Show Mass", icon: "mass", cmd: "showMass", large: true, title: "Show or hide conceptual masses in every view (a session setting, as in Revit)" },
            { label: "In-Place Mass", icon: "extrusion", cmd: "inPlaceMass", title: "Model a new mass (opens the family editor; Load into Project places it)" },
            { label: "Place Mass", icon: "component", cmd: "placeMass", title: "Place a loaded mass family (loads Mass - Box if there's none)" },
          ],
        },
        {
          title: "Model by Face",
          items: [
            { label: "Wall", icon: "wall", tool: "face-wall", title: "Wall by Face: click a vertical mass face" },
            { label: "Curtain Wall", icon: "curtain", tool: "face-curtain", title: "Curtain wall on a vertical mass face" },
            { label: "Roof", icon: "roof", tool: "face-roof", title: "Roof by Face: click a mass's top face" },
            { label: "Floor", icon: "floor", tool: "face-floor", title: "Floor by Face: click a mass floor (or a mass for all its floors)" },
          ],
        },
        {
          title: "Model Site",
          items: [
            { label: "Toposolid", icon: "toposolid", tool: "toposolid", large: true, title: "Sketch the site boundary, then import survey points" },
            { label: "Building Pad", icon: "floor", tool: "pad", title: "Sketch a pad inside a toposolid: the ground is graded to its underside" },
            { label: "Site Component", icon: "tree", cmd: "siteComponent", title: "Place a site family (trees, letterboxes…)" },
            { label: "Parking Component", icon: "parking", cmd: "parkingComponent", title: "Place a parking space family" },
          ],
        },
        {
          title: "Modify Site",
          items: [
            { label: "Subregion", icon: "region", tool: "subregion", title: "Sketch an area of the toposolid in another material (paths, lawn, paving)" },
            {
              label: "Property Line",
              icon: "property",
              tool: "property",
              title: "Sketch the property boundary (\u25be: create by entering bearings and distances)",
              menu: () => [{ label: "Create by entering bearings and distances", action: () => m.cmd("propertyFromBearings") }],
            },
            { label: "Graded Region", icon: "toposolid", cmd: "gradedRegion", title: "Record the selected toposolid's ground as existing, then regrade it; cut and fill show in Properties" },
          ],
        },
      ],
    },
    {
      id: "analyse",
      label: "Analyse",
      mode: "project",
      panels: [
        {
          title: "Check",
          items: [
            { label: "Clashes", icon: "clash", cmd: "clashes", large: true, title: "Interference check between categories" },
            { label: "NZ Checks", icon: "check", cmd: "nzChecks", large: true, title: "NZBC H1 energy and NZS 3604 bracing" },
          ],
        },
      ],
    },
    {
      id: "collaborate",
      label: "Collaborate",
      mode: "project",
      panels: [{ title: "Share", items: [{ label: "Collaborate", icon: "collab", cmd: "collaborate", large: true, title: "Edit this model with others through a sync server" }] }],
    },
    {
      id: "view",
      label: "View",
      mode: "both",
      panels: [
        { title: "Graphics", items: [{ label: "Visibility/ Graphics", icon: "vg", cmd: "visibilityGraphics", large: true, title: "Visibility/Graphics (VV)" }] },
        { title: "Presentation", items: [{ label: "Render", icon: "render", cmd: "render", large: true, title: "Path-traced render of the 3D view" }] },
        {
          title: "Create",
          items: [
            {
              label: "3D View",
              icon: "view3d",
              cmd: "view3d",
              large: true,
              title: "Default 3D view (▾: Camera — a perspective view from an eye point in plan)",
              menu: () => [
                { label: "Default 3D View", action: () => m.cmd("view3d") },
                { label: "Camera", action: () => m.cmd("camera") },
              ],
            },
            { label: "Plan", icon: "plan", cmd: "viewPlan", large: true, title: "Floor plan of the active level" },
            { label: "Section", icon: "section", tool: "section", title: "Section (S)" },
            { label: "Callout", icon: "callout", tool: "callout" },
            {
              label: "Elevation",
              icon: "elevation",
              tool: "elevation",
              title: "Click to place an elevation looking at the nearest wall (▾: all four building elevations)",
              menu: () => [{ label: "Building Elevations (N, E, S, W)", action: () => m.cmd("elevations") }],
            },
            { label: "Legend", icon: "legend", cmd: "newLegend" },
            { label: "Schedules", icon: "schedule", menu: () => [...scheduleMenu("schedule"), "-", ...scheduleMenu("takeoff")] },
            { label: "Sheet", icon: "sheet", cmd: "newSheet" },
          ],
        },
        {
          title: "Windows",
          items: [
            { label: "Zoom to Fit", icon: "fit", cmd: "fit", title: "Zoom to fit (F)" },
            { label: "Tile", icon: "tile", cmd: "tileViews", title: "Tile the open views (WT)" },
            { label: "Cascade", icon: "cascade", cmd: "cascadeViews", title: "Cascade the open views (WC)" },
            { label: "Tab Views", icon: "tabs", cmd: "tabViews", title: "One view at a time, with tabs (TW)" },
            { label: "Reset Panels", icon: "layout", cmd: "resetLayout", title: "Put the Project Browser and Properties back" },
          ],
        },
      ],
    },
    {
      id: "manage",
      label: "Manage",
      mode: "project",
      panels: [
        {
          title: "Settings",
          items: [
            { label: "Project Information", icon: "info", cmd: "projectInfo", large: true, title: "Project information, units, location, phases, H1, bracing" },
            { label: "Materials", icon: "material", cmd: "manageMaterials", title: "Material Browser" },
            { label: "Project Parameters", icon: "parameters", cmd: "manageParameters", title: "Project, shared and global parameters" },
            { label: "Levels", icon: "level", cmd: "manageLevels", title: "Levels in the project" },
            { label: "Filters & Templates", icon: "vg", cmd: "manageFilters", title: "View filters and view templates" },
          ],
        },
        {
          title: "Phasing & Options",
          items: [
            { label: "Design Options", icon: "options", cmd: "manageDesignOptions", large: true, title: "Design option sets and options" },
            { label: "Revisions", icon: "cloud", cmd: "manageRevisions", title: "Sheet Issues/Revisions" },
          ],
        },
        {
          title: "Inquiry",
          items: [
            { label: "System Browser", icon: "duct", cmd: "systemBrowser", title: "MEP systems, their members and totals (F9)" },
            { label: "Model Statistics", icon: "info", cmd: "manageStatistics", title: "How many of each element" },
          ],
        },
        { title: "Add-ins", items: [{ label: "Console & Plugins", icon: "console", cmd: "console", large: true, title: "Scripting console and plugins (`)" }] },
      ],
    },
    {
      id: "modify",
      label: "Modify",
      mode: "both",
      panels: [
        { title: "Select", items: [{ label: "Modify", icon: "select", tool: "select", large: true, title: "Select (Esc)" }] },
        { title: "Modify", items: modify },
        {
          title: "Modify Wall",
          items: [
            { label: "Attach Top", icon: "roof", cmd: "attachTop", title: "Attach the selected walls' tops to a roof, floor or ceiling (click it next)" },
            { label: "Attach Base", icon: "floor", cmd: "attachBase", title: "Attach the selected walls' bases to a floor (click it next)" },
          ],
        },
        {
          title: "View",
          items: [
            { label: "Hide", icon: "hide", cmd: "hide", title: "Temporarily hide (H; Shift = category)" },
            { label: "Isolate", icon: "vg", cmd: "isolate", title: "Temporarily isolate (I)" },
            { label: "Reset", icon: "fit", cmd: "resetVisibility", title: "Reset temporary hide/isolate (U)" },
          ],
        },
        {
          title: "Create",
          items: [
            { label: "Group", icon: "group", cmd: "group", title: "Create a model group (Ctrl+G)" },
            { label: "Place Group", icon: "copy", cmd: "placeGroupCopy", title: "Place another copy of the selected group" },
            { label: "Demolish", icon: "demolish", tool: "demolish", title: "Demolish in this view's phase" },
          ],
        },
      ],
    },
  ];
}
