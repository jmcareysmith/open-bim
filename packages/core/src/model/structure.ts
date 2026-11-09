import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat, floorExtent, type Floor, type LevelParams } from "./architecture.ts";

// Structure (Revit: Structural Column, Beam, Foundation). Columns and beams take a section type
// (rectangle, circle, I-section, SHS); columns run between levels, beams along a line with their
// top at the level (+ offset). Pad footings sit under a point, strip footings under a wall.

export type SectionShape = "rect" | "circle" | "I" | "SHS";

export type StructuralSectionParams = {
  shape: SectionShape;
  /** Depth (or diameter), mm — vertical for beams, along the column's local Y. */
  d: number;
  /** Width / flange width, mm. */
  b: number;
  /** I-sections: flange and web thickness; SHS: wall thickness. */
  tf: number;
  tw: number;
  materialId?: ElementId | null;
};

export type ColumnParams = {
  baseLevelId: ElementId;
  baseOffset: number;
  topLevelId: ElementId;
  topOffset: number;
  position: Vec2;
  /** Radians about Z. */
  rotation: number;
};
export type Column = Element<ColumnParams>;

export type BeamParams = {
  levelId: ElementId;
  /** Top of beam relative to the level, mm. */
  offset: number;
  start: Vec2;
  end: Vec2;
  /** Top of beam at the end, relative to the level (sloped beams and braces); default = offset. */
  endOffset?: number | null;
  /** Structural brace (Revit: Brace): drawn in plan as a dashed line with its slope. */
  brace?: boolean | null;
  /** Beam systems: the system's name, shared by its beams (Revit: Structural Beam System). */
  system?: string | null;
  /** The beam system that owns this beam (it re-lays its beams; deleting it deletes them). */
  systemId?: ElementId | null;
  /** Tributary width for floor area loads, mm (unset: worked out from neighbouring beams). */
  tributary?: number | null;
};
export type Beam = Element<BeamParams>;

export type PadFootingParams = { levelId: ElementId; position: Vec2; width: number; length: number; depth: number; /** Top of footing relative to the level. */ offset: number; rotation: number };
export type StripFootingParams = { wallId: ElementId; width: number; depth: number };

const typeDeps = (el: Element) => (el.typeId ? [el.typeId] : []);
registerCategory({
  name: Cat.StructuralType,
  dependencies: (el) => {
    const m = (el.params as StructuralSectionParams).materialId;
    return m ? [m] : [];
  },
  cascadeDelete: false,
  isType: true,
});
registerCategory({
  name: Cat.Column,
  dependencies: (el) => {
    const p = el.params as ColumnParams;
    return [p.baseLevelId, p.topLevelId, ...typeDeps(el)];
  },
  cascadeDelete: true,
  isType: false,
});
registerCategory({
  name: Cat.Beam,
  dependencies: (el) => [(el.params as BeamParams).levelId, ...typeDeps(el), ...((el.params as BeamParams).systemId ? [(el.params as BeamParams).systemId!] : [])],
  cascadeDelete: true,
  isType: false,
});
registerCategory({ name: Cat.PadFooting, dependencies: (el) => [(el.params as PadFootingParams).levelId], cascadeDelete: true, isType: false });
registerCategory({ name: Cat.StripFooting, dependencies: (el) => [(el.params as StripFootingParams).wallId], cascadeDelete: true, isType: false });

/** Common NZ sections (NZS 3604 timber, AS/NZS steel, concrete), created on first use. */
export const DEFAULT_SECTIONS: [string, StructuralSectionParams][] = [
  ["Timber 190x45 SG8", { shape: "rect", d: 190, b: 45, tf: 0, tw: 0 }],
  ["Timber 240x45 SG8", { shape: "rect", d: 240, b: 45, tf: 0, tw: 0 }],
  ["Timber Post 90x90 H5", { shape: "rect", d: 90, b: 90, tf: 0, tw: 0 }],
  ["Steel 200UB25", { shape: "I", d: 203, b: 133, tf: 7.8, tw: 5.8 }],
  ["Steel 310UB40", { shape: "I", d: 304, b: 165, tf: 10.2, tw: 6.1 }],
  ["Steel SHS 100x100x4", { shape: "SHS", d: 100, b: 100, tf: 4, tw: 4 }],
  ["Concrete Column 300x300", { shape: "rect", d: 300, b: 300, tf: 0, tw: 0 }],
  ["Concrete Column 300 dia", { shape: "circle", d: 300, b: 300, tf: 0, tw: 0 }],
];

export function ensureStructuralTypes(tx: Transaction, doc: Document): ElementId[] {
  const have = doc.byCategory(Cat.StructuralType);
  if (have.length) return have.map((t) => t.id);
  return DEFAULT_SECTIONS.map(([name, p]) => tx.create<StructuralSectionParams>(Cat.StructuralType, { ...p }, { name }).id);
}

function requireSection(doc: Document, typeId: ElementId): void {
  if (doc.get(typeId)?.category !== Cat.StructuralType) throw new Error("Pick a structural section type");
}

export function createColumn(tx: Transaction, doc: Document, typeId: ElementId, baseLevelId: ElementId, topLevelId: ElementId, position: Vec2, rotation = 0): Column {
  requireSection(doc, typeId);
  const c = tx.create<ColumnParams>(Cat.Column, { baseLevelId, baseOffset: 0, topLevelId, topOffset: 0, position: { ...position }, rotation }, { typeId }) as Column;
  const { bottom, top } = columnExtent(doc, c);
  if (top <= bottom) throw new Error("A column's top must be above its base");
  return c;
}

export function createBeam(tx: Transaction, doc: Document, typeId: ElementId, levelId: ElementId, start: Vec2, end: Vec2): Beam {
  requireSection(doc, typeId);
  if (Math.hypot(end.x - start.x, end.y - start.y) < 1) throw new Error("A beam needs a length");
  return tx.create<BeamParams>(Cat.Beam, { levelId, offset: 0, start: { ...start }, end: { ...end } }, { typeId }) as Beam;
}

export interface BeamSystemOptions {
  /** Centres, mm. */
  spacing: number;
  /** Which way the beams run: across the floor's short side (default) or its long side. */
  direction?: "short" | "long";
  /** Keep the first and last beams this far in from the edges, mm (default half the spacing, capped at 300). */
  edge?: number;
}

/**
 * Beams at a spacing under a floor (Revit: Beam System) — spanning its short way across its
 * outline (holes split them), their tops at the floor's underside. Returns the line of each.
 */
export function beamSystemLayout(doc: Document, floorId: ElementId, opts: BeamSystemOptions): { start: Vec2; end: Vec2 }[] {
  const f = doc.get(floorId) as Floor | undefined;
  if (!f || f.category !== Cat.Floor) throw new Error("Pick a floor");
  const ring = f.params.boundary;
  const xs = ring.map((q) => q.x);
  const ys = ring.map((q) => q.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  // Beams along x when the floor is shorter in x (they span the short way).
  const alongX = (w <= h) !== (opts.direction === "long");
  const spacing = Math.max(100, opts.spacing);
  const edge = opts.edge ?? Math.min(spacing / 2, 300);
  // Scan across: lines perpendicular to the beams at the spacing.
  const lo = alongX ? Math.min(...ys) : Math.min(...xs);
  const hi = alongX ? Math.max(...ys) : Math.max(...xs);
  const n = Math.floor((hi - lo - 2 * edge) / spacing + 1e-6);
  const first = lo + (hi - lo - n * spacing) / 2;
  const rings = [ring, ...f.params.holes];
  const out: { start: Vec2; end: Vec2 }[] = [];
  for (let i = 0; i <= n; i++) {
    const c = first + i * spacing;
    const cuts: number[] = [];
    for (const r of rings) {
      for (let k = 0; k < r.length; k++) {
        const a = r[k]!;
        const b = r[(k + 1) % r.length]!;
        const [ac, bc, aa, ba] = alongX ? [a.y, b.y, a.x, b.x] : [a.x, b.x, a.y, b.y];
        if (ac > c !== bc > c) cuts.push(aa + ((c - ac) * (ba - aa)) / (bc - ac));
      }
    }
    cuts.sort((p, q) => p - q);
    for (let k = 0; k + 1 < cuts.length; k += 2) {
      const [u0, u1] = [cuts[k]!, cuts[k + 1]!];
      if (u1 - u0 < 300) continue;
      out.push(alongX ? { start: { x: u0, y: c }, end: { x: u1, y: c } } : { start: { x: c, y: u0 }, end: { x: c, y: u1 } });
    }
  }
  return out;
}

/** A beam system: the floor it holds up, the section, spacing and direction; it owns its beams. */
export type BeamSystemParams = { floorId: ElementId; typeId: ElementId; spacing: number; direction: "short" | "long" };
export type BeamSystem = Element<BeamSystemParams>;

registerCategory({
  name: Cat.BeamSystem,
  dependencies: (el) => [(el.params as BeamSystemParams).floorId, (el.params as BeamSystemParams).typeId],
  cascadeDelete: true,
  isType: false,
});

/**
 * Create a beam system (named "Beam System n") and its beams, tops at the floor's underside. The
 * beams follow the floor and the system's settings from then on (`enableBeamSystems`).
 */
export function createBeamSystem(tx: Transaction, doc: Document, typeId: ElementId, floorId: ElementId, opts: BeamSystemOptions): Beam[] {
  requireSection(doc, typeId);
  if (!beamSystemLayout(doc, floorId, opts).length) throw new Error("The floor is too small for beams at that spacing");
  const taken = new Set(doc.byCategory(Cat.BeamSystem).map((s) => s.name));
  let k = 1;
  while (taken.has(`Beam System ${k}`)) k++;
  const sys = tx.create<BeamSystemParams>(Cat.BeamSystem, { floorId, typeId, spacing: opts.spacing, direction: opts.direction ?? "short" }, { name: `Beam System ${k}` }) as BeamSystem;
  return syncBeamSystem(tx, doc, sys);
}

/** Beams of a system. */
export function systemBeams(doc: Document, systemId: ElementId): Beam[] {
  return doc.byCategory<BeamParams>(Cat.Beam).filter((b) => b.params.systemId === systemId) as Beam[];
}

/** Bring a system's beams in line with its floor and settings (re-laying them only when they differ). */
export function syncBeamSystem(tx: Transaction, doc: Document, sys: BeamSystem): Beam[] {
  const p = sys.params;
  const f = doc.get(p.floorId) as Floor | undefined;
  const existing = systemBeams(doc, sys.id);
  let lines: { start: Vec2; end: Vec2 }[] = [];
  try {
    if (f && doc.get(p.typeId)) lines = beamSystemLayout(doc, p.floorId, { spacing: p.spacing, direction: p.direction });
  } catch {
    lines = [];
  }
  const level = f ? doc.get<LevelParams>(f.params.levelId) : undefined;
  if (!f || !level) return existing;
  const offset = floorExtent(doc, f).bottom - level.params.elevation;
  const near = (a: Vec2, b: Vec2) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
  const same =
    existing.length === lines.length &&
    existing.every(
      (b, i) =>
        b.typeId === p.typeId &&
        b.params.levelId === level.id &&
        Math.abs(b.params.offset - offset) < 0.5 &&
        near(b.params.start, lines[i]!.start) &&
        near(b.params.end, lines[i]!.end),
    );
  if (same) return existing;
  for (const b of existing) tx.delete(b.id);
  return lines.map((l) => tx.create<BeamParams>(Cat.Beam, { levelId: level.id, offset, start: l.start, end: l.end, system: sys.name ?? null, systemId: sys.id }, { typeId: p.typeId }) as Beam);
}

/** Keep beam systems' beams up to date after every edit (floor reshaped, spacing changed…). */
export function enableBeamSystems(doc: Document): () => void {
  return doc.addCommitHook((tx) => {
    for (const s of doc.byCategory<BeamSystemParams>(Cat.BeamSystem)) syncBeamSystem(tx, doc, s as BeamSystem);
  });
}

/**
 * Brace: a sloped member from the level at `start` (bottom of section on the level) up to the
 * level above at `end` (top of section at it), or `rise` mm when given or there is no level above.
 */
export function createBrace(tx: Transaction, doc: Document, typeId: ElementId, levelId: ElementId, start: Vec2, end: Vec2, rise?: number): Beam {
  requireSection(doc, typeId);
  const lv = doc.get<LevelParams>(levelId);
  if (lv?.category !== Cat.Level) throw new Error("Braces start on a level");
  const above = doc
    .byCategory<LevelParams>(Cat.Level)
    .map((l) => l.params.elevation)
    .filter((e) => e > lv.params.elevation)
    .sort((a, b) => a - b)[0];
  const d = doc.get<StructuralSectionParams>(typeId)!.params.d;
  const top = rise ?? (above !== undefined ? above - lv.params.elevation : 2700);
  return tx.create<BeamParams>(Cat.Beam, { levelId, offset: d, endOffset: top, start: { ...start }, end: { ...end }, brace: true }, { typeId }) as Beam;
}

/** Foundation slab type (Revit: Structural Foundation: Slab), added on first use. */
export const FOUNDATION_SLAB_TYPE = "Foundation Slab - 300 Concrete";
export function ensureFoundationSlabType(tx: Transaction, doc: Document): ElementId {
  const have = doc.byCategory(Cat.FloorType).find((t) => t.name === FOUNDATION_SLAB_TYPE);
  if (have) return have.id;
  const concrete = doc.byCategory(Cat.Material).find((m) => m.name === "Concrete")?.id ?? null;
  return tx.create(Cat.FloorType, { layers: [{ function: "structure", materialId: concrete, thickness: 300 }] }, { name: FOUNDATION_SLAB_TYPE }).id;
}

export function createPadFooting(tx: Transaction, doc: Document, levelId: ElementId, position: Vec2, opts: Partial<Omit<PadFootingParams, "levelId" | "position">> = {}): Element<PadFootingParams> {
  if (doc.get(levelId)?.category !== Cat.Level) throw new Error("Footings sit on a level");
  return tx.create<PadFootingParams>(Cat.PadFooting, { levelId, position: { ...position }, width: 900, length: 900, depth: 400, offset: -100, rotation: 0, ...opts });
}

export function createStripFooting(tx: Transaction, doc: Document, wallId: ElementId, opts: Partial<Omit<StripFootingParams, "wallId">> = {}): Element<StripFootingParams> {
  if (doc.get(wallId)?.category !== Cat.Wall) throw new Error("Strip footings go under walls");
  return tx.create<StripFootingParams>(Cat.StripFooting, { wallId, width: 400, depth: 300, ...opts });
}

export function columnExtent(doc: Document, c: Column): { bottom: number; top: number } {
  const p = c.params;
  return {
    bottom: (doc.get<LevelParams>(p.baseLevelId)?.params.elevation ?? 0) + p.baseOffset,
    top: (doc.get<LevelParams>(p.topLevelId)?.params.elevation ?? 0) + p.topOffset,
  };
}

/** Section outline (and hole, for hollow sections), centred on the origin; x across b, y across d. */
export function sectionProfile(s: StructuralSectionParams): { outer: Vec2[]; holes: Vec2[][] } {
  const rect = (w: number, h: number): Vec2[] => [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ];
  switch (s.shape) {
    case "circle":
      return { outer: Array.from({ length: 24 }, (_, i) => ({ x: (s.d / 2) * Math.cos((i * Math.PI) / 12), y: (s.d / 2) * Math.sin((i * Math.PI) / 12) })), holes: [] };
    case "SHS":
      return { outer: rect(s.b, s.d), holes: [rect(s.b - 2 * s.tw, s.d - 2 * s.tf).reverse()] };
    case "I": {
      const { b, d, tf, tw } = s;
      return {
        outer: [
          { x: -b / 2, y: -d / 2 },
          { x: b / 2, y: -d / 2 },
          { x: b / 2, y: -d / 2 + tf },
          { x: tw / 2, y: -d / 2 + tf },
          { x: tw / 2, y: d / 2 - tf },
          { x: b / 2, y: d / 2 - tf },
          { x: b / 2, y: d / 2 },
          { x: -b / 2, y: d / 2 },
          { x: -b / 2, y: d / 2 - tf },
          { x: -tw / 2, y: d / 2 - tf },
          { x: -tw / 2, y: -d / 2 + tf },
          { x: -b / 2, y: -d / 2 + tf },
        ],
        holes: [],
      };
    }
    default:
      return { outer: rect(s.b, s.d), holes: [] };
  }
}
