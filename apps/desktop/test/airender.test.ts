import { describe, expect, it } from "vitest";
import { DEFAULT_LOCAL, aiRender, buildRequest, fromBase64, sdSize, toBase64 } from "../src/airender.ts";

const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const req = { image: png, width: 1920, height: 1080, prompt: "Cedar weatherboards, late afternoon" };
const fakeFetch = (reply: unknown, status = 200, seen: { url?: string; body?: Record<string, unknown>; headers?: Record<string, string> } = {}) =>
  (async (url: string, init: RequestInit) => {
    seen.url = url;
    seen.body = JSON.parse(String(init.body));
    seen.headers = init.headers as Record<string, string>;
    return new Response(JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;

describe("AI render", () => {
  it("round-trips base64 and sizes images for Stable Diffusion", () => {
    expect(fromBase64(toBase64(png))).toEqual(png);
    const s = sdSize(1920, 1080);
    expect(s.width % 8).toBe(0);
    expect(s.height % 8).toBe(0);
    expect(s.width * s.height).toBeLessThanOrEqual(1024 * 1024 + 20000);
    expect(s.width / s.height).toBeCloseTo(16 / 9, 1);
  });

  it("calls a self-hosted img2img server and returns its image", async () => {
    const seen: Parameters<typeof fakeFetch>[2] = {};
    const out = await aiRender(DEFAULT_LOCAL, req, fakeFetch({ images: [toBase64(new Uint8Array([9, 9]))] }, 200, seen));
    expect(out).toEqual(new Uint8Array([9, 9]));
    expect(seen.url).toBe("http://127.0.0.1:7860/sdapi/v1/img2img");
    expect(seen.body!.denoising_strength).toBe(0.45);
    expect(String(seen.body!.prompt)).toMatch(/Keep the building's geometry.*Cedar weatherboards/);
    expect((seen.body!.init_images as string[])[0]).toBe(toBase64(png));
  });

  it("calls Gemini with the user's key and reads the image from the interaction", async () => {
    const p = { kind: "gemini" as const, apiKey: "k-123", model: "gemini-3.1-flash-image" };
    const seen: Parameters<typeof fakeFetch>[2] = {};
    const reply = { status: "completed", steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: toBase64(new Uint8Array([7])) }] }] };
    expect(await aiRender(p, req, fakeFetch(reply, 200, seen))).toEqual(new Uint8Array([7]));
    expect(seen.headers!["x-goog-api-key"]).toBe("k-123");
    expect(seen.body!.model).toBe("gemini-3.1-flash-image");
    // Legacy generateContent shape is understood too; errors surface their message.
    const legacy = { candidates: [{ content: { parts: [{ text: "here" }, { inlineData: { mimeType: "image/png", data: toBase64(new Uint8Array([5])) } }] } }] };
    expect(await aiRender(p, req, fakeFetch(legacy))).toEqual(new Uint8Array([5]));
    await expect(aiRender(p, req, fakeFetch({ error: { message: "API key not valid" } }, 400))).rejects.toThrow("API key not valid");
    expect(() => buildRequest({ ...p, apiKey: " " }, req)).toThrow(/API key/);
  });
});
