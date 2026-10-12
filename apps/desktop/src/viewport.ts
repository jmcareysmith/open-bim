import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
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
  type MaterialParams,
  type ResolvedGraphics,
  type Sheet,
  type ViewParams,
  type ChangeSet,
  type Document,
  type ElementId,
  type Vec2,
  type View,
  type ViewRange,
  viewCrop,
  planLevelOf,
} from "@open-bim/core";
import {
  GRID_BUBBLE_RADIUS,
  fillLoops,
  layerRegions,
  patternFamilies,
  hatch,
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
} from "@open-bim/geometry";

// Model space is millimetres with Z up (Revit convention).
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const COLORS: Record<string, number> = {
  [Cat.Wall]: 0xd9d4c7,
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
  [Cat.View]: 0x2b2f36,
  [Cat.DetailLine]: 0x1f2328,
  [Cat.Dimension]: 0x1f2328,
  [Cat.TextNote]: 0x1f2328,
  [Cat.FilledRegion]: 0x1f2328,
  [Cat.Room]: 0x7a8fa6,
  [Cat.RoomSeparator]: 0x1f2328,
  [Cat.Area]: 0x9a6b2f,
  [Cat.AreaBoundary]: 0x9a3fb5,
  [Cat.CadImport]: 0x5a6470,
};
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
  private resolveGraphics: (el: Element) => ResolvedGraphics = () => ({ visible: true, halftone: false, color: null });
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

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-1, -2, 3);
    this.scene.add(sun);

    this.grid = new THREE.GridHelper(60000, 60, 0xc4c9cf, 0xd6dadf);
    this.grid.rotation.x = Math.PI / 2; // GridHelper is XZ; rotate into XY
    this.scene.add(this.grid);

    new ResizeObserver(() => this.resize()).observe(container);
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
      const lines = this.kernel.buildLines(this.doc, el);
      if (mesh) {
        this.meshes.set(id, mesh);
        const material = elementMaterial(this.doc, el);
        // Family voids show as translucent orange in the family editor (Revit convention).
        const isVoid = isFormCategory(el.category) && (el.params as { isVoid?: boolean }).isVoid;
        group = isVoid ? makeGroup(mesh, VOID_COLOR, 0.35) : makeGroup(mesh, material?.params.color ?? (el.params as { color?: number }).color ?? COLORS[el.category] ?? 0xcccccc);
        group.userData.baseColor = material?.params.color;
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
      d.traverse((o) => {
        if (!(o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.LineLoop)) return;
        (o.material as THREE.MeshBasicMaterial).color.setHex(this.displayColor(el, o.userData.baseColor as number));
      });
    }
    if (!g || !el) return;
    const mesh = g.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial | THREE.LineBasicMaterial>;
    const base = (g.userData.baseColor as number | undefined) ?? COLORS[el.category] ?? 0xcccccc;
    mesh.material.color.setHex(this.displayColor(el, base));
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
  private displayColor(el: Element, base: number): number {
    if (this.selected.has(el.id)) return SELECTED;
    const g = this.resolveGraphics(el);
    const c = g.color ?? base;
    return g.halftone ? blend(c, HALFTONE_TOWARD, 0.6) : c;
  }

  private isShown(el: { id: ElementId; category: string; params: unknown }): boolean {
    const owner = annotationView(el as never);
    if (owner && owner !== this.annotationViewId) return false;
    const lvl = planLevelOf(el as Element);
    if (lvl && lvl !== this.planLevelId) return false;
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

  // ---- views & camera -----------------------------------------------------

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
    this.graphics = g;
    this.drawingDirty = true;
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
    // In plan, solids give way to the 2D drawing (their meshes stay pickable while hidden).
    if (g.userData.solid) {
      g.children[0]!.visible = this.mode === "3d";
      g.children[1]!.visible = this.mode === "3d";
    }
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
    for (const lw of linework) {
      const el = this.doc.require(lw.id);
      // Medium/fine: split cuts into layers, each hatched with its material's cut pattern.
      const regions = detailed
        ? layerRegions(this.doc, el, lw.cutLoops, frame).map((r) => {
            const m = r.materialId ? this.doc.get<MaterialParams>(r.materialId) : undefined;
            const pattern = m?.params.cutPattern ?? "diagonal";
            const fam = patternFamilies(pattern, this.graphics.scale);
            return { loop: r.loop, solid: pattern === "solid", hatch: fam ? hatch([r.loop], fam) : [] };
          })
        : null;
      const g = makeDrawingGroup(lw, z, regions);
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

  private mmPerPixel(): number {
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

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    this.controls.update();
    if (this.drawingDirty) {
      this.rebuildDrawing();
      this.needsRender = true;
    }
    if (this.needsRender) {
      this.renderer.render(this.mode === "drawing" ? this.drawScene : this.scene, this.camera);
      this.needsRender = false;
    }
  };
}

function makeGroup(mesh: MeshData, color: number, opacity = 1): THREE.Group {
  const geom = toGeometry(mesh);
  const mat = new THREE.MeshStandardMaterial({
    color,
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
  g.add(new THREE.Mesh(geom, mat), edges);
  return g;
}

/**
 * Plan linework for one element at the cut plane height: poché fill, then projection lines, then
 * cut outlines on top. Drawn without depth testing so draw order decides what's on top.
 */
type CutRegion = { loop: Vec2[]; solid: boolean; hatch: number[] };

function segmentsGeom(seg: number[], z: number): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i < seg.length; i += 4) pos.push(seg[i]!, seg[i + 1]!, z, seg[i + 2]!, seg[i + 3]!, z);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  return geom;
}

/**
 * Plan/section linework for one element: poché (coarse) or layer regions with cut patterns
 * (medium/fine), projection and surface-pattern lines, then cut outlines on top.
 */
function makeDrawingGroup(lw: PlanLinework, z: number, regions: CutRegion[] | null = null): THREE.Group {
  const g = new THREE.Group();
  const flat = (o: THREE.Object3D, color: number, order: number) => {
    o.userData.baseColor = color;
    o.renderOrder = order;
    g.add(o);
  };
  const mat = <T extends THREE.Material>(m: T) => {
    m.depthTest = false;
    m.depthWrite = false;
    return m;
  };
  const tris = regions ? fillLoops(regions.filter((r) => r.solid).map((r) => r.loop)) : fillLoops(lw.cutLoops);
  if (regions) {
    for (const r of regions) {
      if (r.hatch.length) flat(new THREE.LineSegments(segmentsGeom(r.hatch, z), mat(new THREE.LineBasicMaterial({ color: HATCH }))), HATCH, -2);
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(r.loop.flatMap((p) => [p.x, p.y, z])), 3));
      flat(new THREE.LineLoop(geom, mat(new THREE.LineBasicMaterial({ color: BEYOND }))), BEYOND, -2);
    }
  }
  if (lw.surface?.length) {
    flat(new THREE.LineSegments(segmentsGeom(lw.surface, z), mat(new THREE.LineBasicMaterial({ color: SURFACE }))), SURFACE, -2.5);
  }
  if (tris.length) {
    const pos = new Float32Array(tris.flatMap((t) => t.flatMap((p) => [p.x, p.y, z])));
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    flat(new THREE.Mesh(geom, mat(new THREE.MeshBasicMaterial({ color: POCHE, side: THREE.DoubleSide }))), POCHE, -3);
  }
  if (lw.projection.length) {
    const pos: number[] = [];
    for (let i = 0; i < lw.projection.length; i += 4) {
      pos.push(lw.projection[i]!, lw.projection[i + 1]!, z, lw.projection[i + 2]!, lw.projection[i + 3]!, z);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    flat(new THREE.LineSegments(geom, mat(new THREE.LineBasicMaterial({ color: BEYOND }))), BEYOND, -2);
  }
  for (const loop of lw.cutLoops) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(loop.flatMap((p) => [p.x, p.y, z])), 3));
    flat(new THREE.LineLoop(geom, mat(new THREE.LineBasicMaterial({ color: CUT_LINE }))), CUT_LINE, -1);
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
      new THREE.MeshBasicMaterial({ color: lines.fill.color, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
    );
    fill.position.z = DATUM_LIFT - 0.5;
    fill.renderOrder = -4;
    g.add(fill);
  }
  for (const label of lines.labels) {
    const { texture, aspect } = labelTexture(label.text, label.size !== undefined);
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
function labelTexture(text: string, free: boolean, color = "#1f2328"): { texture: THREE.CanvasTexture; aspect: number } {
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
  c.textAlign = free ? "left" : "center";
  c.textBaseline = "middle";
  c.fillText(text, free ? 8 : w / 2, h / 2 + 2);
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
    const { texture, aspect } = labelTexture(t.text, true, "#111111");
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
