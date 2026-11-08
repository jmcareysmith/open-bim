import * as THREE from "three";
import type { Material } from "@open-bim/core";
import { patternFamilies } from "@open-bim/geometry";

// Realistic-view textures (Revit: a material's Appearance asset). A material's own image when it
// has one; otherwise one drawn from its colour and surface pattern (brick courses, weatherboards,
// tiles, concrete speckle), so the model reads as built materials with no setup. Textures are mapped
// by world position (see `TRIPLANAR` in viewport.ts): `size` is the real size of one tile, mm.

const PX = 256;
const cache = new Map<string, { tex: THREE.Texture; size: number }>();

const shade = (c: number, k: number) => {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * k));
  const b = Math.min(255, Math.round((c & 255) * k));
  return `rgb(${r},${g},${b})`;
};

/** A seeded random (stable speckle per material). */
function rand(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function procedural(m: Material): { canvas: HTMLCanvasElement; size: number } {
  const c = document.createElement("canvas");
  c.width = c.height = PX;
  const g = c.getContext("2d")!;
  const base = m.params.color;
  g.fillStyle = shade(base, 1);
  g.fillRect(0, 0, PX, PX);
  const r = rand(base ^ m.params.surfacePattern.length * 7919);
  // A light grain on everything, so even plain materials aren't flat.
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = shade(base, 0.9 + r() * 0.2);
    g.fillRect(r() * PX, r() * PX, 1 + r() * 2, 1 + r() * 2);
  }
  const pat = m.params.surfacePattern;
  let size = 1200;
  if (pat === "brick") {
    // 230 × 76 bricks with 10 mm joints, every other course offset half a brick.
    size = 960;
    const k = PX / size;
    g.strokeStyle = shade(base, 0.6);
    g.lineWidth = Math.max(1, 10 * k);
    for (let row = 0; row * 86 < size; row++) {
      const y = row * 86 * k;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(PX, y);
      g.stroke();
      for (let x = (row % 2) * 120; x < size; x += 240) {
        g.beginPath();
        g.moveTo(x * k, y);
        g.lineTo(x * k, y + 86 * k);
        g.stroke();
      }
    }
  } else if (pat === "concrete") {
    size = 600;
    for (let i = 0; i < 600; i++) {
      g.fillStyle = shade(base, 0.7 + r() * 0.15);
      const s = 1 + r() * 2.5;
      g.fillRect(r() * PX, r() * PX, s, s);
    }
  } else if (pat !== "none" && pat !== "solid") {
    // Line patterns (weatherboard, tiles, ceiling grids, timber…): their families over the tile.
    const fams = patternFamilies(pat, 20) ?? [];
    size = pat === "weatherboard" ? 600 : pat === "tile300" ? 600 : pat === "ceiling600" || pat === "ceiling1200x600" ? 1200 : 600;
    const k = PX / size;
    g.strokeStyle = shade(base, 0.62);
    g.lineWidth = Math.max(1, 1.5);
    for (const f of fams) {
      const a = (f.angle * Math.PI) / 180;
      const d = { x: Math.cos(a), y: Math.sin(a) };
      const n = { x: -d.y, y: d.x };
      const step = f.spacing * k;
      if (step < 2) continue;
      // Lines across the tile, wrapping so the texture repeats.
      for (let o = -PX * 1.5; o < PX * 1.5; o += step) {
        g.beginPath();
        g.moveTo(PX / 2 + n.x * o - d.x * PX * 2, PX / 2 + n.y * o - d.y * PX * 2);
        g.lineTo(PX / 2 + n.x * o + d.x * PX * 2, PX / 2 + n.y * o + d.y * PX * 2);
        g.stroke();
      }
    }
  }
  return { canvas: c, size };
}

/** The texture for a material in Realistic view, and its tile size (mm); cached per material state. */
export function materialTexture(m: Material, onLoad: () => void): { tex: THREE.Texture; size: number } {
  const p = m.params as Material["params"] & { texture?: string | null; textureSize?: number | null };
  const key = `${m.id}|${p.color}|${p.surfacePattern}|${p.textureSize ?? ""}|${(p.texture ?? "").length}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let out: { tex: THREE.Texture; size: number };
  if (p.texture) {
    const tex = new THREE.TextureLoader().load(p.texture, () => onLoad());
    out = { tex, size: p.textureSize && p.textureSize > 0 ? p.textureSize : 1000 };
  } else {
    const { canvas, size } = procedural(m);
    out = { tex: new THREE.CanvasTexture(canvas), size: p.textureSize && p.textureSize > 0 ? p.textureSize : size };
  }
  out.tex.wrapS = out.tex.wrapT = THREE.RepeatWrapping;
  out.tex.colorSpace = THREE.SRGBColorSpace;
  out.tex.anisotropy = 4;
  cache.set(key, out);
  return out;
}
