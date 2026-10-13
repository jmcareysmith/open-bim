import * as THREE from "three";

// ViewCube (Revit's navigation cube, top right of 3D views): a cube that turns with the camera.
// Click a face to look at it square on (TOP, FRONT = from the south, RIGHT = from the east…), a
// corner for that isometric view, or the house for the home view. Right-click for Orthographic /
// Perspective and fitting.

const SIZE = 104;
const HALF = 26;

type V = [number, number, number];

const FACES: { label: string; normal: V; corners: V[] }[] = [
  { label: "TOP", normal: [0, 0, 1], corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { label: "BOTTOM", normal: [0, 0, -1], corners: [[-1, 1, -1], [1, 1, -1], [1, -1, -1], [-1, -1, -1]] },
  { label: "FRONT", normal: [0, -1, 0], corners: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  { label: "BACK", normal: [0, 1, 0], corners: [[1, 1, -1], [-1, 1, -1], [-1, 1, 1], [1, 1, 1]] },
  { label: "LEFT", normal: [-1, 0, 0], corners: [[-1, 1, -1], [-1, -1, -1], [-1, -1, 1], [-1, 1, 1]] },
  { label: "RIGHT", normal: [1, 0, 0], corners: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
];

export interface ViewCubeHost {
  /** Look from `dir` (towards the target), keeping the target. */
  lookFrom(dir: V): void;
  home(): void;
  menu(ev: MouseEvent): void;
}

export class ViewCube {
  readonly el: HTMLDivElement;
  private svg: SVGSVGElement;

  constructor(container: HTMLElement, private host: ViewCubeHost) {
    this.el = document.createElement("div");
    this.el.className = "viewcube";
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("width", String(SIZE));
    this.svg.setAttribute("height", String(SIZE));
    this.svg.setAttribute("viewBox", `${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`);
    const home = document.createElement("button");
    home.className = "viewcube-home";
    home.title = "Home view";
    home.textContent = "⌂";
    home.onclick = () => host.home();
    this.el.append(this.svg, home);
    this.el.oncontextmenu = (ev) => {
      ev.preventDefault();
      host.menu(ev);
    };
    container.append(this.el);
  }

  set visible(v: boolean) {
    this.el.hidden = !v;
  }

  /** Turn the cube to match the camera. */
  update(camera: THREE.Camera): void {
    if (this.el.hidden) return;
    const inv = new THREE.Matrix4().extractRotation(camera.matrixWorldInverse);
    const view = (p: V) => new THREE.Vector3(...p).applyMatrix4(inv);
    const ns = "http://www.w3.org/2000/svg";
    const parts: { depth: number; node: SVGElement }[] = [];
    for (const f of FACES) {
      const n = view(f.normal);
      if (n.z <= 0.02) continue; // facing away
      const pts = f.corners.map((c) => view(c).multiplyScalar(HALF));
      const poly = document.createElementNS(ns, "polygon");
      poly.setAttribute("points", pts.map((p) => `${p.x.toFixed(1)},${(-p.y).toFixed(1)}`).join(" "));
      poly.setAttribute("class", "vc-face");
      poly.onclick = () => this.host.lookFrom(f.normal);
      const g = document.createElementNS(ns, "g");
      g.append(poly);
      // Label at the face centre, squashed with the face.
      const c = view(f.normal).multiplyScalar(HALF);
      const t = document.createElementNS(ns, "text");
      t.setAttribute("x", c.x.toFixed(1));
      t.setAttribute("y", (-c.y + 3).toFixed(1));
      t.setAttribute("class", "vc-label");
      t.setAttribute("font-size", String(Math.max(5, 9 * Math.min(1, n.z + 0.3))));
      t.textContent = f.label;
      g.append(t);
      parts.push({ depth: n.z, node: g });
    }
    // Corners: isometric views from that corner.
    for (const x of [-1, 1]) {
      for (const y of [-1, 1]) {
        for (const z of [-1, 1]) {
          const p = view([x, y, z]);
          if (p.z < 0.2) continue;
          const dot = document.createElementNS(ns, "circle");
          dot.setAttribute("cx", (p.x * HALF).toFixed(1));
          dot.setAttribute("cy", (-p.y * HALF).toFixed(1));
          dot.setAttribute("r", "4");
          dot.setAttribute("class", "vc-corner");
          dot.onclick = () => this.host.lookFrom([x, y, z]);
          parts.push({ depth: p.z + 10, node: dot });
        }
      }
    }
    // A compass ring at the base with the north mark.
    const ring = document.createElementNS(ns, "g");
    const base = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => {
      const a = (i / 12) * Math.PI * 2;
      return view([Math.cos(a) * 1.7, Math.sin(a) * 1.7, -1]).multiplyScalar(HALF);
    });
    const ellipse = document.createElementNS(ns, "polygon");
    ellipse.setAttribute("points", base.map((p) => `${p.x.toFixed(1)},${(-p.y).toFixed(1)}`).join(" "));
    ellipse.setAttribute("class", "vc-ring");
    ring.append(ellipse);
    const north = view([0, 1.95, -1]).multiplyScalar(HALF);
    const nt = document.createElementNS(ns, "text");
    nt.setAttribute("x", north.x.toFixed(1));
    nt.setAttribute("y", (-north.y + 3).toFixed(1));
    nt.setAttribute("class", "vc-north");
    nt.textContent = "N";
    ring.append(nt);
    parts.push({ depth: -10, node: ring });
    parts.sort((a, b) => a.depth - b.depth);
    this.svg.replaceChildren(...parts.map((p) => p.node));
  }
}
