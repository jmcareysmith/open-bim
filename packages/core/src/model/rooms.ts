import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Vec2 } from "../element.ts";
import { Cat, levels, type LevelParams } from "./architecture.ts";

// Rooms (Revit: Architecture → Room). A room is a point on a level; its boundary is found from
// room-bounding walls and room separation lines around that point (geometry/src/rooms.ts), so it
// follows the walls as they move. Upper limit + offset give the room its height.

export type RoomParams = {
  levelId: ElementId;
  /** Placement point; the room is the enclosed region containing it. Also the tag position. */
  point: Vec2;
  number: string;
  /** Room top: this level (+ limitOffset), or the base level + limitOffset when null. */
  upperLevelId: ElementId | null;
  limitOffset: number;
  /** Room bottom above its level, mm. */
  baseOffset: number;
};
export type Room = Element<RoomParams>;

/** Room separation line: bounds rooms where there is no wall (open-plan spaces). */
export type RoomSeparatorParams = { levelId: ElementId; start: Vec2; end: Vec2 };
export type RoomSeparator = Element<RoomSeparatorParams>;

/** Default unbounded height, mm (NZ 2.4 m stud). */
export const DEFAULT_ROOM_HEIGHT = 2400;

registerCategory({
  name: Cat.Room,
  dependencies: (el) => {
    const p = el.params as RoomParams;
    return [p.levelId, ...(p.upperLevelId ? [p.upperLevelId] : [])];
  },
  cascadeDelete: true,
  isType: false,
});
registerCategory({
  name: Cat.RoomSeparator,
  dependencies: (el) => [(el.params as RoomSeparatorParams).levelId],
  // Rooms on the level re-find their boundaries.
  related: (doc) => rooms(doc).map((r) => r.id),
  cascadeDelete: true,
  isType: false,
});

export function rooms(doc: Document): Room[] {
  return doc.byCategory<RoomParams>(Cat.Room) as Room[];
}

/** Level-scoped plan elements (rooms, separators): shown only in plans of this level. */
export function planLevelOf(el: Element): ElementId | undefined {
  return el.category === Cat.Room || el.category === Cat.RoomSeparator ? (el.params as { levelId: ElementId }).levelId : undefined;
}

/** Next free room number: one more than the highest numeric number in use. */
export function nextRoomNumber(doc: Document): string {
  const used = rooms(doc).map((r) => Number(r.params.number)).filter(Number.isFinite);
  return String(used.length ? Math.max(...used) + 1 : 1);
}

export function createRoom(
  tx: Transaction,
  doc: Document,
  levelId: ElementId,
  point: Vec2,
  opts: { name?: string; number?: string; upperLevelId?: ElementId | null; limitOffset?: number } = {},
): Room {
  if (doc.get(levelId)?.category !== Cat.Level) throw new Error("Rooms are placed on a level");
  return tx.create<RoomParams>(
    Cat.Room,
    {
      levelId,
      point: { ...point },
      number: opts.number ?? nextRoomNumber(doc),
      upperLevelId: opts.upperLevelId ?? null,
      limitOffset: opts.limitOffset ?? DEFAULT_ROOM_HEIGHT,
      baseOffset: 0,
    },
    { name: opts.name ?? "Room" },
  ) as Room;
}

export function createRoomSeparator(tx: Transaction, doc: Document, levelId: ElementId, start: Vec2, end: Vec2): RoomSeparator {
  if (doc.get(levelId)?.category !== Cat.Level) throw new Error("Room separators are drawn on a level");
  if (Math.hypot(end.x - start.x, end.y - start.y) < 1) throw new Error("Room separator must have non-zero length");
  return tx.create<RoomSeparatorParams>(Cat.RoomSeparator, { levelId, start: { ...start }, end: { ...end } }) as RoomSeparator;
}

/** Absolute bottom and top Z of a room, mm. */
export function roomExtent(doc: Document, room: Room): { bottom: number; top: number } {
  const p = room.params;
  const base = doc.require<LevelParams>(p.levelId).params.elevation;
  const bottom = base + p.baseOffset;
  const top = p.upperLevelId ? doc.require<LevelParams>(p.upperLevelId).params.elevation + p.limitOffset : base + p.limitOffset;
  return { bottom, top };
}

/** The level above a room's level, if any (the usual upper limit). */
export function levelAbove(doc: Document, levelId: ElementId): ElementId | null {
  const z = doc.require<LevelParams>(levelId).params.elevation;
  const above = levels(doc)
    .filter((l) => l.params.elevation > z)
    .sort((a, b) => a.params.elevation - b.params.elevation)[0];
  return above?.id ?? null;
}
