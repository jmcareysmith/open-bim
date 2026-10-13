import {
  DEFAULT_LIGHTING,
  sunStudyFrames,
  viewSun,
  viewSunDate,
  type SunSettings,
  type SunStudy,
  type View,
  type ViewLighting,
  type ViewParams,
} from "@open-bim/core";
import { openDialog } from "./dialog.ts";
import type { ViewBarHost } from "./viewbar.ts";

// Sun Settings (Revit: solar study Still / Single-Day / Multi-Day / Lighting, with a preview that
// plays the study) and Shadows & Lighting (Revit's Graphic Display Options: sun and ambient
// brightness, shadow intensity, ambient shadows, depth cueing) for a 3D view.

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const STUDIES: { value: SunStudy; label: string }[] = [
  { value: "still", label: "Still (one moment)" },
  { value: "singleDay", label: "Single-Day" },
  { value: "multiDay", label: "Multi-Day" },
  { value: "lighting", label: "Lighting (set sun angles)" },
];

function input(type: string, value: string, extra: { min?: string; max?: string; step?: string; checked?: boolean } = {}): HTMLInputElement {
  const i = document.createElement("input");
  i.type = type;
  i.value = value;
  if (extra.min !== undefined) i.min = extra.min;
  if (extra.max !== undefined) i.max = extra.max;
  if (extra.step !== undefined) i.step = extra.step;
  if (extra.checked !== undefined) i.checked = extra.checked;
  return i;
}

function field(form: HTMLElement, label: string, control: HTMLElement): HTMLLabelElement {
  const l = document.createElement("label");
  l.className = "dlg-field";
  l.append(Object.assign(document.createElement("span"), { textContent: label }), control);
  form.append(l);
  return l;
}

function slider(form: HTMLElement, label: string, value: number, onInput: (v: number) => void): HTMLInputElement {
  const r = input("range", String(value), { min: "0", max: "100" });
  const out = Object.assign(document.createElement("span"), { className: "muted", textContent: String(value) });
  r.oninput = () => {
    out.textContent = r.value;
    onInput(Number(r.value));
  };
  const wrap = document.createElement("span");
  wrap.className = "mb-slider";
  wrap.append(r, out);
  field(form, label, wrap);
  return r;
}

/** Show `params` in the viewport without saving (previews). */
function preview(host: ViewBarHost, params: ViewParams): void {
  host.viewport.setSun(viewSun(host.doc, params), !!params.shadows, params.lighting ?? {});
}

export function openSunSettings(host: ViewBarHost, view: View): void {
  const { doc } = host;
  const p = view.params;
  const now = viewSunDate(p);
  const s: SunSettings = { date: ymd(now), time: hm(now), ...(p.sun ?? {}) };
  const light: ViewLighting = { ...(p.lighting ?? {}) };
  let frame = s.frame ?? 0;
  let timer: number | undefined;

  const draft = (): ViewParams => ({ ...p, sun: { ...s, frame }, lighting: light });
  const form = document.createElement("div");
  form.className = "dlg-form";

  const study = document.createElement("select");
  for (const o of STUDIES) study.append(new Option(o.label, o.value, false, o.value === (s.study ?? "still")));
  field(form, "Solar study", study);

  const date = input("date", s.date);
  const endDate = input("date", s.endDate ?? s.date);
  const time = input("time", s.time);
  const start = input("time", s.startTime ?? "06:00");
  const end = input("time", s.endTime ?? "18:00");
  const minutes = document.createElement("select");
  for (const m of [15, 30, 60, 120]) minutes.append(new Option(m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}`, String(m), false, m === (s.interval ?? 60)));
  const days = document.createElement("select");
  for (const d of [1, 7, 14, 30]) days.append(new Option(d === 1 ? "1 day" : d === 7 ? "1 week" : d === 14 ? "2 weeks" : "1 month", String(d), false, d === (s.interval ?? 7)));
  const azimuth = input("number", String(s.azimuth ?? 135), { min: "0", max: "360", step: "1" });
  const altitude = input("number", String(s.altitude ?? 35), { min: "0", max: "90", step: "1" });
  const rows = {
    date: field(form, "Date", date),
    endDate: field(form, "End date", endDate),
    time: field(form, "Time", time),
    start: field(form, "Start time", start),
    end: field(form, "End time", end),
    minutes: field(form, "Interval", minutes),
    days: field(form, "Interval", days),
    azimuth: field(form, "Azimuth (° from true north)", azimuth),
    altitude: field(form, "Altitude (° above horizon)", altitude),
  };

  // Preview: step through a single/multi-day study.
  const frameRange = input("range", "0", { min: "0", step: "1" });
  const frameLabel = Object.assign(document.createElement("span"), { className: "muted" });
  const play = Object.assign(document.createElement("button"), { textContent: "▶ Play" });
  const previewBox = document.createElement("div");
  previewBox.className = "buttons";
  previewBox.append(play, frameRange, frameLabel);
  const previewRow = field(form, "Preview", previewBox);

  form.append(Object.assign(document.createElement("div"), { className: "ovr-sub", textContent: "Lighting" }));
  slider(form, "Sun brightness", light.sun ?? DEFAULT_LIGHTING.sun, (v) => ((light.sun = v), update()));
  const info = Object.assign(document.createElement("p"), { className: "muted" });
  form.append(info);

  const stop = () => {
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
    play.textContent = "▶ Play";
  };
  const update = () => {
    s.study = study.value as SunStudy;
    s.date = date.value;
    s.endDate = endDate.value;
    s.time = time.value;
    s.startTime = start.value;
    s.endTime = end.value;
    s.interval = Number(s.study === "multiDay" ? days.value : minutes.value);
    s.azimuth = Number(azimuth.value);
    s.altitude = Number(altitude.value);
    const k = s.study;
    const show: Record<keyof typeof rows, boolean> = {
      date: k !== "lighting",
      endDate: k === "multiDay",
      time: k === "still" || k === "multiDay",
      start: k === "singleDay",
      end: k === "singleDay",
      minutes: k === "singleDay",
      days: k === "multiDay",
      azimuth: k === "lighting",
      altitude: k === "lighting",
    };
    for (const [key, row] of Object.entries(rows)) row.hidden = !show[key as keyof typeof rows];
    rows.date.querySelector("span")!.textContent = k === "multiDay" ? "Start date" : "Date";
    const frames = k === "singleDay" || k === "multiDay" ? sunStudyFrames(s) : [];
    previewRow.hidden = frames.length < 2;
    if (frames.length < 2) stop();
    frame = Math.min(frame, Math.max(0, frames.length - 1));
    frameRange.max = String(Math.max(0, frames.length - 1));
    frameRange.value = String(frame);
    const at = frames[frame];
    frameLabel.textContent = at ? (k === "singleDay" ? hm(at) : ymd(at)) : "";
    const params = draft();
    const sun = viewSun(doc, params);
    info.textContent =
      sun.altitude > 0
        ? `Sun ${sun.altitude.toFixed(0)}° up, bearing ${sun.azimuth.toFixed(0)}°${k === "lighting" ? "" : " (true sun for the project location)"}.`
        : "The sun is below the horizon then.";
    preview(host, params);
  };
  for (const c of [study, date, endDate, time, start, end, minutes, days, azimuth, altitude]) c.oninput = c.onchange = update;
  frameRange.oninput = () => {
    frame = Number(frameRange.value);
    update();
  };
  play.onclick = () => {
    if (timer !== undefined) return stop();
    play.textContent = "⏸ Pause";
    timer = window.setInterval(() => {
      const n = Number(frameRange.max) + 1;
      frame = (frame + 1) % n;
      update();
    }, 400);
  };

  const apply = Object.assign(document.createElement("button"), { textContent: "Apply", className: "primary" });
  form.append(apply);
  let applied = false;
  const dlg = openDialog("Sun Settings", () => form, () => {
    stop();
    // Closed without applying: back to the saved sun.
    if (!applied) {
      const v = doc.get<ViewParams>(view.id);
      if (v) preview(host, v.params);
    }
  });
  apply.onclick = () => {
    stop();
    try {
      doc.transact("Sun settings", (tx) => tx.update<ViewParams>(view.id, { sun: { ...s, frame }, lighting: light }));
      applied = true;
    } catch (e) {
      host.status(`⚠ ${(e as Error).message}`);
    }
    dlg.close();
  };
  update();
}

export function openShadowSettings(host: ViewBarHost, view: View): void {
  const { doc } = host;
  const p = view.params;
  const light: ViewLighting = { ...(p.lighting ?? {}) };
  let shadows = !!p.shadows;
  const form = document.createElement("div");
  form.className = "dlg-form";
  const draft = (): ViewParams => ({ ...p, shadows, lighting: light });
  const update = () => preview(host, draft());

  const cast = input("checkbox", "", { checked: shadows });
  cast.onchange = () => ((shadows = cast.checked), update());
  field(form, "Cast shadows", cast);
  slider(form, "Shadow intensity", light.shadow ?? DEFAULT_LIGHTING.shadow, (v) => ((light.shadow = v), update()));
  slider(form, "Ambient light", light.ambient ?? DEFAULT_LIGHTING.ambient, (v) => ((light.ambient = v), update()));
  const ao = input("checkbox", "", { checked: !!light.ambientShadows });
  ao.onchange = () => ((light.ambientShadows = ao.checked), update());
  field(form, "Show ambient shadows", ao);

  form.append(Object.assign(document.createElement("div"), { className: "ovr-sub", textContent: "Depth cueing" }));
  const cue = input("checkbox", "", { checked: !!light.depthCue });
  const dc = { start: 0, end: 100, fade: 60, ...(light.depthCue ?? {}) };
  const sync = () => {
    light.depthCue = cue.checked ? { ...dc } : null;
    update();
  };
  cue.onchange = sync;
  field(form, "Depth cueing", cue);
  slider(form, "Start (% from front)", dc.start, (v) => ((dc.start = v), sync()));
  slider(form, "End (% from front)", dc.end, (v) => ((dc.end = v), sync()));
  slider(form, "Fade limit (%)", dc.fade, (v) => ((dc.fade = v), sync()));

  const apply = Object.assign(document.createElement("button"), { textContent: "Apply", className: "primary" });
  form.append(apply);
  let applied = false;
  const dlg = openDialog("Shadows & Lighting", () => form, () => {
    if (!applied) {
      const v = doc.get<ViewParams>(view.id);
      if (v) preview(host, v.params);
    }
  });
  apply.onclick = () => {
    try {
      doc.transact("Shadows and lighting", (tx) => tx.update<ViewParams>(view.id, { shadows, lighting: light }));
      applied = true;
    } catch (e) {
      host.status(`⚠ ${(e as Error).message}`);
    }
    dlg.close();
  };
}
