import { fillLoops } from "./hlr.ts";
import type { Drawing, StrokeKind } from "./drawing.ts";

// Minimal vector PDF writer: one page per drawing, lines and fills as PDF paths, text in the
// standard Helvetica font (no embedding needed). Coordinates in, mm; out, points.

const PT = 72 / 25.4;

/** Pen widths on paper, mm (ISO-ish: heavy cuts, fine hatching). */
/** Override pen weights 1-16, mm on paper (like Revit's model pens at 1:100). */
const PEN = [0, 0.1, 0.13, 0.18, 0.25, 0.35, 0.5, 0.6, 0.7, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2, 2.4];
const DASH: Record<string, string> = { dash: "[3 2] 0 d", dot: "[0.4 1.6] 0 d", dashDot: "[4 1.5 0.4 1.5] 0 d", longDash: "[7 2] 0 d" };

const WEIGHT: Record<StrokeKind, number> = {
  cut: 0.5,
  beyond: 0.18,
  hatch: 0.1,
  surface: 0.1,
  annotation: 0.25,
  datum: 0.18,
  symbol: 0.25,
};

export interface PdfPage {
  /** Paper size, mm. */
  width: number;
  height: number;
  drawing: Drawing;
}

const f = (v: number) => (Math.round(v * 1000) / 1000).toString();
const rgb = (c: number) => `${f(((c >> 16) & 255) / 255)} ${f(((c >> 8) & 255) / 255)} ${f((c & 255) / 255)}`;

/** WinAnsi-escape text for a PDF string literal (Helvetica covers Latin-1). */
function pdfString(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === "(" || ch === ")" || ch === "\\") out += `\\${ch}`;
    else if (code >= 32 && code < 127) out += ch;
    else if (code === 0x2013 || code === 0x2014) out += "\\226"; // en/em dash
    else if (code === 0x2009 || code === 0xa0) out += " "; // thin / non-breaking space
    else if (code < 256) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += "?";
  }
  return out;
}

/** Content stream for one page. */
function pageContent(p: PdfPage): string {
  const ops: string[] = ["1 J 1 j"]; // round caps and joins
  const X = (x: number) => f(x * PT);
  for (const fill of p.drawing.fills) {
    const grey = fill.color !== undefined ? rgb(fill.color) : fill.kind === "poche" ? "0.55 0.55 0.55" : fill.kind === "solid" ? "0.2 0.2 0.2" : rgb(0xbbbbbb);
    const tris = fillLoops(fill.loops);
    if (!tris.length) continue;
    ops.push(`${grey} rg`);
    for (const t of tris) ops.push(`${X(t[0]!.x)} ${X(t[0]!.y)} m ${X(t[1]!.x)} ${X(t[1]!.y)} l ${X(t[2]!.x)} ${X(t[2]!.y)} l h f`);
  }
  for (const s of p.drawing.strokes) {
    if (!s.segments.length) continue;
    const colour = s.halftone ? "0.6 0.6 0.6" : s.color !== undefined ? rgb(s.color) : "0 0 0";
    const width = s.width ?? (s.weight ? (PEN[Math.max(1, Math.min(16, Math.round(s.weight)))] ?? WEIGHT[s.kind]) : WEIGHT[s.kind]);
    const dash = s.pattern ? (DASH[s.pattern] ?? "[] 0 d") : s.dashed ? DASH.dash! : "[] 0 d";
    ops.push(`${f(width * PT)} w ${colour} RG ${dash}`);
    for (let i = 0; i < s.segments.length; i += 4) {
      ops.push(`${X(s.segments[i]!)} ${X(s.segments[i + 1]!)} m ${X(s.segments[i + 2]!)} ${X(s.segments[i + 3]!)} l`);
    }
    ops.push("S");
  }
  ops.push("0 0 0 rg");
  for (const t of p.drawing.texts) {
    // `size` is cap height; Helvetica caps are ~0.72 of the font size.
    const pt = (t.size / 0.72) * PT;
    const width = t.align === "center" ? 0.55 * pt * t.text.length : 0; // approximate centring
    ops.push(`BT /F1 ${f(pt)} Tf ${f(t.x * PT - width / 2)} ${f(t.y * PT - (t.align === "center" ? pt * 0.36 : pt * 0.36))} Td (${pdfString(t.text)}) Tj ET`);
  }
  return ops.join("\n");
}

/** Build a PDF file. Returns its bytes (ASCII-only, so string length = byte length). */
export function writePdf(pages: PdfPage[], title = "Open-BIM"): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length; // object number
  };
  const catalog = add("");
  const pagesObj = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const info = add(`<< /Title (${pdfString(title)}) /Producer (Open-BIM) >>`);
  const kids: number[] = [];
  for (const p of pages) {
    const content = pageContent(p);
    const stream = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${f(p.width * PT)} ${f(p.height * PT)}] ` +
          `/Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${stream} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i);
  return bytes;
}
