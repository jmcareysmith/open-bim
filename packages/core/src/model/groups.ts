import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId, Params, Vec2 } from "../element.ts";
import { Cat } from "./architecture.ts";

// Model groups (Revit: Model Group). A GroupType names the group; each Group instance has an
// origin and rotation, and its members are ordinary elements carrying `groupId` (a dependency, so
// deleting the group deletes them). Placing copies a group's members; "apply to all" re-copies one
// instance's members into every other instance, which is how edits propagate.

export type GroupParams = { origin: Vec2; rotation: number };
export type Group = Element<GroupParams>;

/** Categories that can be grouped (hosted openings come along with their walls). */
export const GROUPABLE = new Set<string>([
  Cat.Wall,
  Cat.Floor,
  Cat.Ceiling,
  Cat.Roof,
  Cat.Door,
  Cat.Window,
  Cat.WallOpening,
  Cat.FamilyInstance,
  Cat.Room,
  Cat.RoomSeparator,
]);
const HOSTED = new Set<string>([Cat.Door, Cat.Window, Cat.WallOpening]);

registerCategory({ name: Cat.GroupType, dependencies: () => [], cascadeDelete: false, isType: true });
registerCategory({ name: Cat.Group, dependencies: (el) => (el.typeId ? [el.typeId] : []), cascadeDelete: true, isType: false });

export function groupOf(el: Element): ElementId | undefined {
  const g = (el.params as { groupId?: unknown }).groupId;
  return typeof g === "string" ? g : undefined;
}

export function groupMembers(doc: Document, groupId: ElementId): Element[] {
  return doc.all().filter((e) => groupOf(e) === groupId);
}

export function groupInstances(doc: Document, typeId: ElementId): Group[] {
  return (doc.byCategory<GroupParams>(Cat.Group) as Group[]).filter((g) => g.typeId === typeId);
}

// ---- transforms --------------------------------------------------------------------------

/** Rigid plan transform: rotate by `angle` about `about`, then translate by `move`. */
export interface PlanTransform {
  about: Vec2;
  angle: number;
  move: Vec2;
}

export function applyTransform(t: PlanTransform, p: Vec2): Vec2 {
  const c = Math.cos(t.angle);
  const s = Math.sin(t.angle);
  const dx = p.x - t.about.x;
  const dy = p.y - t.about.y;
  return { x: t.about.x + dx * c - dy * s + t.move.x, y: t.about.y + dx * s + dy * c + t.move.y };
}

const isVec = (v: unknown): v is Vec2 => !!v && typeof v === "object" && typeof (v as Vec2).x === "number" && typeof (v as Vec2).y === "number";

/** An element's params moved by a plan transform (hosted elements ride on their host). */
export function transformedParams(el: Element, t: PlanTransform): Params {
  const p = { ...(el.params as Record<string, unknown>) };
  if (HOSTED.has(el.category)) return p as Params;
  for (const key of ["start", "end", "point", "position"] as const) {
    if (isVec(p[key])) p[key] = applyTransform(t, p[key]);
  }
  if (Array.isArray(p.boundary)) p.boundary = (p.boundary as Vec2[]).map((q) => applyTransform(t, q));
  if (Array.isArray(p.holes)) p.holes = (p.holes as Vec2[][]).map((h) => h.map((q) => applyTransform(t, q)));
  if (el.category === Cat.FamilyInstance && !p.hostId && typeof p.rotation === "number") p.rotation = p.rotation + t.angle;
  return p as Params;
}

/** Plan points of an element, for centring a group's origin. */
function points(el: Element): Vec2[] {
  const p = el.params as Record<string, unknown>;
  const out: Vec2[] = [];
  for (const key of ["start", "end", "point", "position"]) if (isVec(p[key])) out.push(p[key] as Vec2);
  if (Array.isArray(p.boundary)) out.push(...(p.boundary as Vec2[]));
  return out;
}

// ---- operations ----------------------------------------------------------------------------

/** Group elements (plus doors/windows/openings in grouped walls) under a new group type. */
export function createGroup(tx: Transaction, doc: Document, ids: ElementId[], name?: string): Group {
  const picked = ids.map((id) => doc.require(id));
  const bad = picked.find((e) => !GROUPABLE.has(e.category));
  if (bad) throw new Error(`${bad.category} elements can't be grouped`);
  if (picked.some((e) => groupOf(e))) throw new Error("An element is already in a group; ungroup it first");
  const members = new Map(picked.map((e) => [e.id, e]));
  for (const e of doc.all()) {
    const host = (e.params as { hostId?: unknown }).hostId;
    if (typeof host === "string" && members.has(host) && !groupOf(e)) members.set(e.id, e);
  }
  for (const e of members.values()) {
    const host = (e.params as { hostId?: unknown }).hostId;
    if (HOSTED.has(e.category) && typeof host === "string" && !members.has(host)) throw new Error("Doors, windows and openings are grouped with their wall");
  }
  const pts = [...members.values()].flatMap(points);
  if (!pts.length) throw new Error("Nothing to group");
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const origin = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  let typeName = name ?? "Group 1";
  for (let i = 2; !name && doc.byCategory(Cat.GroupType).some((t) => t.name === typeName); i++) typeName = `Group ${i}`;
  if (doc.byCategory(Cat.GroupType).some((t) => t.name === typeName)) throw new Error(`A group called "${typeName}" already exists`);
  const type = tx.create(Cat.GroupType, {}, { name: typeName });
  const group = tx.create<GroupParams>(Cat.Group, { origin, rotation: 0 }, { typeId: type.id }) as Group;
  for (const id of members.keys()) tx.update(id, { groupId: group.id });
  return group;
}

/** Copy `source`'s members into `target` (an existing, empty group instance). */
function copyMembers(tx: Transaction, doc: Document, source: Group, target: Group): void {
  const t: PlanTransform = {
    about: source.params.origin,
    angle: target.params.rotation - source.params.rotation,
    move: { x: target.params.origin.x - source.params.origin.x, y: target.params.origin.y - source.params.origin.y },
  };
  const members = groupMembers(doc, source.id);
  // Hosts before hosted, so host ids can be remapped.
  members.sort((a, b) => Number(HOSTED.has(a.category)) - Number(HOSTED.has(b.category)));
  const map = new Map<ElementId, ElementId>();
  for (const m of members) {
    const p = transformedParams(m, t) as Record<string, unknown>;
    p.groupId = target.id;
    if (typeof p.hostId === "string" && map.has(p.hostId)) p.hostId = map.get(p.hostId)!;
    const copy = tx.create(m.category, p as Params, { ...(m.name !== undefined ? { name: m.name } : {}), ...(m.typeId ? { typeId: m.typeId } : {}) });
    map.set(m.id, copy.id);
  }
}

/** Place another instance of a group's type at `origin` (copies the source instance's members). */
export function placeGroup(tx: Transaction, doc: Document, sourceId: ElementId, origin: Vec2, rotation = 0): Group {
  const source = doc.require<GroupParams>(sourceId) as Group;
  if (source.category !== Cat.Group) throw new Error("Pick a group to copy");
  const target = tx.create<GroupParams>(Cat.Group, { origin: { ...origin }, rotation }, { typeId: source.typeId! }) as Group;
  copyMembers(tx, doc, source, target);
  return target;
}

/** Move/rotate a group instance and its members. */
export function moveGroup(tx: Transaction, doc: Document, groupId: ElementId, origin: Vec2, rotation?: number): void {
  const g = doc.require<GroupParams>(groupId) as Group;
  const angle = (rotation ?? g.params.rotation) - g.params.rotation;
  const t: PlanTransform = { about: g.params.origin, angle, move: { x: origin.x - g.params.origin.x, y: origin.y - g.params.origin.y } };
  for (const m of groupMembers(doc, groupId)) tx.update(m.id, transformedParams(m, t));
  tx.update<GroupParams>(groupId, { origin: { ...origin }, rotation: g.params.rotation + angle });
}

/** Make every other instance of the group's type match this one (Revit: finish editing a group). */
export function syncGroupInstances(tx: Transaction, doc: Document, sourceId: ElementId): number {
  const source = doc.require<GroupParams>(sourceId) as Group;
  let n = 0;
  for (const other of groupInstances(doc, source.typeId!)) {
    if (other.id === source.id) continue;
    for (const m of groupMembers(doc, other.id)) if (doc.has(m.id)) tx.delete(m.id);
    copyMembers(tx, doc, source, other);
    n++;
  }
  return n;
}

/** Ungroup: members become ordinary elements; the type goes when its last instance does. */
export function ungroup(tx: Transaction, doc: Document, groupId: ElementId): ElementId[] {
  const g = doc.require(groupId);
  const members = groupMembers(doc, groupId);
  for (const m of members) tx.update(m.id, { groupId: undefined } as never);
  tx.delete(groupId);
  if (g.typeId && !groupInstances(doc, g.typeId).length) tx.delete(g.typeId);
  return members.map((m) => m.id);
}
