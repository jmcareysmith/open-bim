import * as THREE from "three";

// ViewCube (Revit's navigation cube, top right of 3D views): a shaded cube that turns with the
// camera, its face names on the faces, sitting in a compass ring marked N, E, S, W. Click a face
// to look at it square on (FRONT = from the south, RIGHT = from the east…), near an edge or corner
// for that view, or the house for the home view. Right-click for Orthographic / Perspective.

const PX = 152;
/** The cube's half size inside the compass ring (outer radius about 2.6). */
const CUBE = 0.85;

type V = [number, number, number];

const FACES: { label: string; n: V; right: V; up: V }[] = [
  { label: "TOP", n: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] },
  { label: "BOTTOM", n: [0, 0, -1], right: [1, 0, 0], up: [0, -1, 0] },
  { label: "FRONT", n: [0, -1, 0], right: [1, 0, 0], up: [0, 0, 1] },
  { label: "BACK", n: [0, 1, 0], right: [-1, 0, 0], up: [0, 0, 1] },
  { label: "RIGHT", n: [1, 0, 0], right: [0, 1, 0], up: [0, 0, 1] },
  { label: "LEFT", n: [-1, 0, 0], right: [0, -1, 0], up: [0, 0, 1] },
];

export interface ViewCubeHost {
  /** Look from `dir` (towards the target), keeping the target. */
  lookFrom(dir: V): void;
  home(): void;
  menu(ev: MouseEvent): void;
}

/** A face texture: light grey with a soft bevel and the face's name. */
function faceTexture(label: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, "#f7f8f9");
  grad.addColorStop(1, "#dfe2e6");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "#a9afb6";
  g.lineWidth = 6;
  g.strokeRect(3, 3, 122, 122);
  g.strokeStyle = "#ffffff";
  g.lineWidth = 2;
  g.strokeRect(9, 9, 110, 110);
  g.fillStyle = "#3e454c";
  g.font = `600 ${label.length > 5 ? 26 : 30}px "Segoe UI", system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(label, 64, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A blurred dark square: the cube's shadow on the ring's plane. */
function shadowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.filter = "blur(8px)";
  g.fillStyle = "rgba(40, 46, 54, 0.5)";
  g.fillRect(16, 16, 96, 96);
  return new THREE.CanvasTexture(c);
}

/** The compass ring under the cube, with N, E, S, W. */
function ringTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.translate(128, 128);
  g.beginPath();
  g.arc(0, 0, 120, 0, Math.PI * 2);
  g.arc(0, 0, 82, 0, Math.PI * 2, true);
  g.fillStyle = "rgba(201, 206, 212, 0.92)";
  g.fill();
  g.strokeStyle = "rgba(140, 147, 156, 0.9)";
  g.lineWidth = 2;
  g.beginPath();
  g.arc(0, 0, 120, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(0, 0, 82, 0, Math.PI * 2);
  g.stroke();
  g.font = '700 26px "Segoe UI", system-ui, sans-serif';
  g.textAlign = "center";
  g.textBaseline = "middle";
  // Canvas y runs down; the ring's texture is drawn so +y (north) is up.
  const marks: [string, number, number][] = [
    ["N", 0, -101],
    ["S", 0, 101],
    ["E", 101, 0],
    ["W", -101, 0],
  ];
  for (const [t, x, y] of marks) {
    g.fillStyle = t === "N" ? "#b03a2e" : "#3e454c";
    g.fillText(t, x, y);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class ViewCube {
  readonly el: HTMLDivElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-2.85, 2.85, 2.85, -2.85, 0.1, 50);
  private faces: THREE.Mesh[] = [];
  private cube = new THREE.Group();
  private raycaster = new THREE.Raycaster();
  private hover: THREE.Mesh | null = null;
  private lastQuat = new THREE.Quaternion();

  constructor(container: HTMLElement, private host: ViewCubeHost) {
    this.el = document.createElement("div");
    this.el.className = "viewcube";
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(PX, PX, false);
    this.renderer.setClearColor(0x000000, 0);
    const canvas = this.renderer.domElement;
    canvas.style.width = canvas.style.height = `${PX}px`;
    const home = document.createElement("button");
    home.className = "viewcube-home";
    home.title = "Home view";
    home.textContent = "⌂";
    home.onclick = () => host.home();
    this.el.append(canvas, home);
    this.el.oncontextmenu = (ev) => {
      ev.preventDefault();
      host.menu(ev);
    };
    canvas.addEventListener("pointermove", (ev) => this.onHover(ev));
    canvas.addEventListener("pointerleave", () => this.setHover(null));
    canvas.addEventListener("click", (ev) => this.onClick(ev));
    container.append(this.el);
    this.build();
  }

  private build(): void {
    // Shading fixed in the world, lit from above and the south-west: the top is brightest, the
    // sides fall off by direction, so the cube reads as a solid as it turns.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd0d4d8, 1.95));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(-0.35, -1, 1.6);
    this.scene.add(key);
    this.scene.add(this.camera);
    for (const f of FACES) {
      const mat = new THREE.MeshLambertMaterial({ map: faceTexture(f.label) });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
      const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(...f.right), new THREE.Vector3(...f.up), new THREE.Vector3(...f.n));
      m.quaternion.setFromRotationMatrix(basis);
      m.position.set(...f.n);
      m.userData.normal = f.n;
      this.faces.push(m);
      this.cube.add(m);
    }
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2)), new THREE.LineBasicMaterial({ color: 0x7d858e }));
    this.cube.add(edges);
    this.cube.scale.setScalar(CUBE);
    this.scene.add(this.cube);
    // A soft contact shadow under the cube, on the ring's plane.
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.4 * CUBE, 3.4 * CUBE), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
    shadow.position.set(0.1, 0.1, -CUBE - 0.01);
    shadow.renderOrder = -1;
    this.scene.add(shadow);
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 5.6), new THREE.MeshBasicMaterial({ map: ringTexture(), transparent: true, depthWrite: false }));
    ring.position.z = -CUBE - 0.02;
    ring.renderOrder = -1;
    this.scene.add(ring);
  }

  set visible(v: boolean) {
    this.el.hidden = !v;
  }

  /** Turn the cube to match the camera. */
  update(camera: THREE.Camera): void {
    if (this.el.hidden) return;
    const q = camera.getWorldQuaternion(new THREE.Quaternion());
    if (q.equals(this.lastQuat)) return;
    this.lastQuat.copy(q);
    this.place(q);
    this.draw();
  }

  private place(q: THREE.Quaternion): void {
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    this.camera.position.copy(back.multiplyScalar(10));
    this.camera.quaternion.copy(q);
    this.camera.updateMatrixWorld();
  }

  private draw(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private hitAt(ev: MouseEvent): THREE.Intersection | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.intersectObjects(this.faces, false)[0] ?? null;
  }

  private setHover(m: THREE.Mesh | null): void {
    if (m === this.hover) return;
    if (this.hover) (this.hover.material as THREE.MeshLambertMaterial).color.set(0xffffff);
    this.hover = m;
    if (m) (m.material as THREE.MeshLambertMaterial).color.set(0xbcd8fb);
    this.renderer.domElement.style.cursor = m ? "pointer" : "";
    this.draw();
  }

  private onHover(ev: PointerEvent): void {
    this.setHover((this.hitAt(ev)?.object as THREE.Mesh | undefined) ?? null);
  }

  /** A face picks its square view; near an edge or corner, that edge's or corner's view. */
  private onClick(ev: MouseEvent): void {
    const hit = this.hitAt(ev);
    if (!hit) return;
    const p = this.cube.worldToLocal(hit.point.clone());
    const dir: V = [Math.abs(p.x) > 0.6 ? Math.sign(p.x) : 0, Math.abs(p.y) > 0.6 ? Math.sign(p.y) : 0, Math.abs(p.z) > 0.6 ? Math.sign(p.z) : 0];
    if (!dir.some((d) => d !== 0)) return;
    this.host.lookFrom(dir);
  }
}
