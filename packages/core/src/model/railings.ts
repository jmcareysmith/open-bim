import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat, type LevelParams } from "./architecture.ts";
import { DEFAULT_STAIR_TYPE, stairLayout, type Stair, type StairTypeParams } from "./stairs.ts";

// Railings (Revit: Railing — sketch path, or placed on a stair). A railing follows a 3D path: a
// sketched plan path at its level, or a stair's side edge along the nosing line and landings.
// Barrier defaults follow NZBC F4/AS1: 1000 mm high, openings no more than 100 mm.

export type RailingTypeParams = {
  height: number;
  /** Top rail section, mm (square). */
  railSize: number;
  /** Baluster section, mm (square). */
  balusterSize: number;
  /** Clear gap between balusters, mm (F4/AS1: no opening over 100 mm). */
  balusterGap: number;
};

export type RailingParams = {
  levelId: ElementId;
  baseOffset: number;
  /** Sketched path in plan (when not on a stair). */
  path: Vec2[];
  /** Stair the railing runs along, and which side looking up the stair. */
  hostId: ElementId | null;
  side: "left" | "right";
};
export type Railing = Element<RailingParams>;

export const DEFAULT_RAILING_TYPE: RailingTypeParams = { height: 1000, railSize: 50, balusterSize: 20, balusterGap: 100 };
/** Railings on stairs sit this far in from the stair's edge. */
const EDGE_INSET = 50;

registerCategory({ name: Cat.RailingType, dependencies: () => [], cascadeDelete: false, isType: true });
registerCategory({
  name: Cat.Railing,
  dependencies: (el) => {
    const p = el.params as RailingParams;
    return [p.levelId, ...(p.hostId ? [p.hostId] : []), ...(el.typeId ? [el.typeId] : [])];
  },
  cascadeDelete: true,
  isType: false,
});

export function ensureRailingType(tx: Transaction, doc: Document): ElementId {
  return doc.byCategory(Cat.RailingType)[0]?.id ?? tx.create<RailingTypeParams>(Cat.RailingType, { ...DEFAULT_RAILING_TYPE }, { name: "Railing - 1000 mm, 100 mm max gap" }).id;
}

export function createRailing(tx: Transaction, doc: Document, typeId: ElementId, levelId: ElementId, path: Vec2[]): Railing {
  if (path.length < 2) throw new Error("A railing needs at least two points");
  if (doc.get(typeId)?.category !== Cat.RailingType) throw new Error("Railings need a railing type");
  return tx.create<RailingParams>(Cat.Railing, { levelId, baseOffset: 0, path: path.map((p) => ({ ...p })), hostId: null, side: "left" }, { typeId }) as Railing;
}

/** Railings on both sides of a stair. */
export function createStairRailings(tx: Transaction, doc: Document, typeId: ElementId, stair: Stair): Railing[] {
  return (["left", "right"] as const).map(
    (side) => tx.create<RailingParams>(Cat.Railing, { levelId: stair.params.baseLevelId, baseOffset: 0, path: [], hostId: stair.id, side }, { typeId }) as Railing,
  );
}

/** The railing's base line as absolute 3D points (the rail runs `height` above it). */
export function railingPath(doc: Document, r: Railing): { x: number; y: number; z: number }[] {
  const p = r.params;
  const host = p.hostId ? (doc.get(p.hostId) as Stair | undefined) : undefined;
  if (host && host.category === Cat.Stair) {
    const L = stairLayout(doc, host);
    const width = (host.typeId ? doc.get<StairTypeParams>(host.typeId)?.params.width : undefined) ?? DEFAULT_STAIR_TYPE.width;
    const off = (width / 2 - EDGE_INSET) * (p.side === "left" ? 1 : -1);
    const out: { x: number; y: number; z: number }[] = [];
    for (const run of L.runs) {
      const n = { x: -run.dir.y, y: run.dir.x };
      const at = (u: number) => ({ x: run.start.x + run.dir.x * u + n.x * off, y: run.start.y + run.dir.y * u + n.y * off });
      // Along the nosing line: tread j's nose is at u = j·G, height z0 + (j+1)·R.
      const a = at(0);
      const b = at(run.length);
      out.push({ ...a, z: run.z0 + L.riser }, { ...b, z: run.z0 + run.risers * L.riser });
    }
    return out;
  }
  const z = (doc.get<LevelParams>(p.levelId)?.params.elevation ?? 0) + p.baseOffset;
  return p.path.map((q) => ({ x: q.x, y: q.y, z }));
}
