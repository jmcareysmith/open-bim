import * as THREE from "three";
import { elementMaterial, sunDirection, type Document } from "@open-bim/core";
import type { MeshData } from "@open-bim/geometry";
import { toGeometry, type Viewport } from "./viewport.ts";

// Realistic rendering: a progressive GPU path tracer (three-gpu-pathtracer, loaded on first use)
// over the 3D view's model solids, lit by the sun for the project's location, date and time plus a
// gradient sky. Materials take their appearance (roughness, metalness, transparency) from the
// model's materials; window and curtain-wall glazing renders as glass.

export interface RenderHost {
  container: HTMLElement;
  viewport: Viewport;
  doc: Document;
  status(text: string): void;
  savePng(bytes: Uint8Array): Promise<void>;
}

const MAX_SAMPLES = 1000;

/** Local date and time inputs ↔ Date (in this computer's time zone). */
function localParts(d: Date): { date: string; time: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

let renderWhen = (() => {
  const d = new Date();
  d.setHours(14, 0, 0, 0);
  return d;
})();

export async function openRender(host: RenderHost): Promise<() => void> {
  host.status("Loading the path tracer…");
  const { WebGLPathTracer, GradientEquirectTexture } = await import("three-gpu-pathtracer");
  const { container, viewport, doc } = host;

  // ---- pane ----
  const pane = document.createElement("div");
  pane.id = "render-pane";
  const bar = document.createElement("div");
  bar.className = "render-bar";
  const el = (tag: string, props: Record<string, string> = {}): HTMLElement => Object.assign(document.createElement(tag), props);
  const input = (props: Record<string, string>) => el("input", props) as HTMLInputElement;
  const parts = localParts(renderWhen);
  const dateIn = input({ type: "date", value: parts.date, title: "Date (sun position)" });
  const timeIn = input({ type: "time", value: parts.time, title: "Time of day, this computer's time zone" });
  const exposure = input({ type: "range", min: "0.3", max: "2.5", step: "0.05", value: "1", title: "Exposure" });
  const info = el("span", { className: "muted" });
  const pause = el("button", { textContent: "Pause" });
  const save = el("button", { textContent: "Save PNG" });
  const close = el("button", { textContent: "Close" });
  bar.append(el("strong", { textContent: "Render" }), dateIn, timeIn, el("span", { textContent: "Exposure" }), exposure, info, pause, save, close);
  const canvasHost = el("div", { className: "render-canvas" });
  pane.append(bar, canvasHost);
  container.append(pane);

  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setPixelRatio(1);
  canvasHost.append(renderer.domElement);

  // ---- scene (Z up, turned into three's Y up so the sky gradient is overhead) ----
  const scene = new THREE.Scene();
  const world = new THREE.Group();
  world.rotation.x = -Math.PI / 2;
  scene.add(world);
  const materials: THREE.Material[] = [];
  const box = new THREE.Box3();
  for (const { id, mesh, color } of viewport.renderMeshes()) {
    const m = elementMaterial(doc, doc.require(id))?.params;
    const transparency = m?.transparency ?? 0;
    const surface =
      transparency > 0
        ? new THREE.MeshPhysicalMaterial({ color, transmission: transparency, roughness: m?.roughness ?? 0.05, ior: 1.5, thickness: 5 })
        : new THREE.MeshStandardMaterial({ color: mesh.colors ? 0xffffff : color, vertexColors: !!mesh.colors, roughness: m?.roughness ?? 0.85, metalness: m?.metalness ?? 0 });
    materials.push(surface);
    // Glazing becomes its own mesh (the path tracer is happiest with one material per mesh).
    const parts: [MeshData, THREE.Material][] = [];
    if (mesh.glass?.count) {
      const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0.95, roughness: 0.02, ior: 1.5, thickness: 6 });
      materials.push(glass);
      const { start, count } = mesh.glass;
      const rest = new Uint32Array(mesh.indices.length - count);
      rest.set(mesh.indices.subarray(0, start));
      rest.set(mesh.indices.subarray(start + count), start);
      if (rest.length) parts.push([{ ...mesh, indices: rest }, surface]);
      parts.push([{ ...mesh, indices: mesh.indices.slice(start, start + count) }, glass]);
    } else parts.push([mesh, surface]);
    for (const [m2, mat] of parts) {
      const geom = toGeometry(m2);
      world.add(new THREE.Mesh(geom, mat));
      geom.computeBoundingBox();
      box.union(geom.boundingBox!);
    }
  }
  if (box.isEmpty()) box.set(new THREE.Vector3(-5000, -5000, 0), new THREE.Vector3(5000, 5000, 3000));
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.y, 10000);
  // Ground: a large matt plane just under the lowest solid.
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x8f9479, roughness: 1 });
  materials.push(groundMat);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(span * 20, span * 20), groundMat);
  ground.position.set(centre.x, centre.y, box.min.z - 5);
  world.add(ground);

  const sun = new THREE.DirectionalLight(0xfff1dc, 3);
  world.add(sun, sun.target);
  sun.target.position.copy(centre);
  const sky = new GradientEquirectTexture();
  sky.bottomColor.set(0xd8dde2);
  scene.environment = sky;
  scene.background = sky;

  const camera = viewport.perspectiveCamera.clone();
  world.add(camera);

  const tracer = new WebGLPathTracer(renderer);
  tracer.bounces = 6;
  tracer.transmissiveBounces = 8;
  tracer.minSamples = 1;
  tracer.renderDelay = 0;
  tracer.fadeDuration = 0;
  tracer.tiles.set(2, 2);

  const applySun = () => {
    const [y, mo, d] = dateIn.value.split("-").map(Number);
    const [h, mi] = timeIn.value.split(":").map(Number);
    if ([y, mo, d, h, mi].some((n) => n === undefined || Number.isNaN(n))) return;
    renderWhen = new Date(y!, mo! - 1, d!, h!, mi!);
    const s = sunDirection(doc, renderWhen);
    const up = Math.max(0, s.z);
    // Low sun: weaker and warmer; night: sky only, dim.
    sun.visible = s.altitude > 0;
    sun.intensity = 4 * Math.min(1, up * 2.5);
    sun.color.setRGB(1, 0.86 + 0.12 * up, 0.7 + 0.25 * up);
    sun.position.set(centre.x + s.x * span * 4, centre.y + s.y * span * 4, centre.z + s.z * span * 4);
    const day = Math.min(1, Math.max(0.04, up * 3 + 0.15));
    // Sky light kept well below the sun so surfaces keep their colour; a pale horizon.
    sky.topColor.setRGB(0.16 * day, 0.24 * day, 0.4 * day);
    sky.bottomColor.setRGB(0.42 * day, 0.43 * day, 0.44 * day);
    sky.update();
    info.textContent = `Sun ${s.altitude.toFixed(0)}° up, bearing ${s.azimuth.toFixed(0)}°`;
  };

  const resize = () => {
    const w = Math.max(1, canvasHost.clientWidth);
    const h = Math.max(1, canvasHost.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    tracer.updateCamera();
  };

  applySun();
  scene.updateMatrixWorld(true);
  tracer.setScene(scene, camera);
  resize();

  let paused = false;
  let raf = 0;
  let disposed = false;
  const loop = () => {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    if (paused || tracer.samples >= MAX_SAMPLES) return;
    tracer.renderSample();
  };
  raf = requestAnimationFrame(loop);
  const sampleLabel = window.setInterval(() => {
    const n = Math.floor(tracer.samples);
    pause.textContent = paused ? `Resume (${n})` : n >= MAX_SAMPLES ? `Done (${n})` : `Pause (${n})`;
  }, 250);

  const restart = () => {
    tracer.updateLights();
    tracer.updateEnvironment();
    tracer.reset();
  };
  dateIn.onchange = timeIn.onchange = () => {
    applySun();
    scene.updateMatrixWorld(true);
    restart();
  };
  exposure.oninput = () => {
    renderer.toneMappingExposure = Number(exposure.value);
    tracer.reset();
  };
  pause.onclick = () => (paused = !paused);
  save.onclick = () => {
    renderer.domElement.toBlob(async (blob) => {
      if (!blob) return host.status("⚠ Could not capture the render.");
      await host.savePng(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  };
  const ro = new ResizeObserver(() => {
    resize();
    tracer.reset();
  });
  ro.observe(canvasHost);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    clearInterval(sampleLabel);
    ro.disconnect();
    tracer.dispose();
    sky.dispose();
    world.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    materials.forEach((m) => m.dispose());
    renderer.dispose();
    pane.remove();
  };
  close.onclick = dispose;
  host.status("Rendering. It sharpens as samples build up; change the date or time to move the sun.");
  return dispose;
}
