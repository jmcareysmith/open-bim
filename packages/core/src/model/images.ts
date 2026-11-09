import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat } from "./architecture.ts";
import type { ViewParams } from "./viewdefs.ts";

// Image underlays (Revit: Insert → Image, current view only): a raster placed in one view's 2D
// coordinates (plan mm for plans), e.g. a scanned site plan or a survey to trace over. Stored as
// JPEG (base64) so sheets and PDFs can embed it as is; sized by its width, moved by its position.

export type ImageUnderlayParams = {
  viewId: ElementId;
  /** Bottom-left corner, view mm. */
  position: Vec2;
  /** Size in the view, mm (height follows the image's proportions unless set). */
  width: number;
  height: number;
  /** base64 JPEG. */
  jpeg: string;
  /** Pixel size of the stored image. */
  pixels: { w: number; h: number };
  /** 0–1 (1 = opaque); on screen only. */
  opacity?: number | null;
};
export type ImageUnderlay = Element<ImageUnderlayParams>;

registerCategory({
  name: Cat.ImageUnderlay,
  dependencies: (el) => [(el.params as ImageUnderlayParams).viewId],
  cascadeDelete: true,
  isType: false,
});

export function createImageUnderlay(
  tx: Transaction,
  doc: Document,
  viewId: ElementId,
  image: { jpeg: string; pixels: { w: number; h: number } },
  opts: { position?: Vec2; width?: number; name?: string } = {},
): ImageUnderlay {
  const v = doc.get<ViewParams>(viewId);
  if (!v || v.category !== Cat.View || v.params.kind === "3d") throw new Error("Images go in plans, sections, elevations, legends or drafting views");
  if (!image.jpeg || image.pixels.w < 1 || image.pixels.h < 1) throw new Error("That image is empty");
  // Default: 200 mm wide on paper at the view's scale.
  const width = opts.width ?? 200 * v.params.scale;
  return tx.create<ImageUnderlayParams>(
    Cat.ImageUnderlay,
    { viewId, position: { ...(opts.position ?? { x: 0, y: 0 }) }, width, height: (width * image.pixels.h) / image.pixels.w, jpeg: image.jpeg, pixels: { ...image.pixels }, opacity: 1 },
    { name: opts.name ?? "Image" },
  ) as ImageUnderlay;
}

/** base64 → bytes (no DOM needed). */
export function base64Bytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
