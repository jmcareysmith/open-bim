import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  Cat,
  PLAN_CUT_HEIGHT,
  type ChangeSet,
  type Document,
  type ElementId,
  type Vec2,
  type ViewRange,
} from "@open-bim/core";
import { GRID_BUBBLE_RADIUS, type GeometryKernel, type LineData, type MeshData } from "@open-bim/geometry";

// Model space is millimetres with Z up (Revit convention).
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const COLORS: Record<string, number> = {
  [Cat.Wall]: 0xd9d4c7,
  [Cat.Floor]: 0x9aa3ad,
  [Cat.Grid]: 0xb8c7d6,
  [Cat.ReferencePlane]: 0x4caf50,
};
const SELECTED = 0x3d8bfd;
const PREVIEW = 0x5fb3ff;
export type ViewMode = "3d" | "plan";
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
  private mode: ViewMode = "3d";
  private planRange: ViewRange = { bottom: 0, cut: PLAN_CUT_HEIGHT };
  private planFramed = false;
  private objects = new Map<ElementId, THREE.Group>();
  private selected = new Set<ElementId>();
  private preview: THREE.Group | null = null;
  private previewLines: THREE.Group | null = null;
  /** Datums (grids) are drawn at the work plane, like a plan view of the active level. */
  private datums = new Set<ElementId>();
  private workPlaneZ = 0;
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
    this.renderer.setClearColor(0x1b1e23);
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

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-1, -2, 3);
    this.scene.add(sun);

    this.grid = new THREE.GridHelper(60000, 60, 0x3a414c, 0x2a2f37);
    this.grid.rotation.x = Math.PI / 2; // GridHelper is XZ; rotate into XY
    this.scene.add(this.grid);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();

    doc.on((c) => this.sync(c));
    this.rebuildAll();
    this.loop();
  }

  // ---- sync ----------------------------------------------------------------

  rebuildAll(): void {
    for (const id of [...this.objects.keys()]) this.remove(id);
    for (const el of this.doc.all()) this.rebuild(el.id);
    this.needsRender = true;
  }

  private sync(c: ChangeSet): void {
    for (const id of c.removed) this.remove(id);
    for (const id of c.regenerate) this.rebuild(id);
    for (const id of [...this.selected]) if (!this.doc.has(id)) this.selected.delete(id);
    this.needsRender = true;
  }

  private remove(id: ElementId): void {
    const obj = this.objects.get(id);
    if (!obj) return;
    this.scene.remove(obj);
    disposeGroup(obj);
    this.objects.delete(id);
    this.datums.delete(id);
  }

  private rebuild(id: ElementId): void {
    this.remove(id);
    const el = this.doc.get(id);
    if (!el) return;
    let group: THREE.Group;
    try {
      const mesh = this.kernel.build(this.doc, el);
      const lines = mesh ? null : this.kernel.buildLines(this.doc, el);
      if (mesh) group = makeGroup(mesh, COLORS[el.category] ?? 0xcccccc);
      else if (lines) {
        group = makeLineGroup(lines, COLORS[el.category] ?? 0xcccccc);
        group.position.z = this.workPlaneZ;
        this.datums.add(id);
      } else return;
    } catch (err) {
      console.warn(`Could not build ${el.category} ${id}`, err);
      return;
    }
    group.userData.elementId = id;
    this.objects.set(id, group);
    this.scene.add(group);
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
    if (!g || !el) return;
    const mesh = g.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial | THREE.LineBasicMaterial>;
    mesh.material.color.setHex(this.selected.has(id) ? SELECTED : (COLORS[el.category] ?? 0xcccccc));
  }

  // ---- picking ------------------------------------------------------------

  private setRay(ev: { clientX: number; clientY: number }): void {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
  }

  /** Element under the cursor, nearest first. */
  pick(ev: { clientX: number; clientY: number }): ElementId | null {
    this.setRay(ev);
    // Line picking tolerance: a few pixels, in mm at the current zoom.
    this.raycaster.params.Line.threshold = this.mmPerPixel() * 6;
    const meshes = [...this.objects.values()].map((g) => g.children[0]!);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    return (hit?.object.parent?.userData.elementId as ElementId | undefined) ?? null;
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
      this.scene.remove(this.previewLines);
      disposeGroup(this.previewLines);
      this.previewLines = null;
    }
    if (lines) {
      this.previewLines = makeLineGroup(lines, PREVIEW);
      this.previewLines.position.z = this.workPlaneZ;
      this.scene.add(this.previewLines);
    }
    this.needsRender = true;
  }

  // ---- views & camera -----------------------------------------------------

  get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.mode === "plan" ? this.cameraPlan : this.camera3d;
  }

  get controls(): OrbitControls {
    return this.mode === "plan" ? this.controlsPlan : this.controls3d;
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
    this.grid.visible = mode === "3d"; // the work-plane grid fights with floor tops in plan
    if (mode === "plan" && !this.planFramed) {
      this.planFramed = true;
      this.zoomToFit();
    }
    this.applyClipping();
    this.resize();
  }

  /** Vertical range shown in plan (usually the active level up to its cut plane). */
  setPlanRange(range: ViewRange): void {
    this.planRange = range;
    this.applyClipping();
  }

  private applyClipping(): void {
    const { bottom, cut } = this.planRange;
    // Keep bottom - 1 mm so floor tops sitting exactly at the level stay visible.
    this.renderer.clippingPlanes =
      this.mode === "plan"
        ? [new THREE.Plane(new THREE.Vector3(0, 0, -1), cut), new THREE.Plane(new THREE.Vector3(0, 0, 1), -(bottom - 1))]
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

  zoomToFit(): void {
    const box = new THREE.Box3();
    for (const g of this.objects.values()) box.expandByObject(g);
    if (box.isEmpty()) return;
    if (this.mode === "plan") {
      const c = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const cam = this.cameraPlan;
      const aspect = (cam.right - cam.left) / (cam.top - cam.bottom);
      cam.zoom = Math.min((cam.top - cam.bottom) / (size.y * 1.15), ((cam.top - cam.bottom) * aspect) / (size.x * 1.15));
      cam.position.set(c.x, c.y, PLAN_CAMERA_HEIGHT);
      this.controlsPlan.target.set(c.x, c.y, 0);
      cam.updateProjectionMatrix();
      this.controlsPlan.update();
      this.needsRender = true;
      return;
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
    this.needsRender = true;
  }

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    this.controls.update();
    if (this.needsRender) {
      this.renderer.render(this.scene, this.camera);
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

function makeLineGroup(lines: LineData, color: number): THREE.Group {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(lines.segments, 3));
  geom.computeBoundingSphere();
  const g = new THREE.Group();
  const segs = new THREE.LineSegments(
    geom,
    lines.dashed ? new THREE.LineDashedMaterial({ color, dashSize: 400, gapSize: 200 }) : new THREE.LineBasicMaterial({ color }),
  );
  if (lines.dashed) segs.computeLineDistances();
  segs.position.z = DATUM_LIFT;
  g.add(segs);
  for (const label of lines.labels) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(label.text), transparent: true }));
    sprite.position.set(label.position[0], label.position[1], label.position[2] + DATUM_LIFT);
    sprite.scale.setScalar(GRID_BUBBLE_RADIUS * 1.6);
    g.add(sprite);
  }
  return g;
}

function labelTexture(text: string): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#d7dee6";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = `600 ${text.length > 2 ? 40 : 60}px system-ui, sans-serif`;
  c.fillText(text, size / 2, size / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function disposeGroup(g: THREE.Group): void {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    } else if (o instanceof THREE.Sprite) {
      o.material.map?.dispose();
      o.material.dispose();
    }
  });
}
