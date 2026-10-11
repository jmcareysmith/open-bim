import type { OpenCascadeInstance, TopoDS_Shape } from "replicad-opencascadejs";
import { Cat, wallCuts, wallDirection, wallExtent, wallThickness, type Document, type Element, type Wall, type WallCut } from "@open-bim/core";
import type { LineData } from "./datums.ts";
import { joinedWallFootprint } from "./joins.ts";
import { SimpleKernel, type GeometryKernel } from "./kernel.ts";
import type { MeshData } from "./mesh.ts";

/** Cut boxes overshoot the wall faces by this much so booleans never leave slivers. */
const CUT_OVERSHOOT = 50;
/** Mesh deflection, mm. Walls are planar, so this only matters for future curved geometry. */
const LINEAR_DEFLECTION = 1;

type Deletable = { delete(): void };

/**
 * OpenCascade (B-rep) kernel. Builds what needs solid modelling — walls with openings — and
 * hands everything else to `SimpleKernel`, which is much faster for plain extrusions.
 * Create with `await OcctKernel.create()`; the WASM module (~23 MB) loads once.
 */
export class OcctKernel implements GeometryKernel {
  private simple = new SimpleKernel();

  constructor(private oc: OpenCascadeInstance) {}

  /** Load OpenCascade. `options` go to the Emscripten module (e.g. `locateFile` for the .wasm URL). */
  static async create(options?: Record<string, unknown>): Promise<OcctKernel> {
    const { default: init } = await import("replicad-opencascadejs");
    return new OcctKernel(await init(options));
  }

  build(doc: Document, el: Element): MeshData | null {
    if (el.category === Cat.Wall) {
      const wall = el as Wall;
      const cuts = wallCuts(doc, wall);
      if (cuts.length) return this.buildWallWithCuts(doc, wall, cuts);
    }
    return this.simple.build(doc, el);
  }

  buildLines(doc: Document, el: Element): LineData | null {
    return this.simple.buildLines(doc, el);
  }

  private buildWallWithCuts(doc: Document, wall: Wall, cuts: WallCut[]): MeshData | null {
    const { bottom, top } = wallExtent(doc, wall);
    if (top <= bottom) return null;
    const oc = this.oc;
    const gc: Deletable[] = [];
    const keep = <T extends Deletable>(o: T): T => {
      gc.push(o);
      return o;
    };
    try {
      // Wall solid: the joined plan footprint extruded from bottom to top.
      const fp = joinedWallFootprint(doc, wall);
      const wire = keep(new oc.BRepBuilderAPI_MakeWire());
      fp.forEach((a, i) => {
        const b = fp[(i + 1) % fp.length]!;
        const edge = keep(new oc.BRepBuilderAPI_MakeEdge(keep(new oc.gp_Pnt(a.x, a.y, bottom)), keep(new oc.gp_Pnt(b.x, b.y, bottom))));
        wire.Add(keep(edge.Edge()));
      });
      const face = keep(keep(new oc.BRepBuilderAPI_MakeFace(keep(wire.Wire()), true)).Shape());
      let solid: TopoDS_Shape = keep(keep(new oc.BRepPrimAPI_MakePrism(face, keep(new oc.gp_Vec(0, 0, top - bottom)), false, true)).Shape());

      // Each cut: a box aligned with the wall (x along it, y across), through its full thickness.
      const d = wallDirection(wall);
      const n = { x: -d.y, y: d.x };
      const half = wallThickness(doc, wall) / 2 + CUT_OVERSHOOT;
      const { start } = wall.params;
      for (const c of cuts) {
        const origin = keep(new oc.gp_Pnt(start.x + d.x * c.u0 - n.x * half, start.y + d.y * c.u0 - n.y * half, c.z0));
        const axes = keep(new oc.gp_Ax2(origin, keep(new oc.gp_Dir(0, 0, 1)), keep(new oc.gp_Dir(d.x, d.y, 0))));
        const box = keep(keep(new oc.BRepPrimAPI_MakeBox(axes, c.u1 - c.u0, half * 2, c.z1 - c.z0)).Shape());
        solid = keep(keep(new oc.BRepAlgoAPI_Cut(solid, box)).Shape());
      }
      return this.mesh(solid, keep);
    } finally {
      for (const o of gc.reverse()) o.delete();
    }
  }

  /** Triangulate a shape into flat-shaded `MeshData`. */
  private mesh(shape: TopoDS_Shape, keep: <T extends Deletable>(o: T) => T): MeshData {
    const oc = this.oc;
    keep(new oc.BRepMesh_IncrementalMesh(shape, LINEAR_DEFLECTION, false, 0.5, false));
    const pos: number[] = [];
    const nor: number[] = [];
    const explorer = keep(new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE));
    for (; explorer.More(); explorer.Next()) {
      const face = keep(oc.TopoDS.Face(keep(explorer.Current())));
      const loc = keep(new oc.TopLoc_Location());
      const tri = oc.BRep_Tool.Triangulation(face, loc, 0);
      if (!tri) continue;
      const trsf = loc.IsIdentity() ? null : keep(loc.Transformation());
      const reversed = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
      const nodes: [number, number, number][] = [];
      for (let i = 1; i <= tri.NbNodes(); i++) {
        let p = tri.Node(i);
        if (trsf) {
          const q = p.Transformed(trsf);
          p.delete();
          p = q;
        }
        nodes.push([p.X(), p.Y(), p.Z()]);
        p.delete();
      }
      for (let i = 1; i <= tri.NbTriangles(); i++) {
        const t = tri.Triangle(i);
        const a = nodes[t.Value(1) - 1]!;
        let b = nodes[t.Value(2) - 1]!;
        let c = nodes[t.Value(3) - 1]!;
        t.delete();
        if (reversed) [b, c] = [c, b];
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const nx = u[1]! * v[2]! - u[2]! * v[1]!;
        const ny = u[2]! * v[0]! - u[0]! * v[2]!;
        const nz = u[0]! * v[1]! - u[1]! * v[0]!;
        const l = Math.hypot(nx, ny, nz);
        if (l === 0) continue;
        for (const p of [a, b, c]) {
          pos.push(...p);
          nor.push(nx / l, ny / l, nz / l);
        }
      }
    }
    return {
      positions: new Float32Array(pos),
      normals: new Float32Array(nor),
      indices: Uint32Array.from({ length: pos.length / 3 }, (_, i) => i),
    };
  }
}
