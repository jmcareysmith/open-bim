// PDF underlays (Revit: Insert → PDF): render one page of a PDF to a canvas with pdf.js (loaded
// on first use), so it can go into a view as an image underlay. Returns the canvas and the page's
// paper size in mm (so a scaled drawing can be placed at true size).

export async function renderPdfPage(bytes: Uint8Array, pageNumber = 1, maxPixels = 4000): Promise<{ canvas: HTMLCanvasElement; widthMm: number; heightMm: number; pages: number }> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const page = await pdf.getPage(Math.min(Math.max(1, pageNumber), pdf.numPages));
  const base = page.getViewport({ scale: 1 }); // points
  const scale = maxPixels / Math.max(base.width, base.height);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: g, viewport }).promise;
  const pages = pdf.numPages;
  await pdf.destroy();
  return { canvas, widthMm: (base.width * 25.4) / 72, heightMm: (base.height * 25.4) / 72, pages };
}
