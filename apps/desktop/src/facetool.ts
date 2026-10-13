import {
  Cat,
  createFloor,
  createRoof,
  createWall,
  isMass,
  levels,
  massFloors,
  polygonArea,
  totalThickness,
  type ElementId,
  type LayeredTypeParams,
  type MassFloor,
  type Vec2,
} from "@open-bim/core";
import { massFloorLoops, planarFace, roofFromFace, wallFromFace } from "@open-bim/geometry";
import type { Tool, ToolContext } from "./tools.ts";

// Model by Face (Revit: Massing & Site → Model by Face): click a mass face to build on it. Wall
// and Curtain Wall need a vertical face (the wall's exterior on it, its height the face's);
// Roof a top face (pitched from its low edge, or flat); Floor a mass floor, or a mass to floor
// all its mass floors.

export type FaceMode = "wall" | "curtain" | "roof" | "floor";

const LABEL: Record<FaceMode, string> = { wall: "Wall by Face", curtain: "Curtain Wall by Face", roof: "Roof by Face", floor: "Floor by Face" };

export class FaceTool implements Tool {
  readonly name: string;

  constructor(
    private ctx: ToolContext,
    private mode: FaceMode,
  ) {
    this.name = `face-${mode}`;
  }

  activate(): void {
    const hint = {
      wall: "click a vertical face of a mass",
      curtain: "click a vertical face of a mass",
      roof: "click the top face of a mass",
      floor: "click a mass floor, or a mass to floor all its mass floors (tick them in its Properties first)",
    }[this.mode];
    this.ctx.viewport.setShowMass(true);
    this.ctx.status(`${LABEL[this.mode]}: ${hint}. Show Mass is on while you pick.`);
  }

  /** The level an element starting at height z belongs to: the highest at or below it. */
  private levelAt(z: number): { id: ElementId; elevation: number } {
    const ls = levels(this.ctx.doc).map((l) => ({ id: l.id, elevation: l.params.elevation }));
    const below = ls.filter((l) => l.elevation <= z + 1);
    return (below.length ? below.at(-1) : ls[0])!;
  }

  click(ev: PointerEvent): void {
    const { doc } = this.ctx;
    if (this.mode === "floor") return this.floors(ev);
    const hit = this.ctx.viewport.pickFace(ev, (id) => {
      const el = doc.get(id);
      return !!el && isMass(doc, el);
    });
    if (!hit) return this.ctx.status(`${LABEL[this.mode]}: click a mass face.`);
    const face = planarFace(hit.mesh, hit.tri);
    if (!face) return;
    try {
      if (this.mode === "roof") {
        const r = roofFromFace(face);
        if (!r) return this.ctx.status("Roof by Face: pick a top face (walls and undersides aren't roofs).");
        const typeId = this.ctx.activeTypeId(Cat.RoofType) ?? doc.byCategory(Cat.RoofType)[0]?.id;
        if (!typeId) return this.ctx.status("⚠ No roof types in this project.");
        const lvl = this.levelAt(r.eave);
        const roof = doc.transact("Roof by face", (tx) => createRoof(tx, typeId, lvl.id, r.boundary, { slopes: r.slopes, baseOffset: r.eave - lvl.elevation }));
        this.ctx.setSelection([roof.id]);
        return this.ctx.status("Roof by Face: roof made on the face. Pick another, or Esc.");
      }
      const typeId =
        this.mode === "curtain"
          ? doc.byCategory<LayeredTypeParams>(Cat.WallType).find((t) => t.params.curtain)?.id
          : (this.ctx.activeTypeId(Cat.WallType) ?? doc.byCategory<LayeredTypeParams>(Cat.WallType).find((t) => !t.params.curtain && !t.params.stack?.length)?.id);
      if (!typeId) return this.ctx.status(`⚠ No ${this.mode === "curtain" ? "curtain wall" : "wall"} type in this project.`);
      const type = doc.require<LayeredTypeParams>(typeId);
      const w = wallFromFace(face, this.mode === "curtain" ? 0 : totalThickness(type));
      if (!w) return this.ctx.status(`${LABEL[this.mode]}: pick a vertical face.`);
      const lvl = this.levelAt(w.bottom);
      const wall = doc.transact(LABEL[this.mode], (tx) => createWall(tx, typeId, w.start, w.end, lvl.id, { baseOffset: w.bottom - lvl.elevation, height: w.top - w.bottom }));
      this.ctx.setSelection([wall.id]);
      this.ctx.status(`${LABEL[this.mode]}: made on the face. Pick another, or Esc.`);
    } catch (err) {
      this.ctx.status(`⚠ ${(err as Error).message}`);
    }
  }

  private floors(ev: PointerEvent): void {
    const { doc } = this.ctx;
    const hit = this.ctx.viewport.pickHit(ev, (id) => {
      const el = doc.get(id);
      return !!el && (el.category === Cat.MassFloor || isMass(doc, el));
    });
    if (!hit) return this.ctx.status("Floor by Face: click a mass floor or a mass.");
    const el = doc.require(hit.id);
    const list: MassFloor[] = el.category === Cat.MassFloor ? [el as MassFloor] : massFloors(doc, el.id);
    if (!list.length) return this.ctx.status("Floor by Face: that mass has no mass floors yet. Tick levels under Mass Floors in its Properties.");
    const typeId = this.ctx.activeTypeId(Cat.FloorType) ?? doc.byCategory(Cat.FloorType)[0]?.id;
    if (!typeId) return this.ctx.status("⚠ No floor types in this project.");
    try {
      const made = doc.transact("Floor by face", (tx) =>
        list.flatMap((mf) => {
          const { loops } = massFloorLoops(doc, mf);
          if (!loops.length) return [];
          // The biggest loop is the outline; any inside it are holes (courtyards, atria).
          const sorted = [...loops].sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)));
          const ccw = (l: Vec2[]) => (polygonArea(l) < 0 ? [...l].reverse() : l);
          const cw = (l: Vec2[]) => (polygonArea(l) > 0 ? [...l].reverse() : l);
          return [createFloor(tx, typeId, mf.params.levelId, ccw(sorted[0]!), { holes: sorted.slice(1).map(cw) }).id];
        }),
      );
      this.ctx.setSelection(made);
      this.ctx.status(`Floor by Face: ${made.length} floor(s) made on mass floors.`);
    } catch (err) {
      this.ctx.status(`⚠ ${(err as Error).message}`);
    }
  }
}
