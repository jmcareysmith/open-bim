/// <reference path="./globals.d.ts" />
export type ElementId = string;

/** 2D point in millimetres (plan coordinates, X east, Y north). */
export type Vec2 = {
  x: number;
  y: number;
};

export type ParamValue =
  | string
  | number
  | boolean
  | null
  | ParamValue[]
  | { [key: string]: ParamValue };

export type Params = { [key: string]: ParamValue };

export interface Element<P extends Params = Params> {
  readonly id: ElementId;
  readonly category: string;
  name?: string;
  /** Instances reference their type element (e.g. Wall → WallType). */
  typeId?: ElementId;
  params: P;
}

export function newId(): ElementId {
  return crypto.randomUUID();
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}
