import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import {
  Cat,
  PLAN_CUT_HEIGHT,
  TemporaryVisibility,
  annotationView,
  elementMaterial,
  isFormCategory,
  isDrawingView,
  is2DView,
  viewFrame,
  type DetailLevel,
  type Element,
  type ResolvedGraphics,
  type Sheet,
  type ViewParams,
  type VisualStyle,
  type ChangeSet,
  type Document,
  type ElementId,
  type Vec2,
  type View,
  type ViewRange,
  viewCrop,
  planLevelOf,
  defaultGraphics,
  graphicsCategory,
  MASS_CATEGORY,
} from "@open-bim/core";
import {
  GRID_BUBBLE_RADIUS,
  fillLoops,
  lineworkDrawing,
  type Fill,
  type Stroke,
  patternFamilies,
  planFrame,
  planLinework,
  sectionAnnotations,
  sectionLinework,
  sheetDrawing,
  type Drawing,
  type StrokeKind,
  type GeometryKernel,
  type LineData,
  type MeshData,
  type PlanLinework,
  isRunCategory,
} from "@open-bim/geometry";

// Model space is millimetres with Z up (Revit convention).
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

/** Conceptual masses. */
const MASS_COLOR = 0x7fa7d9;

const COLORS: Record<string, number> = {
  [Cat.Wall]: 0xd9d4c7,
  [Cat.Duct]: 0xb9c3cc,
  [Cat.CableTray]: 0xc9a75a,
  [Cat.CableTrayFitting]: 0xb9974a,
  [Cat.Conduit]: 0x8a8f96,
  [Cat.ConduitFitting]: 0x7a7f86,
  [Cat.BuildingPad]: 0xb5b2aa,
  [Cat.SiteSubregion]: 0x9cc28a,
  [Cat.MassFloor]: 0x3f6fb5,
  [Cat.Pipe]: 0x4f8fbf,
  [Cat.PipeFitting]: 0x3f7faf,
  [Cat.DuctFitting]: 0xa9b4be,
  [Cat.Floor]: 0x9aa3ad,
  [Cat.Ceiling]: 0xe8e6df,
  [Cat.Roof]: 0x7d8a96,
  [Cat.WallOpening]: 0xd9822b,
  [Cat.Door]: 0xa0764f,
  [Cat.Window]: 0x9cc3d9,
  [Cat.Extrusion]: 0xc8c3b6,
  [Cat.Blend]: 0xc8c3b6,
  [Cat.Revolution]: 0xc8c3b6,
  [Cat.Sweep]: 0xc8c3b6,
  [Cat.FamilyInstance]: 0xb9a48a,
  [Cat.Grid]: 0x4a5560,
  [Cat.ReferencePlane]: 0x2e8b57,
  [Cat.View]: 0x111111,
  [Cat.DetailLine]: 0x1f2328,
  [Cat.DetailComponent]: 0x1f2328,
  [Cat.Symbol]: 0x1f2328,
  [Cat.Dimension]: 0x1f2328,
  [Cat.TextNote]: 0x1f2328,
  [Cat.FilledRegion]: 0x1f2328,
  [Cat.Room]: 0x7a8fa6,
  [Cat.RoomSeparator]: 0x1f2328,
  [Cat.Area]: 0x9a6b2f,
  [Cat.AreaBoundary]: 0x9a3fb5,
  [Cat.CadImport]: 0x5a6470,
  [Cat.Link]: 0xc4c8cc,
  [Cat.Stair]: 0xb7b2a6,
  [Cat.Railing]: 0x6b7178,
  [Cat.Ramp]: 0xb7b2a6,
  [Cat.Toposolid]: 0x9fb07c,
  [Cat.Column]: 0x8f969d,
  [Cat.Beam]: 0x8f969d,
  [Cat.PadFooting]: 0xa7a8a6,
  [Cat.StripFooting]: 0xa7a8a6,
};
/** Plan styles that show the coloured model under the line work. */
const SHADED_STYLES = new Set<string>(["shaded", "consistent", "realistic"]);
/** Model elements whose plan marks scale with the view (bubbles, heads, labels). */
const SCALED_MARKS = new Set<string>([Cat.Grid, Cat.ReferencePlane, Cat.View]);
/** Hidden elements while revealing them (Revit shows them magenta). */
const REVEALED = 0xd0389c;
const SELECTED = 0x3d8bfd;
const VOID_COLOR = 0xff8c1a;
/** Large surfaces that lose picks to line work drawn over them. */
const BACKGROUND_CATEGORIES = new Set<string>([Cat.Floor, Cat.Ceiling, Cat.Roof, Cat.FilledRegion, Cat.Room, Cat.Area]);
/** Halftone fades colours towards the (white) background. */
const HALFTONE_TOWARD = 0xffffff;
/** Backgrounds: white for plans, sections, elevations (Revit default); very light grey for 3D. */
const BG_DRAWING = 0xffffff;
const BG_3D = 0xe6e8eb;
const BG_SHEET = 0xd5d8dc;

function blend(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 0xff;
  const mix = (s: number) => Math.round(ch(a, s) * (1 - t) + ch(b, s) * t) << s;
  return mix(16) | mix(8) | mix(0);
}
/** Plan symbols (door swings) drawn alongside a solid. */
const SYMBOL = 0x2b2f36;
/** Plan drawing: cut outlines, poché fill and projection (beyond) lines. */
const CUT_LINE = 0x111111;
const POCHE = 0x9a9ea4;
const BEYOND = 0x555b63;
/** Cut-pattern hatching and surface patterns. */
const HATCH = 0x80868e;
const SURFACE = 0xa3a8ae;
/** Drawn with plan symbols rather than cut/projection (like Revit door and window families). */
const SYMBOLIC_IN_PLAN = new Set<string>([Cat.Door, Cat.Window]);
const PREVIEW = 0x2f8cff;
/** 3D model view, plan (top-down, clipped) or drawing (section/elevation in its own 2D space). */
export type ViewMode = "3d" | "plan" | "drawing";
type Rect = { min: Vec2; max: Vec2 };
const PLAN_CAMERA_HEIGHT = 500_000; // mm; clipping planes, not the camera, limit what a plan shows
const PLAN_HALF_HEIGHT = 10_000; // mm visible above/below centre at zoom 1

/** Datum line work sits just above the work plane so floor tops at the level don't hide it. */
const DATUM_LIFT = 10;

export function toGeometry(mesh: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  if (mesh.colors) g.setAttribute("color", new THREE.BufferAttribute(mesh.colors, 3));
  g.computeBoundingSphere();
  return g;
}

/** Renders a Document in 3D and keeps it in sync with model changes. */
export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private readonly camera3d: THREE.PerspectiveCamera;
  private readonly cameraPlan: THREE.OrthographicCamera;
  private readonly controls3d: OrbitControls;
  private readonly controlsPlan: OrbitControls;
  /** Sections and elevations are drawn in their own 2D scene (x along the view, y = Z). */
  private readonly drawScene = new THREE.Scene();
  private readonly cameraDraw: THREE.OrthographicCamera;
  private readonly controlsDraw: OrbitControls;
  private drawingView: View | null = null;
  /** Sheet shown in drawing mode (instead of a section/elevation). */
  private sheet: Sheet | null = null;
  /** Levels, grids and crop frame of the current section/elevation. */
  private drawExtras: THREE.Group | null = null;
  /** Callouts: plan crop rectangle. */
  private planCrop: Rect | null = null;
  /** Active view graphics: detail level (coarse = solid poché, else layers + patterns) and scale. */
  private graphics: { detailLevel: DetailLevel; scale: number } = { detailLevel: "coarse", scale: 100 };
  private mode: ViewMode = "3d";
  private planRange: ViewRange = { bottom: 0, cut: PLAN_CUT_HEIGHT };
  private planFramed = false;
  private objects = new Map<ElementId, THREE.Group>();
  private unsubscribe: () => void = () => {};
  /** Last built mesh per element, for computing plan drawings. */
  private meshes = new Map<ElementId, MeshData>();
  /** 2D plan linework per element (plan views only). */
  private drawing = new Map<ElementId, THREE.Group>();
  private drawingDirty = true;
  private selected = new Set<ElementId>();
  private preview: THREE.Group | null = null;
  private previewLines: THREE.Group | null = null;
  /** Datums (grids) are drawn at the work plane, like a plan view of the active level. */
  private datums = new Set<ElementId>();
  /** Temporary hide/isolate state for this view. */
  readonly visibility = new TemporaryVisibility();
  /** The active view's Visibility/Graphics: visibility, halftone and colour per element. */
  private resolveGraphics: (el: Element) => ResolvedGraphics = () => defaultGraphics();
  /** Annotations are drawn only in the view that owns them. */
  private annotationViewId: ElementId | undefined;
  private workPlaneZ = 0;
  /** Level of the open plan: rooms and separators show only there. */
  private planLevelId: ElementId | undefined;
  private raycaster = new THREE.Raycaster();
  private grid: THREE.GridHelper;
  private needsRender = true;

  constructor(
    private container: HTMLElement,
    private doc: Document,
    private kernel: GeometryKernel,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(BG_3D);
    container.appendChild(this.renderer.domElement);

    this.camera3d = new THREE.PerspectiveCamera(45, 1, 50, 2_000_000);
    this.camera3d.position.set(-12000, -16000, 11000);

    this.controls3d = new OrbitControls(this.camera3d, this.renderer.domElement);
    this.controls3d.target.set(5000, 4000, 1200);
    this.controls3d.enableDamping = true;
    this.controls3d.screenSpacePanning = true;
    // Revit-style: middle = pan, shift+middle or right = orbit, wheel = zoom.
    this.controls3d.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.controls3d.addEventListener("change", () => (this.needsRender = true));

    // Plan: orthographic, looking straight down with +Y (north) up. No orbit.
    this.cameraPlan = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1_000_000);
    this.cameraPlan.up.set(0, 1, 0);
    this.cameraPlan.position.set(5000, 4000, PLAN_CAMERA_HEIGHT);
    this.controlsPlan = new OrbitControls(this.cameraPlan, this.renderer.domElement);
    this.controlsPlan.target.set(5000, 4000, 0);
    this.controlsPlan.enableRotate = false;
    this.controlsPlan.screenSpacePanning = true;
    this.controlsPlan.zoomToCursor = true;
    this.controlsPlan.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    this.controlsPlan.enabled = false;
    this.controlsPlan.addEventListener("change", () => (this.needsRender = true));

    this.cameraDraw = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 10_000);
    this.cameraDraw.position.set(0, 0, 1000);
    this.controlsDraw = new OrbitControls(this.cameraDraw, this.renderer.domElement);
    this.controlsDraw.enableRotate = false;
    this.controlsDraw.screenSpacePanning = true;
    this.controlsDraw.zoomToCursor = true;
    this.controlsDraw.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    this.controlsDraw.enabled = false;
    this.controlsDraw.addEventListener("change", () => (this.needsRender = true));
    // Orbit about the selection (Revit): in 3D with something selected, the orbit pivots on it.
    this.renderer.domElement.addEventListener("pointerdown", (ev) => this.orbitAboutSelection(ev), { capture: true });

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 1.6);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-1, -2, 3);
    this.scene.add(sun, sun.target);
    this.sun = sun;
    // Shadow catcher on the ground (only seen when shadows are on).
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.28 }));
    this.ground.receiveShadow = true;
    this.ground.visible = false;
    this.scene.add(this.ground);

    this.grid = new THREE.GridHelper(60000, 60, 0xc4c9cf, 0xd6dadf);
    this.grid.rotation.x = Math.PI / 2; // GridHelper is XZ; rotate into XY
    this.scene.add(this.grid);

    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(container);
    this.resize();

    this.unsubscribe = doc.on((c) => this.sync(c));
    this.rebuildAll();
    this.loop();
  }

  // ---- sync ----------------------------------------------------------------

  /** Show a different document (project or family being edited). */
  setDocument(doc: Document): void {
    this.unsubscribe();
    this.doc = doc;
    this.unsubscribe = doc.on((c) => this.sync(c));
    this.selected.clear();
    this.visibility.reset();
    this.drawingView = null;
    this.sheet = null;
    this.planFramed = false;
    this.rebuildAll();
    this.refreshVisibility();
  }

  rebuildAll(): void {
    for (const id of [...this.objects.keys()]) this.remove(id);
    for (const el of this.doc.all()) this.rebuild(el.id);
    this.needsRender = true;
  }

  private sync(c: ChangeSet): void {
    for (const id of c.removed) this.remove(id);
    for (const id of c.regenerate) this.rebuild(id);
    for (const id of [...this.selected]) if (!this.doc.has(id)) this.selected.delete(id);
    this.drawingDirty = true;
    this.needsRender = true;
  }

  private remove(id: ElementId): void {
    const obj = this.objects.get(id);
    if (!obj) return;
    obj.removeFromParent();
    disposeGroup(obj);
    this.objects.delete(id);
    this.meshes.delete(id);
    this.datums.delete(id);
  }

  private rebuild(id: ElementId): void {
    this.remove(id);
    const el = this.doc.get(id);
    if (!el) return;
    let group: THREE.Group;
    try {
      const mesh = this.kernel.build(this.doc, el);
      const lines = this.kernel.buildLines(this.doc, el, this.graphics.scale, this.graphics.detailLevel);
      if (mesh) {
        this.meshes.set(id, mesh);
        const material = elementMaterial(this.doc, el);
        // Family voids show as translucent orange in the family editor (Revit convention).
        const isVoid = isFormCategory(el.category) && (el.params as { isVoid?: boolean }).isVoid;
        // Masses: translucent blue, as Revit draws them.
        const mass = graphicsCategory(this.doc, el) === MASS_CATEGORY;
        group = isVoid ? makeGroup(mesh, VOID_COLOR, 0.35) : mass ? makeGroup(mesh, MASS_COLOR, 0.45) : makeGroup(mesh, material?.params.color ?? (el.params as { color?: number }).color ?? COLORS[el.category] ?? 0xcccccc);
        group.userData.baseColor = mass ? MASS_COLOR : material?.params.color;
        group.userData.solid = true;
        // Symbols drawn with a solid (door swings) ride along in the same group.
        if (lines) group.add(makeLineGroup(lines, SYMBOL));
      } else if (lines) {
        group = makeLineGroup(lines, COLORS[el.category] ?? 0xcccccc);
        const owner = annotationView(el);
        const ownerView = owner ? this.doc.get<ViewParams>(owner) : undefined;
        if (ownerView && is2DView(ownerView as View)) {
          // Section/elevation annotation: lives in the 2D drawing scene.
          group.userData.inDrawing = true;
        } else if (lines.placement !== "model") {
          group.position.z = this.workPlaneZ;
          this.datums.add(id);
        }
      } else return;
    } catch (err) {
      console.warn(`Could not build ${el.category} ${id}`, err);
      return;
    }
    group.userData.elementId = id;
    group.visible = this.isShown(el);
    this.applyPlanOnly(group);
    this.objects.set(id, group);
    (group.userData.inDrawing ? this.drawScene : this.scene).add(group);
    this.applyHighlight(id);
  }

  // ---- selection -----------------------------------------------------------

  setSelection(ids: Iterable<ElementId>): void {
    const prev = [...this.selected];
    this.selected = new Set(ids);
    for (const id of prev) this.applyHighlight(id);
    for (const id of this.selected) this.applyHighlight(id);
    this.needsRender = true;
  }

  private applyHighlight(id: ElementId): void {
    const g = this.objects.get(id);
    const el = this.doc.get(id);
    const d = this.drawing.get(id);
    if (d && el && el.category === Cat.Viewport) {
      // Viewports on sheets: highlight the whole view when selected.
      d.traverse((o) => {
        if (o instanceof THREE.LineSegments || o instanceof THREE.Mesh) {
          (o.material as THREE.LineBasicMaterial).color.setHex(this.selected.has(id) ? SELECTED : (o.userData.baseColor as number));
        }
      });
      return;
    }
    if (d && el) {
      const vg = this.resolveGraphics(el);
      d.traverse((o) => {
        if (!(o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.LineLoop)) return;
        const base = o.userData.baseColor as number;
        const role = o.userData.role as string | undefined;
        // Override Graphics: cut/projection lines, surface and cut patterns each have their own.
        const own =
          role === "cut" ? vg.cut.color : role === "projection" ? vg.projection.color : role === "surface" ? vg.surface.foreground.color : role === "hatch" || role === "poche" ? vg.cutFill.foreground.color : null;
        if (role === "surface") o.visible = vg.surface.foreground.visible;
        if (role === "hatch" || role === "poche") o.visible = vg.cutFill.foreground.visible;
        const m = o.material as THREE.MeshBasicMaterial;
        m.color.setHex(this.displayColor(el, own ?? base, own !== null));
        if (o instanceof THREE.Mesh && vg.transparency > 0) {
          m.transparent = true;
          m.opacity = 1 - vg.transparency / 100;
        }
      });
    }
    if (!g || !el) return;
    const mesh = g.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial | THREE.LineBasicMaterial>;
    const base = (g.userData.baseColor as number | undefined) ?? COLORS[el.category] ?? 0xcccccc;
    const vgr = this.resolveGraphics(el);
    // Faces take the surface pattern colour when overridden, else the element's override colour.
    const sf = vgr.surface.foreground;
    const color = this.displayColor(el, sf.color ?? base, sf.color !== null);
    const mat = mesh.material;
    if (!(mat instanceof THREE.MeshStandardMaterial)) {
      mat.color.setHex(color);
      return;
    }
    // Visual style (3D): faces lit, flat (emissive only) or hidden; edges on top for wireframe.
    const style = this.visualStyle;
    const flat = style === "hiddenLine" || style === "consistent";
    // Hidden Line faces are white unless selected, revealed or overridden in V/G.
    const vg = this.resolveGraphics(el);
    const plain = style === "hiddenLine" && !this.selected.has(el.id) && !this.revealedOnly(el) && vg.color == null && !vg.halftone;
    mat.visible = style !== "wireframe";
    const t = vgr.transparency / 100;
    const baseOpacity = (g.userData.opacity as number | undefined) ?? 1;
    mat.transparent = t > 0 || baseOpacity < 1;
    mat.opacity = baseOpacity * (1 - t);
    mat.depthWrite = t < 0.5;
    mat.color.setHex(flat ? 0x000000 : color);
    mat.emissive.setHex(flat ? (plain ? 0xffffff : color) : 0x000000);
    const edges = g.children[1];
    if (edges instanceof THREE.LineSegments) {
      const em = edges.material as THREE.LineBasicMaterial;
      em.visible = style !== "realistic";
      em.depthTest = style !== "wireframe";
      // Wireframe is black lines on white; the selection (blue) and revealed elements (magenta) keep their colour.
      const edge = vgr.projection.color ?? 0x14171b;
      em.color.setHex(this.selected.has(el.id) || this.revealedOnly(el) ? (style === "wireframe" ? color : 0x14171b) : vgr.halftone ? blend(edge, HALFTONE_TOWARD, 0.6) : edge);
      em.transparent = t > 0;
      em.opacity = 1 - t;
    }
    // Glazing meshes (curtain walls, windows) follow the faces.
    for (const c of g.children.slice(2)) if (c instanceof THREE.Mesh) (c.material as THREE.Material).visible = style !== "wireframe";
  }

  private visualStyle: VisualStyle = "shaded";
  private revealHidden = false;

  /** The 3D view's visual style (Wireframe, Hidden Line, Shaded, Consistent Colours, Realistic). */
  setVisualStyle(style: VisualStyle): void {
    const s = style === "rendered" ? "realistic" : style;
    if (s === this.visualStyle) return;
    this.visualStyle = s;
    for (const id of this.objects.keys()) this.applyHighlight(id);
    for (const g of this.objects.values()) this.applyPlanOnly(g);
    this.needsRender = true;
  }

  /** Reveal hidden elements (Revit's light bulb): hidden ones show in magenta. */
  setRevealHidden(on: boolean): void {
    if (on === this.revealHidden) return;
    this.revealHidden = on;
    this.container.classList.toggle("reveal-hidden", on);
    this.refreshVisibility();
    for (const id of this.objects.keys()) this.applyHighlight(id);
  }
  get revealing(): boolean {
    return this.revealHidden;
  }

  /** Hidden in this view (by V/G or temporary hide/isolate), whether or not it's being revealed. */
  isHidden(el: Element): boolean {
    return !(this.resolveGraphics(el).visible && this.visibility.isVisible(el));
  }

  /** Shown only because hidden elements are being revealed. */
  private revealedOnly(el: Element): boolean {
    return this.revealHidden && !(this.resolveGraphics(el).visible && this.visibility.isVisible(el));
  }

  // ---- picking ------------------------------------------------------------

  private setRay(ev: { clientX: number; clientY: number }): void {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
  }

  /** Element under the cursor, nearest first. */
  pick(ev: { clientX: number; clientY: number }): ElementId | null {
    return this.pickHit(ev)?.id ?? null;
  }

  /** Element under the cursor and the model point hit, nearest first. */
  /** The solid under the cursor, with the triangle hit (Model by Face). 3D and plans only. */
  pickFace(ev: { clientX: number; clientY: number }, filter?: (id: ElementId) => boolean): { id: ElementId; tri: number; mesh: MeshData } | null {
    if (this.mode === "drawing") return null;
    this.setRay(ev);
    const meshes = [...this.objects.entries()].filter(([id, g]) => g.visible && this.meshes.has(id) && (!filter || filter(id))).map(([, g]) => g.children[0]!);
    for (const hit of this.raycaster.intersectObjects(meshes, false)) {
      if (this.renderer.clippingPlanes.some((pl) => pl.distanceToPoint(hit.point) < 0)) continue;
      const id = hit.object.parent?.userData.elementId as ElementId | undefined;
      const mesh = id ? this.meshes.get(id) : undefined;
      if (id && mesh && hit.faceIndex !== undefined && hit.faceIndex !== null) return { id, tri: hit.faceIndex, mesh };
    }
    return null;
  }

  pickHit(ev: { clientX: number; clientY: number }, filter?: (id: ElementId) => boolean): { id: ElementId; point: Vec2 } | null {
    this.setRay(ev);
    // Line picking tolerance: a few pixels, in mm at the current zoom.
    this.raycaster.params.Line.threshold = this.mmPerPixel() * 6;
    if (this.mode === "drawing") {
      // Sections/elevations: pick the drawn linework and annotations. `point` is in drawing coordinates.
      const annotations = [...this.objects.entries()].filter(([, g]) => g.userData.inDrawing && g.visible);
      const parts = [...this.drawing.entries(), ...annotations]
        .filter(([id]) => !filter || filter(id))
        .flatMap(([, g]) => g.children.filter((c) => !(c instanceof THREE.Sprite)));
      const hit = this.raycaster.intersectObjects(parts, false)[0];
      const id = hit?.object.parent?.userData.elementId as ElementId | undefined;
      return hit && id ? { id, point: { x: hit.point.x, y: hit.point.y } } : null;
    }
    const meshes = [...this.objects.entries()]
      .filter(([id, g]) => g.visible && (!filter || filter(id)))
      .map(([, g]) => g.children[0]!);
    // Lines are picked with a few pixels' tolerance, so a grid along a wall would always win. Prefer
    // solids actually under the cursor, then line work, then big background surfaces.
    const rank = (o: THREE.Object3D, id: ElementId) => {
      if (!(o instanceof THREE.Mesh)) return 1;
      return BACKGROUND_CATEGORIES.has(this.doc.get(id)?.category ?? "") ? 2 : 0;
    };
    let best: { id: ElementId; point: Vec2; rank: number } | null = null;
    for (const hit of this.raycaster.intersectObjects(meshes, false)) {
      // Respect plan clipping: ignore hits on geometry that isn't drawn.
      if (this.renderer.clippingPlanes.some((pl) => pl.distanceToPoint(hit.point) < 0)) continue;
      const id = hit.object.parent?.userData.elementId as ElementId | undefined;
      if (!id) continue;
      const r = rank(hit.object, id);
      if (!best || r < best.rank) best = { id, point: { x: hit.point.x, y: hit.point.y }, rank: r };
      if (r === 0) break; // hits are nearest-first
    }
    return best && { id: best.id, point: best.point };
  }

  /** Re-apply temporary hide/isolate after changing `visibility`. */
  /** Categories hidden by the active view. */
  /** Install the active view's Visibility/Graphics resolver (category settings, filters, template). */
  setGraphicsResolver(resolve: (el: Element) => ResolvedGraphics): void {
    this.resolveGraphics = resolve;
    this.refreshVisibility();
    for (const id of this.objects.keys()) this.applyHighlight(id);
  }

  /** Colour after selection, V/G colour override and halftone. */
  private displayColor(el: Element, base: number, exact = false): number {
    if (this.selected.has(el.id)) return SELECTED;
    if (this.revealedOnly(el)) return REVEALED;
    const g = this.resolveGraphics(el);
    const c = exact ? base : (g.color ?? base);
    return g.halftone ? blend(c, HALFTONE_TOWARD, 0.6) : c;
  }

  /** Thin Lines (Revit's TL): every line 1 px, ignoring line weights. */
  thinLines = false;
  private fatMaterials = new Set<LineMaterial>();

  setThinLines(on: boolean): void {
    this.thinLines = on;
    this.drawingDirty = true;
    this.needsRender = true;
  }

  /** Wide-line materials need the canvas size to draw at the right width. */
  private trackFat(m: LineMaterial): void {
    const size = this.renderer.getSize(new THREE.Vector2());
    m.resolution.set(size.x, size.y);
    this.fatMaterials.add(m);
    m.addEventListener("dispose", () => this.fatMaterials.delete(m));
  }

  /** Show Mass (Revit's session toggle): conceptual masses only show while it's on. */
  showMass = false;

  setShowMass(on: boolean): void {
    this.showMass = on;
    this.refreshVisibility();
  }

  private isShown(el: { id: ElementId; category: string; params: unknown }): boolean {
    if (!this.showMass && graphicsCategory(this.doc, el as Element) === MASS_CATEGORY) return false;
    const owner = annotationView(el as never);
    if (owner && owner !== this.annotationViewId) return false;
    const lvl = planLevelOf(el as Element);
    if (lvl && lvl !== this.planLevelId) return false;
    if (this.revealHidden) return true;
    return this.resolveGraphics(el as Element).visible && this.visibility.isVisible(el);
  }

  /** The open plan's level (undefined outside plans). */
  setPlanLevel(id: ElementId | undefined): void {
    if (id === this.planLevelId) return;
    this.planLevelId = id;
    this.refreshVisibility();
  }

  /** The active view: its own annotations are shown, other views' are hidden. */
  setAnnotationView(id: ElementId | undefined): void {
    if (id === this.annotationViewId) return;
    this.annotationViewId = id;
    this.refreshVisibility();
  }

  /** Point under the cursor in a section/elevation's drawing coordinates. */
  pickDrawing(ev: { clientX: number; clientY: number }): Vec2 | null {
    this.setRay(ev);
    const p = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3());
    return p ? { x: p.x, y: p.y } : null;
  }

  refreshVisibility(): void {
    for (const [id, g] of this.objects) {
      const el = this.doc.get(id);
      g.visible = !!el && this.isShown(el);
    }
    this.container.classList.toggle("temp-visibility", this.visibility.active);
    this.drawingDirty = true;
    this.needsRender = true;
  }

  /**
   * Elements inside a screen rectangle (client px). `crossing` (right-to-left drag in Revit)
   * takes anything touching the rectangle; otherwise elements must lie fully inside it.
   */
  elementsInRect(r: { x0: number; y0: number; x1: number; y1: number }, crossing: boolean): ElementId[] {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const [xa, xb] = [Math.min(r.x0, r.x1), Math.max(r.x0, r.x1)];
    const [ya, yb] = [Math.min(r.y0, r.y1), Math.max(r.y0, r.y1)];
    const out: ElementId[] = [];
    const source: [ElementId, THREE.Group][] =
      this.mode === "drawing"
        ? [...this.drawing.entries(), ...[...this.objects.entries()].filter(([, g]) => g.userData.inDrawing)]
        : [...this.objects.entries()].filter(([, g]) => !g.userData.inDrawing);
    for (const [id, g] of source) {
      if (!g.visible) continue;
      const box = new THREE.Box3().setFromObject(g);
      if (box.isEmpty()) continue;
      if (this.mode === "plan" && (box.min.z > this.planRange.cut || box.max.z < this.planRange.bottom - 1)) continue;
      const pts: { x: number; y: number }[] = [];
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) {
            const v = new THREE.Vector3(x, y, z).project(this.camera);
            pts.push({ x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height });
          }
        }
      }
      const sx = [Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x))];
      const sy = [Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y))];
      const inside = sx[0]! >= xa && sx[1]! <= xb && sy[0]! >= ya && sy[1]! <= yb;
      const touches = sx[1]! >= xa && sx[0]! <= xb && sy[1]! >= ya && sy[0]! <= yb;
      if (crossing ? touches : inside) out.push(id);
    }
    return out;
  }

  /** Swap geometry kernels (e.g. once OpenCascade has loaded) and rebuild everything. */
  setKernel(kernel: GeometryKernel): void {
    this.kernel = kernel;
    this.rebuildAll();
    this.setSelection(this.selected);
  }

  /** Point on the horizontal plane z = elevation under the cursor. */
  pickPlane(ev: { clientX: number; clientY: number }, elevation: number): Vec2 | null {
    this.setRay(ev);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -elevation);
    const p = this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    return p ? { x: p.x, y: p.y } : null;
  }

  setWorkPlane(elevation: number): void {
    this.grid.position.z = elevation;
    this.workPlaneZ = elevation;
    for (const id of this.datums) this.objects.get(id)!.position.z = elevation;
    if (this.previewLines) this.previewLines.position.z = elevation;
    this.needsRender = true;
  }

  // ---- previews (tool feedback) -------------------------------------------

  setPreview(mesh: MeshData | null): void {
    if (this.preview) {
      this.scene.remove(this.preview);
      disposeGroup(this.preview);
      this.preview = null;
    }
    if (mesh) {
      this.preview = makeGroup(mesh, PREVIEW, 0.45);
      this.scene.add(this.preview);
    }
    this.needsRender = true;
  }

  /** Line-work preview (e.g. a grid being drawn), placed on the work plane. */
  setPreviewLines(lines: LineData | null): void {
    if (this.previewLines) {
      this.previewLines.removeFromParent();
      disposeGroup(this.previewLines);
      this.previewLines = null;
    }
    if (lines) {
      this.previewLines = makeLineGroup(lines, PREVIEW);
      if (this.mode === "drawing") {
        this.drawScene.add(this.previewLines);
      } else {
        this.previewLines.position.z = this.workPlaneZ;
        this.scene.add(this.previewLines);
      }
    }
    this.needsRender = true;
  }

  private overlay: THREE.Group | null = null;

  /** Line work shown for the selection (e.g. a section's view extent), each in its own colour. */
  setOverlay(items: { lines: LineData; color: number }[] | null): void {
    if (this.overlay) {
      this.overlay.removeFromParent();
      disposeGroup(this.overlay);
      this.overlay = null;
    }
    if (items?.length) {
      const g = new THREE.Group();
      for (const it of items) g.add(makeLineGroup(it.lines, it.color));
      this.overlay = g;
      if (this.mode === "drawing") this.drawScene.add(g);
      else {
        g.position.z = this.workPlaneZ;
        this.scene.add(g);
      }
    }
    this.needsRender = true;
  }

  // ---- views & camera -----------------------------------------------------

  /** The 3D camera as a view stores it (eye, target, field of view). */
  getCamera3d(): { eye: [number, number, number]; target: [number, number, number]; fov: number } {
    const p = this.camera3d.position;
    const t = this.controls3d.target;
    const r = (n: number) => Math.round(n);
    return { eye: [r(p.x), r(p.y), r(p.z)], target: [r(t.x), r(t.y), r(t.z)], fov: this.camera3d.fov };
  }

  /** Put the 3D camera where a view saved it. */
  setCamera3d(c: { eye: [number, number, number]; target: [number, number, number]; fov?: number }): void {
    this.camera3d.position.set(...c.eye);
    this.controls3d.target.set(...c.target);
    if (c.fov && c.fov !== this.camera3d.fov) {
      this.camera3d.fov = c.fov;
      this.camera3d.updateProjectionMatrix();
    }
    this.controls3d.update();
    this.needsRender = true;
  }

  /** The 3D view's camera (for renders). */
  get perspectiveCamera(): THREE.PerspectiveCamera {
    return this.camera3d;
  }

  /** Model solids as shown now (visible ones, with their shaded colour), for the renderer. */
  renderMeshes(): { id: ElementId; mesh: MeshData; color: number }[] {
    const out: { id: ElementId; mesh: MeshData; color: number }[] = [];
    for (const [id, mesh] of this.meshes) {
      const group = this.objects.get(id);
      if (!group?.visible || !group.userData.solid) continue;
      const solid = group.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh);
      const mat = solid?.material as THREE.MeshStandardMaterial | undefined;
      if (!mat || mat.opacity < 1) continue;
      out.push({ id, mesh, color: (group.userData.baseColor as number | undefined) ?? mat.color.getHex() });
    }
    return out;
  }

  get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.mode === "plan" ? this.cameraPlan : this.mode === "drawing" ? this.cameraDraw : this.camera3d;
  }

  get controls(): OrbitControls {
    return this.mode === "plan" ? this.controlsPlan : this.mode === "drawing" ? this.controlsDraw : this.controls3d;
  }

  /** Show a section/elevation (drawing mode). */
  setDrawingView(view: View): void {
    const reframe = this.drawingView?.id !== view.id || this.sheet !== null;
    this.drawingView = view;
    this.sheet = null;
    this.applyBackground();
    this.setViewMode("drawing");
    this.drawingDirty = true;
    if (reframe) this.zoomToFit();
  }

  private applyBackground(): void {
    this.renderer.setClearColor(this.mode === "3d" ? BG_3D : this.mode === "drawing" && this.sheet ? BG_SHEET : BG_DRAWING);
    this.needsRender = true;
  }

  /** Show a sheet: paper with title block and viewports (drawing mode, paper mm). */
  setSheet(sheet: Sheet): void {
    const reframe = this.sheet?.id !== sheet.id;
    this.sheet = sheet;
    this.drawingView = null;
    this.setViewMode("drawing");
    this.applyBackground();
    this.drawingDirty = true;
    if (reframe) this.zoomToFit();
  }

  /** The kernel in use (OCCT once loaded), for exports. */
  get geometryKernel(): GeometryKernel {
    return this.kernel;
  }

  /** Detail level and scale of the active view (they change how cut and surface patterns draw). */
  setViewGraphics(g: { detailLevel: DetailLevel; scale: number }): void {
    if (g.detailLevel === this.graphics.detailLevel && g.scale === this.graphics.scale) return;
    const rescale = g.scale !== this.graphics.scale;
    this.graphics = g;
    this.drawingDirty = true;
    // Grid bubbles and view markers are sized for the view scale: redraw them.
    if (rescale) for (const el of this.doc.all()) if (SCALED_MARKS.has(el.category)) this.rebuild(el.id);
    // Ducts, pipes, trays and conduit change symbol with detail level (single-line at Coarse).
    if (!rescale) for (const el of this.doc.all()) if (isRunCategory(el.category) || el.category === Cat.FamilyInstance) this.rebuild(el.id);
  }

  /** Callouts crop their plan to a rectangle; null for an uncropped plan. */
  setPlanCrop(crop: Rect | null): void {
    const changed = JSON.stringify(crop) !== JSON.stringify(this.planCrop);
    this.planCrop = crop;
    this.applyClipping();
    if (changed && this.mode === "plan") this.zoomToFit();
  }

  get viewMode(): ViewMode {
    return this.mode;
  }

  /** Switch between the 3D view and a floor plan (top-down, clipped to the plan range). */
  setViewMode(mode: ViewMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.controls3d.enabled = mode === "3d";
    this.controlsPlan.enabled = mode === "plan";
    this.controlsDraw.enabled = mode === "drawing";
    this.applyBackground();
    this.grid.visible = mode === "3d"; // the work-plane grid fights with floor tops in plan
    for (const g of this.objects.values()) this.applyPlanOnly(g);
    this.drawingDirty = true;
    if (mode === "plan" && !this.planFramed) {
      this.planFramed = true;
      this.zoomToFit();
    }
    this.applyClipping();
    this.resize();
  }

  private applyPlanOnly(g: THREE.Object3D): void {
    g.traverse((o) => {
      if (o.userData.planOnly) o.visible = this.mode === "plan";
    });
    // In plan, solids give way to the 2D drawing (their meshes stay pickable while hidden); shaded
    // plan styles show the coloured model under the line work.
    if (g.userData.solid) {
      const shaded = this.modelShaded();
      g.children[0]!.visible = this.mode === "3d" || shaded;
      g.children[0]!.renderOrder = shaded ? -10 : 0;
      g.children[1]!.visible = this.mode === "3d";
    }
  }

  /** Plans, sections and elevations in a shaded style: the coloured model shows under the line work. */
  private modelShaded(): boolean {
    if (!SHADED_STYLES.has(this.visualStyle)) return false;
    if (this.mode === "plan") return true;
    return this.mode === "drawing" && !this.sheet && !!this.drawingView && isDrawingView(this.drawingView);
  }

  private sectionCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 1_000_000);

  /**
   * The model camera behind a section/elevation drawing: looking along the view direction from
   * the cut plane, framed like the drawing camera (drawing x = along the view, y = height).
   */
  private syncSectionCam(): THREE.OrthographicCamera {
    const v = this.drawingView!;
    const f = viewFrame(v);
    const d = this.cameraDraw;
    const cam = this.sectionCam;
    const o = new THREE.Vector3(...f.origin);
    const right = new THREE.Vector3(...f.right);
    const up = new THREE.Vector3(...f.up);
    const dir = new THREE.Vector3(...f.dir);
    cam.up.copy(up);
    cam.position.copy(o).addScaledVector(right, d.position.x).addScaledVector(up, d.position.y);
    cam.lookAt(cam.position.clone().add(dir));
    Object.assign(cam, { left: d.left, right: d.right, top: d.top, bottom: d.bottom, zoom: d.zoom, near: 0.5, far: Math.max(1000, v.params.farClip ?? 1_000_000) });
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    return cam;
  }

  /** Clip the shaded model to a section/elevation's crop (along the view and in height). */
  private sectionClipping(): THREE.Plane[] {
    const v = this.drawingView!;
    const f = viewFrame(v);
    const c = viewCrop(v);
    const right = new THREE.Vector3(...f.right);
    const o = new THREE.Vector3(...f.origin);
    const along = right.dot(o);
    return [
      new THREE.Plane(right.clone(), -(along + c.min.x)),
      new THREE.Plane(right.clone().negate(), along + c.max.x),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -c.min.y),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), c.max.y),
    ];
  }

  /** Recompute the plan drawing (cut + hidden-line projection) for visible solids. */
  private rebuildDrawing(): void {
    for (const g of this.drawing.values()) {
      g.removeFromParent();
      disposeGroup(g);
    }
    this.drawing.clear();
    if (this.drawExtras) {
      this.drawExtras.removeFromParent();
      disposeGroup(this.drawExtras);
      this.drawExtras = null;
    }
    this.drawingDirty = false;
    if (this.mode === "3d") return;
    if (this.mode === "drawing" && this.sheet) {
      const sheet = this.doc.get(this.sheet.id) as Sheet | undefined;
      if (!sheet) return;
      this.sheet = sheet;
      let d: ReturnType<typeof sheetDrawing>;
      try {
        d = sheetDrawing(this.doc, this.kernel, sheet);
      } catch (err) {
        console.warn("Could not draw sheet", err);
        return;
      }
      const paper = renderPaper(d);
      this.drawExtras = paper;
      this.drawScene.add(paper);
      // Each viewport's linework is its own pickable group.
      for (const vp of d.viewports) {
        const g = renderDrawing({ strokes: d.strokes.filter((s) => s.id === vp.id), fills: d.fills.filter((f) => f.id === vp.id), texts: [], bounds: d.bounds });
        g.userData.elementId = vp.id;
        this.drawing.set(vp.id, g);
        this.drawScene.add(g);
        this.applyHighlight(vp.id);
      }
      return;
    }
    // Legends hold no model: their annotations are already in the drawing scene.
    if (this.mode === "drawing" && this.drawingView?.params.kind === "legend") return;
    const drawingMode = this.mode === "drawing" && this.drawingView;
    const items = [...this.meshes.entries()]
      .filter(([id]) => {
        const el = this.doc.get(id);
        if (!el || !this.objects.get(id)?.visible) return false;
        if (!drawingMode && this.graphics.detailLevel === "coarse" && isRunCategory(el.category)) return false; // single-line at Coarse
        return drawingMode || !SYMBOLIC_IN_PLAN.has(el.category); // plans use door/window symbols
      })
      .map(([id, mesh]) => {
        // Surface patterns (e.g. weatherboard lines in elevation) from the element's material.
        const m = elementMaterial(this.doc, this.doc.require(id));
        return { id, mesh, surface: m ? patternFamilies(m.params.surfacePattern, this.graphics.scale) : null };
      });
    let linework: PlanLinework[];
    try {
      linework = drawingMode ? sectionLinework(items, this.drawingView!) : planLinework(items, this.planRange);
    } catch (err) {
      console.warn("Could not compute drawing", err);
      return;
    }
    const target = drawingMode ? this.drawScene : this.scene;
    const z = drawingMode ? 0 : this.planRange.cut - 0.5;
    const frame = drawingMode ? viewFrame(this.drawingView!) : planFrame(this.planRange.cut);
    const detailed = this.graphics.detailLevel !== "coarse";
    // The same line work sheets and PDFs use: wall joins cleaned, layers hatched, overrides applied.
    const d = lineworkDrawing(this.doc, (el) => this.resolveGraphics(el), linework, frame, { detailed, plan: !drawingMode, scale: this.graphics.scale });
    const strokes = new Map<ElementId, Stroke[]>();
    const fills = new Map<ElementId, Fill[]>();
    for (const st of d.strokes) if (st.id) strokes.set(st.id, [...(strokes.get(st.id) ?? []), st]);
    for (const f of d.fills) if (f.id) fills.set(f.id, [...(fills.get(f.id) ?? []), f]);
    for (const lw of linework) {
      const g = makeElementDrawing(strokes.get(lw.id) ?? [], fills.get(lw.id) ?? [], z, this.thinLines ? undefined : (m) => this.trackFat(m));
      g.userData.elementId = lw.id;
      this.drawing.set(lw.id, g);
      target.add(g);
      this.applyHighlight(lw.id);
    }
    if (drawingMode) {
      const view = this.drawingView!;
      const extras = makeLineGroup(sectionAnnotations(this.doc, view), 0x4a5560);
      const crop = viewCrop(view);
      const frame = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(crop.max.x - crop.min.x, crop.max.y - crop.min.y)),
        new THREE.LineDashedMaterial({ color: 0xa0a6ad, dashSize: 300, gapSize: 200 }),
      );
      frame.computeLineDistances();
      frame.position.set((crop.min.x + crop.max.x) / 2, (crop.min.y + crop.max.y) / 2, -1);
      extras.add(frame);
      this.drawExtras = extras;
      this.drawScene.add(extras);
    }
  }

  /** Vertical range shown in plan (usually the active level up to its cut plane). */
  setPlanRange(range: ViewRange): void {
    this.planRange = range;
    this.applyClipping();
  }

  private applyClipping(): void {
    const { bottom, cut } = this.planRange;
    // Keep bottom - 1 mm so floor tops sitting exactly at the level stay visible.
    this.drawingDirty = true;
    const crop = this.planCrop;
    this.renderer.clippingPlanes =
      this.mode === "plan"
        ? [
            new THREE.Plane(new THREE.Vector3(0, 0, -1), cut),
            new THREE.Plane(new THREE.Vector3(0, 0, 1), -(bottom - 1)),
            ...(crop
              ? [
                  new THREE.Plane(new THREE.Vector3(1, 0, 0), -crop.min.x),
                  new THREE.Plane(new THREE.Vector3(-1, 0, 0), crop.max.x),
                  new THREE.Plane(new THREE.Vector3(0, 1, 0), -crop.min.y),
                  new THREE.Plane(new THREE.Vector3(0, -1, 0), crop.max.y),
                ]
              : []),
          ]
        : [];
    this.needsRender = true;
  }

  mmPerPixel(): number {
    const h = Math.max(1, this.renderer.domElement.clientHeight);
    const cam = this.camera;
    if (cam instanceof THREE.OrthographicCamera) return (cam.top - cam.bottom) / cam.zoom / h;
    const dist = cam.position.distanceTo(this.controls.target);
    return (2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) / h;
  }

  /** Fit an orthographic camera to a plan/drawing rectangle. */
  private fitOrtho(cam: THREE.OrthographicCamera, controls: OrbitControls, r: Rect, height: number): void {
    const cx = (r.min.x + r.max.x) / 2;
    const cy = (r.min.y + r.max.y) / 2;
    const w = Math.max(r.max.x - r.min.x, 1);
    const h = Math.max(r.max.y - r.min.y, 1);
    const aspect = (cam.right - cam.left) / (cam.top - cam.bottom);
    cam.zoom = Math.min((cam.top - cam.bottom) / (h * 1.15), ((cam.top - cam.bottom) * aspect) / (w * 1.15));
    cam.position.set(cx, cy, height);
    controls.target.set(cx, cy, 0);
    cam.updateProjectionMatrix();
    controls.update();
    this.needsRender = true;
  }

  zoomToFit(): void {
    if (this.mode === "drawing" && this.sheet) {
      const size = this.sheet.params.size;
      const paper = { A0: [1189, 841], A1: [841, 594], A2: [594, 420], A3: [420, 297], A4: [297, 210] }[size];
      return this.fitOrtho(this.cameraDraw, this.controlsDraw, { min: { x: 0, y: 0 }, max: { x: paper[0]!, y: paper[1]! } }, 1000);
    }
    if (this.mode === "drawing" && this.drawingView?.params.kind === "legend") {
      const box = new THREE.Box3();
      for (const g of this.objects.values()) if (g.userData.inDrawing && g.visible) box.expandByObject(g);
      const b = box.isEmpty() ? { min: { x: 0, y: -3000 }, max: { x: 5000, y: 0 } } : { min: { x: box.min.x - 500, y: box.min.y - 500 }, max: { x: box.max.x + 500, y: box.max.y + 500 } };
      return this.fitOrtho(this.cameraDraw, this.controlsDraw, b, 1000);
    }
    if (this.mode === "drawing" && this.drawingView) {
      const c = viewCrop(this.drawingView);
      return this.fitOrtho(this.cameraDraw, this.controlsDraw, { min: { x: c.min.x - 1500, y: c.min.y }, max: { x: c.max.x + 3000, y: c.max.y + 1200 } }, 1000);
    }
    if (this.mode === "plan" && this.planCrop) return this.fitOrtho(this.cameraPlan, this.controlsPlan, this.planCrop, PLAN_CAMERA_HEIGHT);
    const box = new THREE.Box3();
    for (const g of this.objects.values()) box.expandByObject(g);
    if (box.isEmpty()) return;
    if (this.mode === "plan") {
      return this.fitOrtho(this.cameraPlan, this.controlsPlan, { min: { x: box.min.x, y: box.min.y }, max: { x: box.max.x, y: box.max.y } }, PLAN_CAMERA_HEIGHT);
    }
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const cam = this.camera3d;
    const dir = cam.position.clone().sub(this.controls3d.target).normalize();
    const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2));
    this.controls3d.target.copy(sphere.center);
    cam.position.copy(sphere.center).addScaledVector(dir, dist * 1.1);
    this.controls3d.update();
    this.needsRender = true;
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    for (const m of this.fatMaterials) m.resolution.set(w, h);
    this.renderer.setSize(w, h, false);
    this.camera3d.aspect = w / h;
    this.camera3d.updateProjectionMatrix();
    // Plan frustum is PLAN_HALF_HEIGHT mm tall at zoom 1; OrbitControls zooms via camera.zoom.
    const plan = this.cameraPlan;
    plan.top = PLAN_HALF_HEIGHT;
    plan.bottom = -PLAN_HALF_HEIGHT;
    plan.left = -PLAN_HALF_HEIGHT * (w / h);
    plan.right = PLAN_HALF_HEIGHT * (w / h);
    plan.updateProjectionMatrix();
    for (const cam of [this.cameraDraw]) {
      cam.top = PLAN_HALF_HEIGHT;
      cam.bottom = -PLAN_HALF_HEIGHT;
      cam.left = -PLAN_HALF_HEIGHT * (w / h);
      cam.right = PLAN_HALF_HEIGHT * (w / h);
      cam.updateProjectionMatrix();
    }
    this.needsRender = true;
  }

  private resizer: ResizeObserver;
  private disposed = false;

  /** Stop drawing and free the GPU (tiled panes that close). */
  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.resizer.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private loop = (): void => {
    if (this.disposed) return;
    requestAnimationFrame(this.loop);
    this.controls.update();
    if (this.drawingDirty) {
      this.rebuildDrawing();
      this.needsRender = true;
    }
    if (this.needsRender) {
      const in3d = this.mode === "3d";
      const shaded = this.modelShaded();
      if (this.mode === "drawing" && shaded) {
        // Shaded section/elevation: the model through the section camera (with its sun, shadows,
        // ambient shadows and depth cueing), then the drawing's line work over it.
        const cam = this.syncSectionCam();
        const clip = this.renderer.clippingPlanes;
        this.renderer.clippingPlanes = this.sectionClipping();
        this.scene.fog = this.depthCue ? this.cueFog(cam) : null;
        const gridShown = this.grid.visible;
        this.grid.visible = false;
        if (this.ambientShadows) this.composer(cam).render();
        else this.renderer.render(this.scene, cam);
        this.grid.visible = gridShown;
        this.renderer.clippingPlanes = clip;
        this.renderer.autoClear = false;
        this.renderer.clearDepth();
        this.renderer.render(this.drawScene, this.camera);
        this.renderer.autoClear = true;
      } else if (this.mode === "drawing") {
        this.renderer.render(this.drawScene, this.camera);
      } else {
        this.scene.fog = (in3d || shaded) && this.depthCue ? this.cueFog(this.camera) : null;
        if ((in3d || shaded) && this.ambientShadows) this.composer(this.camera).render();
        else this.renderer.render(this.scene, this.camera);
      }
      this.needsRender = false;
      for (const fn of this.frameListeners) fn();
    }
  };

  private frameListeners = new Set<() => void>();
  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private ground!: THREE.Mesh;
  private ambientShadows = false;
  private depthCue: { start: number; end: number; fade: number } | null = null;
  private modelBox = new THREE.Box3();
  private fx: { composer: EffectComposer; render: RenderPass; ao: GTAOPass; w: number; h: number } | null = null;

  /** Ambient shadows: the scene through a GTAO (ambient occlusion) pass. */
  private composer(cam: THREE.Camera): EffectComposer {
    const size = this.renderer.getSize(new THREE.Vector2());
    const pr = this.renderer.getPixelRatio();
    if (!this.fx) {
      const composer = new EffectComposer(this.renderer);
      const render = new RenderPass(this.scene, cam);
      const ao = new GTAOPass(this.scene, cam, size.x, size.y);
      ao.blendIntensity = 1;
      // Only model solids occlude: bubbles, labels, previews and the ground catcher stay out.
      const gtao = ao as unknown as { _overrideVisibility(): void; _visibilityCache: THREE.Object3D[] };
      const base = gtao._overrideVisibility.bind(gtao);
      gtao._overrideVisibility = () => {
        base();
        this.scene.traverse((o) => {
          if ((o instanceof THREE.Mesh || o instanceof THREE.Sprite) && !o.userData.modelSolid && o.visible) {
            o.visible = false;
            gtao._visibilityCache.push(o);
          }
        });
      };
      composer.addPass(render);
      composer.addPass(ao);
      composer.addPass(new OutputPass());
      this.fx = { composer, render, ao, w: 0, h: 0 };
    }
    const fx = this.fx;
    if (fx.w !== size.x || fx.h !== size.y) {
      fx.composer.setPixelRatio(pr);
      fx.composer.setSize(size.x, size.y);
      fx.w = size.x;
      fx.h = size.y;
    }
    fx.render.camera = cam;
    fx.ao.camera = cam;
    return fx.composer;
  }

  /** Depth cueing as fog: clear up to `start` % of the model's depth, fading to `fade` % at `end`. */
  private cueFog(cam: THREE.Camera): THREE.Fog {
    const c = this.depthCue!;
    const box = this.modelBox.isEmpty() ? new THREE.Box3(new THREE.Vector3(-10000, -10000, 0), new THREE.Vector3(10000, 10000, 6000)) : this.modelBox;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    // Orthographic cameras (plans, sections) measure fog from the camera too, so this holds.
    const d = cam.position.distanceTo(sphere.center);
    const front = Math.max(0, d - sphere.radius);
    const depth = 2 * sphere.radius;
    const near = front + (depth * c.start) / 100;
    const end = Math.max(near + 1, front + (depth * c.end) / 100);
    const far = near + (end - near) / Math.max(0.01, c.fade / 100);
    return new THREE.Fog(BG_3D, near, far);
  }

  /**
   * Sun for the 3D view (Revit's Sun Settings / Shadows): `dir` points towards the sun (project
   * axes, z up), or null for the default studio light. Shadows fall on the model and the ground.
   */
  setSun(
    dir: { x: number; y: number; z: number } | null,
    shadows: boolean,
    lighting: { sun?: number; ambient?: number; shadow?: number; ambientShadows?: boolean; depthCue?: { start: number; end: number; fade: number } | null } = {},
  ): void {
    const box = new THREE.Box3();
    for (const [id, g] of this.objects) if (this.meshes.has(id) && g.visible) box.expandByObject(g);
    this.modelBox = box;
    const sunLevel = (lighting.sun ?? 80) / 80;
    const shadowLevel = (lighting.shadow ?? 50) / 50;
    this.hemi.intensity = 1.6 * ((lighting.ambient ?? 50) / 50);
    this.ambientShadows = !!lighting.ambientShadows;
    this.depthCue = lighting.depthCue ?? null;
    const centre = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const size = box.isEmpty() ? 20000 : box.getSize(new THREE.Vector3()).length();
    const up = dir && dir.z > 0.02 ? new THREE.Vector3(dir.x, dir.y, dir.z).normalize() : new THREE.Vector3(-1, -2, 3).normalize();
    this.sun.position.copy(centre).addScaledVector(up, size * 1.5);
    this.sun.target.position.copy(centre);
    this.sun.target.updateMatrixWorld();
    // Below the horizon: no direct sun.
    this.sun.intensity = (dir && dir.z <= 0.02 ? 0.15 : 1.6) * sunLevel;
    this.sun.shadow.intensity = Math.min(1, shadowLevel);
    (this.ground.material as THREE.ShadowMaterial).opacity = 0.28 * shadowLevel;
    const on = shadows && (!dir || dir.z > 0.02);
    this.renderer.shadowMap.enabled = on;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.sun.castShadow = on;
    if (on) {
      const cam = this.sun.shadow.camera;
      const r = size * 0.75;
      Object.assign(cam, { left: -r, right: r, top: r, bottom: -r, near: 1, far: size * 4 });
      cam.updateProjectionMatrix();
      this.sun.shadow.mapSize.set(2048, 2048);
      this.sun.shadow.bias = -0.0005;
      this.sun.shadow.normalBias = size * 0.0002;
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    const bottom = box.isEmpty() ? 0 : box.min.z;
    this.ground.position.set(centre.x, centre.y, bottom + 1);
    this.ground.scale.set(size * 4, size * 4, 1);
    this.ground.visible = on;
    // Materials need recompiling when shadows switch.
    for (const g of this.objects.values()) g.traverse((o) => o instanceof THREE.Mesh && ((o.material as THREE.Material).needsUpdate = true));
    this.needsRender = true;
  }

  /** Is the element drawn in the current view (after V/G, phase and temporary hide)? */
  isVisible(id: ElementId): boolean {
    return !!this.objects.get(id)?.visible || this.drawing.has(id);
  }

  /** Centre of the selected elements' 3D extents, or null. */
  selectionPivot(): THREE.Vector3 | null {
    const box = new THREE.Box3();
    for (const id of this.selected) {
      const g = this.objects.get(id);
      if (g?.visible) box.expandByObject(g);
    }
    return box.isEmpty() ? null : box.getCenter(new THREE.Vector3());
  }

  private orbitAboutSelection(ev: PointerEvent): void {
    if (this.mode !== "3d" || !(ev.button === 2 || (ev.button === 1 && ev.shiftKey))) return;
    const pivot = this.selectionPivot();
    if (!pivot) return;
    // Take the drag from OrbitControls; rotate the camera and its target rigidly about the pivot,
    // so the view doesn't jump to centre the selection.
    ev.stopImmediatePropagation();
    const el = this.renderer.domElement;
    el.setPointerCapture(ev.pointerId);
    let last = { x: ev.clientX, y: ev.clientY };
    const cam = this.camera3d;
    const target = this.controls3d.target;
    const zUp = new THREE.Vector3(0, 0, 1);
    const turn = (q: THREE.Quaternion) => {
      cam.position.sub(pivot).applyQuaternion(q).add(pivot);
      target.sub(pivot).applyQuaternion(q).add(pivot);
    };
    const move = (mv: PointerEvent) => {
      const dx = mv.clientX - last.x;
      const dy = mv.clientY - last.y;
      last = { x: mv.clientX, y: mv.clientY };
      const k = (2 * Math.PI) / el.clientHeight;
      turn(new THREE.Quaternion().setFromAxisAngle(zUp, -dx * k));
      const dir = target.clone().sub(cam.position).normalize();
      const right = dir.clone().cross(zUp).normalize();
      const pitch = -dy * k;
      // Stop short of looking straight up or down.
      const next = dir.clone().applyAxisAngle(right, pitch);
      if (Math.abs(next.z) < 0.995) turn(new THREE.Quaternion().setFromAxisAngle(right, pitch));
      cam.lookAt(target);
      this.needsRender = true;
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      this.controls3d.update();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  /** Called after each redraw (camera moves, model changes), e.g. to place overlays. */
  onFrame(fn: () => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  /** Client (page) coordinates of a plan point on the work plane, or a drawing/sheet point. */
  toScreen(p: Vec2): { x: number; y: number } {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3(p.x, p.y, this.mode === "drawing" ? 0 : this.workPlaneZ).project(this.camera);
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }
}

function makeGroup(mesh: MeshData, color: number, opacity = 1): THREE.Group {
  const geom = toGeometry(mesh);
  // Multi-material meshes (curtain walls) carry vertex colours; the material colour then tints them.
  const mat = new THREE.MeshStandardMaterial({
    color: mesh.colors ? 0xffffff : color,
    vertexColors: !!mesh.colors,
    roughness: 0.85,
    metalness: 0,
    // Double-sided so walls cut by a plan's clip plane read as filled, not hollow.
    side: THREE.DoubleSide,
    transparent: opacity < 1,
    opacity,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geom, 20),
    new THREE.LineBasicMaterial({ color: 0x14171b, transparent: opacity < 1, opacity }),
  );
  const g = new THREE.Group();
  g.userData.opacity = opacity;
  const solid = new THREE.Mesh(geom, mat);
  // Shadows cost nothing until the view turns them on.
  solid.castShadow = solid.receiveShadow = opacity >= 1;
  solid.userData.modelSolid = true;
  g.add(solid, edges);
  return g;
}

/**
 * Plan linework for one element at the cut plane height: poché fill, then projection lines, then
 * cut outlines on top. Drawn without depth testing so draw order decides what's on top.
 */
function segmentsGeom(seg: number[], z: number): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i < seg.length; i += 4) pos.push(seg[i]!, seg[i + 1]!, z, seg[i + 2]!, seg[i + 3]!, z);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  return geom;
}

/** Screen colour and draw order for each kind of line work (overrides recolour by role). */
const STROKE_ROLE: Partial<Record<Stroke["kind"], { role: string; color: number; order: number }>> = {
  cut: { role: "cut", color: CUT_LINE, order: -1 },
  beyond: { role: "projection", color: BEYOND, order: -2 },
  surface: { role: "surface", color: SURFACE, order: -2.5 },
  hatch: { role: "hatch", color: HATCH, order: -2 },
};

/** One element's cut/projection drawing (from `lineworkDrawing`) as a flat group at height z. */
/** Screen pixels per paper mm for line weights (96 dpi, like Revit's on-screen weights). */
const PX_PER_MM = 96 / 25.4;

/** Line weight on screen, CSS px: a stroke's paper width, or null for a plain 1 px line. */
function strokePixels(st: Stroke): number | null {
  if (!st.width) return null;
  const px = st.width * PX_PER_MM;
  return px >= 1.3 ? px : null;
}

function makeElementDrawing(strokes: Stroke[], fills: Fill[], z: number, fat?: (m: LineMaterial) => void): THREE.Group {
  const g = new THREE.Group();
  const flat = (o: THREE.Object3D, color: number, role: string, order: number) => {
    o.userData.baseColor = color;
    o.userData.role = role;
    o.renderOrder = order;
    g.add(o);
  };
  const mat = <T extends THREE.Material>(m: T) => {
    m.depthTest = false;
    m.depthWrite = false;
    return m;
  };
  for (const f of fills) {
    const tris = fillLoops(f.loops);
    if (!tris.length) continue;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(tris.flatMap((t) => t.flatMap((p) => [p.x, p.y, z]))), 3));
    const color = f.color ?? POCHE;
    flat(new THREE.Mesh(geom, mat(new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }))), color, "poche", -3);
  }
  for (const st of strokes) {
    const r = STROKE_ROLE[st.kind];
    if (!r || !st.segments.length) continue;
    // Line weights (Object Styles): wide lines at the pen's width, unless Thin Lines is on.
    const px = fat ? strokePixels(st) : null;
    if (px !== null && fat) {
      const pos: number[] = [];
      for (let i = 0; i < st.segments.length; i += 4) pos.push(st.segments[i]!, st.segments[i + 1]!, z, st.segments[i + 2]!, st.segments[i + 3]!, z);
      const geom = new LineSegmentsGeometry();
      geom.setPositions(pos);
      const m = new LineMaterial({ color: r.color, linewidth: px, worldUnits: false });
      fat(m);
      flat(new LineSegments2(geom, mat(m)), r.color, r.role, r.order);
      continue;
    }
    flat(new THREE.LineSegments(segmentsGeom(st.segments, z), mat(new THREE.LineBasicMaterial({ color: r.color }))), r.color, r.role, r.order);
  }
  return g;
}

function makeLineGroup(lines: LineData, color: number): THREE.Group {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(lines.segments, 3));
  geom.computeBoundingSphere();
  const g = new THREE.Group();
  g.userData.planOnly = !!lines.planOnly;
  const segs = new THREE.LineSegments(
    geom,
    lines.dashed ? new THREE.LineDashedMaterial({ color, dashSize: 400, gapSize: 200 }) : new THREE.LineBasicMaterial({ color }),
  );
  if (lines.dashed) segs.computeLineDistances();
  segs.position.z = DATUM_LIFT;
  g.add(segs);
  if (lines.fill) {
    // Filled regions: translucent fill under the outline. Added after it, so child 0 stays the
    // outline (picking and highlighting use child 0).
    const tris = fillLoops(lines.fill.loops);
    const fillGeom = new THREE.BufferGeometry();
    fillGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(tris.flatMap((t) => t.flatMap((p) => [p.x, p.y, 0]))), 3));
    const fill = new THREE.Mesh(
      fillGeom,
      new THREE.MeshBasicMaterial({ color: lines.fill.color, transparent: !lines.fill.opaque, opacity: lines.fill.opaque ? 1 : 0.55, side: THREE.DoubleSide, depthWrite: false }),
    );
    fill.position.z = DATUM_LIFT - 0.5;
    fill.renderOrder = -4;
    g.add(fill);
  }
  for (const label of lines.labels) {
    const { texture, aspect } = labelTexture(label.text, label.size !== undefined, undefined, label.align === "left");
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
    sprite.position.set(label.position[0], label.position[1], label.position[2] + DATUM_LIFT);
    if (label.size !== undefined) {
      // Text labels: `size` is the cap height in mm; the texture is twice that tall.
      sprite.scale.set(label.size * 2 * aspect, label.size * 2, 1);
      if (label.align === "left") sprite.center.set(0, 0.5);
    } else {
      sprite.scale.setScalar(GRID_BUBBLE_RADIUS * 1.6); // fits a grid bubble
    }
    g.add(sprite);
  }
  return g;
}

/** Text texture. Bubble labels are square; free text is as wide as it needs (`aspect` = width / height). */
function labelTexture(text: string, free: boolean, color = "#1f2328", left = true): { texture: THREE.CanvasTexture; aspect: number } {
  const h = 128;
  const canvas = document.createElement("canvas");
  const c0 = canvas.getContext("2d")!;
  const font = free ? `500 64px system-ui, sans-serif` : `600 ${text.length > 2 ? 40 : 60}px system-ui, sans-serif`;
  c0.font = font;
  const w = free ? Math.max(h, Math.ceil(c0.measureText(text).width + 16)) : h;
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d")!;
  c.font = font;
  c.fillStyle = color;
  // Left-aligned text starts at the anchor; centred text (bubbles, tags) sits on it.
  const atLeft = free && left;
  c.textAlign = atLeft ? "left" : "center";
  c.textBaseline = "middle";
  c.fillText(text, atLeft ? 8 : w / 2, h / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: w / h };
}

function disposeGroup(g: THREE.Group): void {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.LineLoop) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    } else if (o instanceof THREE.Sprite) {
      o.material.map?.dispose();
      o.material.dispose();
    }
  });
}

// ---- sheets ---------------------------------------------------------------------------

/** Ink colours on white paper, by stroke kind. */
const INK: Record<StrokeKind, number> = {
  cut: 0x111111,
  beyond: 0x444444,
  hatch: 0x777777,
  surface: 0x888888,
  annotation: 0x222222,
  datum: 0x555555,
  symbol: 0x333333,
};

/** Render 2D drawing primitives (paper mm) as dark ink. */
function renderDrawing(d: Drawing): THREE.Group {
  const g = new THREE.Group();
  const byStyle = new Map<string, number[]>();
  for (const s of d.strokes) {
    const color = s.halftone ? 0x999999 : (s.color ?? INK[s.kind]);
    const key = `${color}|${s.dashed ? 1 : 0}`;
    const list = byStyle.get(key) ?? [];
    list.push(...s.segments);
    byStyle.set(key, list);
  }
  for (const [key, seg] of byStyle) {
    const [c, dashed] = key.split("|");
    const color = Number(c);
    const geom = segmentsGeom(seg, 1);
    const line = new THREE.LineSegments(
      geom,
      dashed === "1" ? new THREE.LineDashedMaterial({ color, dashSize: 3, gapSize: 2 }) : new THREE.LineBasicMaterial({ color }),
    );
    if (dashed === "1") line.computeLineDistances();
    line.userData.baseColor = color;
    g.add(line);
  }
  for (const f of d.fills) {
    const tris = fillLoops(f.loops);
    if (!tris.length) continue;
    const color = f.kind === "poche" ? 0x8c8c8c : f.kind === "solid" ? 0x333333 : (f.color ?? 0xbbbbbb);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(tris.flatMap((t) => t.flatMap((p) => [p.x, p.y, 0.5]))), 3));
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: f.kind === "region", opacity: 0.6 }));
    mesh.userData.baseColor = color;
    g.add(mesh);
  }
  for (const t of d.texts) {
    const { texture, aspect } = labelTexture(t.text, true, "#111111", t.align === "left");
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
    sprite.position.set(t.x, t.y, 2);
    sprite.scale.set(t.size * 2 * aspect, t.size * 2, 1);
    if (t.align === "left") sprite.center.set(0, 0.5);
    g.add(sprite);
  }
  return g;
}

/** White paper with a drop shadow, plus the sheet's own linework (border, title block, titles). */
function renderPaper(d: Drawing & { width: number; height: number; viewports: { id: ElementId }[] }): THREE.Group {
  const g = new THREE.Group();
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(d.width, d.height), new THREE.MeshBasicMaterial({ color: 0x9da2a8 }));
  shadow.position.set(d.width / 2 + 3, d.height / 2 - 3, -2);
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(d.width, d.height), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  paper.position.set(d.width / 2, d.height / 2, -1);
  g.add(shadow, paper);
  const vpIds = new Set(d.viewports.map((v) => v.id));
  g.add(renderDrawing({ strokes: d.strokes.filter((s) => !s.id || !vpIds.has(s.id)), fills: d.fills.filter((f) => !f.id || !vpIds.has(f.id)), texts: d.texts, bounds: d.bounds }));
  return g;
}
