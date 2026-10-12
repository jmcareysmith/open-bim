// AI render: turn a path-traced (or plain 3D) image into a photographic visualisation with an
// image-to-image model. Self-hosted by default — any server with the Stable Diffusion WebUI API
// (AUTOMATIC1111 / Forge: POST /sdapi/v1/img2img; start it with --api --cors-allow-origins=*) —
// or Google Gemini with the user's own API key. The model only restyles the image; the building's
// geometry comes from the input, so a low strength keeps it faithful.

export type AiProvider =
  | { kind: "local"; url: string; steps: number; strength: number }
  | { kind: "gemini"; apiKey: string; model: string };

export type AiRequest = {
  /** PNG bytes of the source image. */
  image: Uint8Array;
  width: number;
  height: number;
  /** What the user wants (style, materials, mood). */
  prompt: string;
};

export const DEFAULT_LOCAL: Extract<AiProvider, { kind: "local" }> = { kind: "local", url: "http://127.0.0.1:7860", steps: 25, strength: 0.45 };
export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-image";

const FRAME =
  "Photorealistic architectural photograph of this building. Keep the building's geometry, proportions, roof, windows, doors and camera viewpoint exactly as shown; only add realistic materials, lighting, landscaping and sky.";

export function fullPrompt(user: string): string {
  return user.trim() ? `${FRAME} ${user.trim()}` : FRAME;
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64.replace(/^data:[^,]+,/, ""));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Stable Diffusion's sizes must be multiples of 8 (and it's happiest near 1 megapixel). */
export function sdSize(width: number, height: number, maxPixels = 1024 * 1024): { width: number; height: number } {
  const k = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  const r8 = (v: number) => Math.max(64, Math.round((v * k) / 8) * 8);
  return { width: r8(width), height: r8(height) };
}

/** Build the HTTP request for a provider. */
export function buildRequest(p: AiProvider, req: AiRequest): { url: string; init: RequestInit } {
  const image = toBase64(req.image);
  const prompt = fullPrompt(req.prompt);
  if (p.kind === "local") {
    const size = sdSize(req.width, req.height);
    return {
      url: `${p.url.replace(/\/$/, "")}/sdapi/v1/img2img`,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          init_images: [image],
          prompt,
          negative_prompt: "distorted geometry, extra windows, extra floors, warped lines, cartoon, blurry, text, watermark",
          denoising_strength: p.strength,
          steps: p.steps,
          cfg_scale: 6,
          ...size,
        }),
      },
    };
  }
  if (!p.apiKey.trim()) throw new Error("Enter your Gemini API key first");
  return {
    url: "https://generativelanguage.googleapis.com/v1beta/interactions",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": p.apiKey.trim() },
      body: JSON.stringify({
        model: p.model || DEFAULT_GEMINI_MODEL,
        input: [
          { type: "image", mime_type: "image/png", data: image },
          { type: "text", text: prompt },
        ],
        response_format: { type: "image" },
      }),
    },
  };
}

type Json = Record<string, unknown>;

/** Pull the output image (base64) out of either provider's response. */
export function parseResponse(p: AiProvider, json: unknown): Uint8Array {
  const j = json as Json;
  if (p.kind === "local") {
    const img = (j.images as string[] | undefined)?.[0];
    if (!img) throw new Error(String(j.detail ?? j.error ?? "The server returned no image"));
    return fromBase64(img);
  }
  if (j.error) throw new Error(String((j.error as Json).message ?? j.error));
  // Interactions API: steps[].content[] {type: "image", data}; older generateContent: candidates[].content.parts[].inlineData.
  for (const step of (j.steps as Json[] | undefined) ?? [])
    for (const c of (step.content as Json[] | undefined) ?? []) if (c.type === "image" && typeof c.data === "string") return fromBase64(c.data);
  for (const cand of (j.candidates as Json[] | undefined) ?? [])
    for (const part of ((cand.content as Json | undefined)?.parts as Json[] | undefined) ?? []) {
      const d = (part.inlineData ?? part.inline_data) as Json | undefined;
      if (typeof d?.data === "string") return fromBase64(d.data);
    }
  throw new Error("Gemini returned no image (it may have declined the request)");
}

/** Run one AI render. */
export async function aiRender(p: AiProvider, req: AiRequest, fetchFn: typeof fetch = fetch): Promise<Uint8Array> {
  const { url, init } = buildRequest(p, req);
  let res: Response;
  try {
    res = await fetchFn(url, init);
  } catch {
    throw new Error(
      p.kind === "local"
        ? `Can't reach ${p.url}. Is the Stable Diffusion WebUI running with --api --cors-allow-origins=*?`
        : "Can't reach Gemini (check the internet connection).",
    );
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error(`${p.kind === "local" ? "Server" : "Gemini"} answered ${res.status} without JSON`);
  }
  if (!res.ok && !(json as Json).error && !(json as Json).detail) throw new Error(`${p.kind === "local" ? "Server" : "Gemini"} answered ${res.status}`);
  return parseResponse(p, json);
}
