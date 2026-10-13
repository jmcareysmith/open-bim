import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat, type LayeredTypeParams, type Wall, type WallParams } from "./architecture.ts";

// Wall sweeps and reveals (Revit: Wall Sweep / Reveal, and a wall type's Edit Assembly → Sweeps /
// Reveals). A sweep is a profile run along a wall face (skirting, chair rail, cornice, plinth); a
// reveal is a profile cut into the face (a groove). Type sweeps go on every wall of the type;
// instance sweeps on one wall, optionally over part of its length.

/**
 * Built-in profiles, mm: x out from the wall face (sweeps) or into it (reveals), y up from the
 * sweep's height.
 */
export const SWEEP_PROFILES: Record<string, { kind: WallSweep["kind"]; points: Vec2[] }> = {
  "Skirting 90 x 12": { kind: "sweep", points: [p(0, 0), p(12, 0), p(12, 78), p(7, 90), p(0, 90)] },
  "Skirting 140 x 18": { kind: "sweep", points: [p(0, 0), p(18, 0), p(18, 122), p(10, 140), p(0, 140)] },
  "Chair Rail 60 x 20": { kind: "sweep", points: [p(0, 0), p(14, 0), p(20, 10), p(20, 50), p(14, 60), p(0, 60)] },
  "Cornice 90 x 90": { kind: "sweep", points: [p(0, -90), p(12, -90), p(90, -12), p(90, 0), p(0, 0)] },
  "Plinth 200 x 25": { kind: "sweep", points: [p(0, 0), p(25, 0), p(25, 190), p(0, 215)] },
  "Band 150 x 30": { kind: "sweep", points: [p(0, 0), p(30, 0), p(30, 150), p(0, 150)] },
  "Reveal 20 x 20": { kind: "reveal", points: [p(0, 0), p(20, 0), p(20, 20), p(0, 20)] },
  "Reveal 10 x 10": { kind: "reveal", points: [p(0, 0), p(10, 0), p(10, 10), p(0, 10)] },
  "Reveal V 20": { kind: "reveal", points: [p(0, 0), p(12, 10), p(0, 20)] },
};

function p(x: number, y: number): Vec2 {
  return { x, y };
}

export type WallSweep = {
  kind: "sweep" | "reveal";
  /** A SWEEP_PROFILES name. */
  profile: string;
  side: "exterior" | "interior";
  /** mm from the wall's base (or its top when `fromTop`) to the profile's origin. */
  height: number;
  fromTop?: boolean;
  /** mm the profile stands off the face (sweeps) or sits back from it (reveals). */
  offset?: number;
  /** Instance sweeps: the part of the wall it runs over, mm from the wall's start (default all of it). */
  from?: number | null;
  to?: number | null;
  /** Default: the wall's material. */
  materialId?: ElementId | null;
};

/** The profile's points; unknown names fall back to the first profile of the sweep's kind. */
export function sweepProfile(s: Pick<WallSweep, "kind" | "profile">): Vec2[] {
  const named = SWEEP_PROFILES[s.profile];
  if (named) return named.points;
  return Object.values(SWEEP_PROFILES).find((x) => x.kind === s.kind)!.points;
}

/** Profile names for sweeps or for reveals. */
export function sweepProfileNames(kind: WallSweep["kind"]): string[] {
  return Object.entries(SWEEP_PROFILES)
    .filter(([, v]) => v.kind === kind)
    .map(([k]) => k);
}

/** A wall's sweeps and reveals: its type's, then its own. */
export function wallSweeps(doc: Document, wall: Wall): WallSweep[] {
  const type = wall.typeId ? doc.get<LayeredTypeParams>(wall.typeId)?.params : undefined;
  return [...(type?.sweeps ?? []), ...(wall.params.sweeps ?? [])];
}

export function validateSweep(s: WallSweep): void {
  if (s.kind !== "sweep" && s.kind !== "reveal") throw new Error("A sweep is a sweep or a reveal");
  if (s.side !== "exterior" && s.side !== "interior") throw new Error("A sweep goes on the exterior or interior face");
  if (!Number.isFinite(s.height)) throw new Error("Sweep height must be a number");
  if (s.from != null && s.to != null && !(s.to > s.from)) throw new Error("A sweep must end after it starts");
}

/** Set the sweeps of a wall or a wall type. */
export function setWallSweeps(tx: Transaction, doc: Document, id: ElementId, sweeps: WallSweep[]): void {
  const el = doc.require(id) as Element;
  if (el.category !== Cat.Wall && el.category !== Cat.WallType) throw new Error("Only walls and wall types have sweeps");
  for (const s of sweeps) validateSweep(s);
  const next = sweeps.map((s) => ({ ...s }));
  if (el.category === Cat.Wall) tx.update<WallParams>(id, { sweeps: next });
  else tx.update<LayeredTypeParams>(id, { sweeps: next });
}

// ---- Edit Profile (Revit: a wall's elevation outline) ----------------------------------------

/**
 * Set (or clear, with null) a wall's elevation profile: a polygon in wall coordinates, x along the
 * wall from its start, y up from its base, mm. The wall is that outline through its thickness.
 */
export function setWallProfile(tx: Transaction, doc: Document, id: ElementId, profile: Vec2[] | null): void {
  const el = doc.require(id) as Element;
  if (el.category !== Cat.Wall) throw new Error("Only walls have an editable profile");
  if (profile) {
    if (profile.length < 3) throw new Error("A wall profile needs at least 3 points");
    if (!profile.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))) throw new Error("Profile points must be numbers");
    let a = 0;
    profile.forEach((q, i) => {
      const r = profile[(i + 1) % profile.length]!;
      a += q.x * r.y - r.x * q.y;
    });
    if (Math.abs(a) / 2 < 1) throw new Error("A wall profile must enclose an area");
  }
  tx.update<WallParams>(id, { profile: profile ? profile.map((q) => ({ x: q.x, y: q.y })) : null });
}

/** A gable-end outline: square to `eaves` at both ends, up to `peak` in the middle. */
export function gableProfile(length: number, eaves: number, peak: number): Vec2[] {
  return [p(0, 0), p(length, 0), p(length, eaves), p(length / 2, peak), p(0, eaves)];
}

/** A stepped outline: `low` for the first `at` mm, `high` for the rest. */
export function stepProfile(length: number, at: number, low: number, high: number): Vec2[] {
  return [p(0, 0), p(length, 0), p(length, high), p(at, high), p(at, low), p(0, low)];
}
