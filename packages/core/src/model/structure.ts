import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat, type LevelParams } from "./architecture.ts";

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
registerCategory({ name: Cat.Beam, dependencies: (el) => [(el.params as BeamParams).levelId, ...typeDeps(el)], cascadeDelete: true, isType: false });
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
