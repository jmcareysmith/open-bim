import { registerCategory } from "../categories.ts";
import type { Document, Transaction } from "../document.ts";
import type { Element, ElementId } from "../element.ts";
import { Cat } from "./architecture.ts";
import { registerWallCutter, validateHosted, type HostedParams } from "./openings.ts";

// Doors and windows: hosted in walls, sized by their type, cutting their own opening.
// Phase 1 keeps them parametric (a frame plus a leaf or glass); loadable families come in Phase 3.

export type DoorTypeParams = {
  /** Leaf (door panel) size, mm. */
  leafWidth: number;
  leafHeight: number;
  /** Jamb/head width, mm. The opening is leaf + frame on three sides. */
  frameWidth: number;
};

export type WindowTypeParams = {
  /** Overall frame size = opening size, mm. */
  width: number;
  height: number;
  frameWidth: number;
  /** Sill height for new instances, mm above the wall base. */
  defaultSill: number;
};

export type DoorParams = {
  hostId: ElementId;
  /** Centre of the door along the wall's location line, mm from the wall start. */
  position: number;
  /** Usually 0; raise for doors above a step. */
  sillHeight: number;
  /** Swing to the wall's right side instead of its left (Revit "Flip facing"). */
  facingFlipped: boolean;
  /** Hinge at the wall-end side instead of the wall-start side (Revit "Flip hand"). */
  handFlipped: boolean;
};

export type WindowParams = {
  hostId: ElementId;
  position: number;
  sillHeight: number;
};

export type Door = Element<DoorParams>;
export type Window = Element<WindowParams>;

const requireType = <P>(doc: Document, el: Element): P => {
  if (!el.typeId) throw new Error(`${el.category} has no type`);
  return doc.require(el.typeId).params as P;
};

/** Door opening: leaf plus frame at both jambs and the head. */
export function doorPlacement(doc: Document, el: Element): HostedParams {
  const p = el.params as DoorParams;
  const t = requireType<DoorTypeParams>(doc, el);
  return {
    hostId: p.hostId,
    position: p.position,
    sillHeight: p.sillHeight,
    width: t.leafWidth + 2 * t.frameWidth,
    height: t.leafHeight + t.frameWidth,
  };
}

export function windowPlacement(doc: Document, el: Element): HostedParams {
  const p = el.params as WindowParams;
  const t = requireType<WindowTypeParams>(doc, el);
  return { hostId: p.hostId, position: p.position, sillHeight: p.sillHeight, width: t.width, height: t.height };
}

const hosted = (el: Element) => [(el.params as { hostId: ElementId }).hostId];

for (const [cat, typeCat] of [
  [Cat.Door, Cat.DoorType],
  [Cat.Window, Cat.WindowType],
] as const) {
  registerCategory({ name: typeCat, dependencies: () => [], cascadeDelete: false, isType: true });
  registerCategory({
    name: cat,
    dependencies: (el) => [...hosted(el), ...(el.typeId ? [el.typeId] : [])],
    // Changing a door or window (or its type) changes the cut in its host.
    related: (_doc, el) => hosted(el),
    cascadeDelete: true,
    isType: false,
  });
}
registerWallCutter(Cat.Door, doorPlacement);
registerWallCutter(Cat.Window, windowPlacement);

export function createDoor(
  tx: Transaction,
  doc: Document,
  typeId: ElementId,
  hostId: ElementId,
  position: number,
  opts: Partial<Omit<DoorParams, "hostId" | "position">> = {},
): Door {
  const params: DoorParams = {
    hostId,
    position,
    sillHeight: opts.sillHeight ?? 0,
    facingFlipped: opts.facingFlipped ?? false,
    handFlipped: opts.handFlipped ?? false,
  };
  validateHosted(doc, doorPlacement(doc, { id: "", category: Cat.Door, typeId, params }));
  return tx.create<DoorParams>(Cat.Door, params, { typeId });
}

export function createWindow(
  tx: Transaction,
  doc: Document,
  typeId: ElementId,
  hostId: ElementId,
  position: number,
  opts: { sillHeight?: number } = {},
): Window {
  const type = doc.require<WindowTypeParams>(typeId);
  const params: WindowParams = { hostId, position, sillHeight: opts.sillHeight ?? type.params.defaultSill };
  validateHosted(doc, windowPlacement(doc, { id: "", category: Cat.Window, typeId, params }));
  return tx.create<WindowParams>(Cat.Window, params, { typeId });
}
