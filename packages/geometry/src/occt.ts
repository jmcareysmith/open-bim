import { slopedTopWallMesh } from "./wallattach.ts";
import type { OpenCascadeInstance, TopoDS_Shape } from "replicad-opencascadejs";
import {
  Cat,
  familyValues,
  isFormCategory,
  wallCuts,
  wallDirection,
  wallExtent,
  wallThickness,
  type Document,
  type Element,
  type Values,
  type Wall,
  type WallCut,
  curtainOf,
  hasSlopedTop,
} from "@open-bim/core";
import { mergeMeshes } from "./doors.ts";
import { formMesh } from "./forms.ts";
import { buildFamilyInstance, nestedMeshes } from "./components.ts";
import type { LineData } from "./datums.ts";
import { joinedWallFootprint } from "./joins.ts";
import { SimpleKernel, type GeometryKernel } from "./kernel.ts";
import { buildLink } from "./links.ts";
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
  /** Stable family mesher (the family mesh cache is keyed by it). */
  private mesher = (fd: Document, v: Values) => this.familyMesh(fd, v);

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
      // Curtain walls aren't cut: panels and mullions are built on their own grid.
      if (cuts.length && !curtainOf(doc, wall)) return this.buildWallWithCuts(doc, wall, cuts);
    }
    if (el.category === Cat.FamilyInstance) return buildFamilyInstance(doc, el, this.mesher);
    if (el.category === Cat.Link) return buildLink(doc, el, this);
    if (isFormCategory(el.category) && !(el.params as { isVoid?: boolean }).isVoid) {
      // Family solids are cut by every void in the family (Revit behaviour).
      const values = familyValues(doc);
      const voids = doc.all().filter((e) => isFormCategory(e.category) && (e.params as { isVoid?: boolean }).isVoid);
      if (voids.length) return this.cutMeshes(formMesh(el, values), voids.map((v) => formMesh(v, values)));
    }
    return this.simple.build(doc, el);
  }

  /** All solid forms of a family, minus its voids, as one mesh (for placed family instances). */
  familyMesh(familyDoc: Document, values: Values): MeshData | null {
    const forms = familyDoc.all().filter((e) => isFormCategory(e.category));
    const solids = forms.filter((f) => !(f.params as { isVoid?: boolean }).isVoid).map((f) => formMesh(f, values));
    const voids = forms.filter((f) => (f.params as { isVoid?: boolean }).isVoid).map((f) => formMesh(f, values));
    const nested = nestedMeshes(familyDoc, values, this.mesher);
    if (!solids.length && !nested.length) return null;
    if (!voids.length) return mergeMeshes([...solids, ...nested]);
    return mergeMeshes([...solids.map((s) => this.cutMeshes(s, voids)), ...nested]);
  }

  /** Boolean difference of closed triangle meshes (each sewn into an OCCT solid first). */
  cutMeshes(solid: MeshData, voids: MeshData[]): MeshData {
    const gc: Deletable[] = [];
    const keep = <T extends Deletable>(o: T): T => {
      gc.push(o);
      return o;
    };
    try {
      let shape = this.meshToSolid(solid, keep);
      for (const v of voids) shape = keep(keep(new this.oc.BRepAlgoAPI_Cut(shape, this.meshToSolid(v, keep))).Shape());
      return this.mesh(shape, keep);
    } finally {
      for (const o of gc.reverse()) o.delete();
    }
  }

  /** Volume shared by two closed meshes, mm³ (0 when they only touch). */
  intersectionVolume(a: MeshData, b: MeshData): number {
    const gc: Deletable[] = [];
    const keep = <T extends Deletable>(o: T): T => {
      gc.push(o);
      return o;
    };
    try {
      const common = keep(keep(new this.oc.BRepAlgoAPI_Common(this.meshToSolid(a, keep), this.meshToSolid(b, keep))).Shape());
      const props = keep(new this.oc.GProp_GProps());
      this.oc.BRepGProp.VolumeProperties(common, props, false, false, false);
      return Math.abs(props.Mass());
    } finally {
      for (const o of gc.reverse()) o.delete();
    }
  }

  /** Sew a closed triangle mesh into a solid. */
  private meshToSolid(m: MeshData, keep: <T extends Deletable>(o: T) => T): TopoDS_Shape {
    const oc = this.oc;
    const sewing = keep(new oc.BRepBuilderAPI_Sewing(1e-3, true, true, true, false));
    const p = m.positions;
    const pt = (i: number) => keep(new oc.gp_Pnt(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!));
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!].map(pt) as [ReturnType<typeof pt>, ReturnType<typeof pt>, ReturnType<typeof pt>];
      if (a.Distance(b) < 1e-6 || b.Distance(c) < 1e-6 || c.Distance(a) < 1e-6) continue;
      const wire = keep(new oc.BRepBuilderAPI_MakeWire());
      for (const [u, v] of [
        [a, b],
        [b, c],
        [c, a],
      ] as const) {
        wire.Add(keep(keep(new oc.BRepBuilderAPI_MakeEdge(u, v)).Edge()));
      }
      const face = keep(new oc.BRepBuilderAPI_MakeFace(keep(wire.Wire()), true));
      if (face.IsDone()) sewing.Add(keep(face.Shape()));
    }
    sewing.Perform();
    const sewn = keep(sewing.SewedShape());
    const shells = keep(new oc.TopExp_Explorer(sewn, oc.TopAbs_ShapeEnum.TopAbs_SHELL));
    if (!shells.More()) throw new Error("Could not make a closed solid from a family form");
    const shell = keep(oc.TopoDS.Shell(keep(shells.Current())));
    const solid = keep(keep(new oc.BRepBuilderAPI_MakeSolid(shell)).Solid());
    const fix = keep(new oc.ShapeFix_Solid(solid));
    fix.Perform();
    return keep(fix.Solid());
  }

  buildLines(doc: Document, el: Element, scale?: number): LineData | null {
    return this.simple.buildLines(doc, el, scale);
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
      // Under a sloped roof: the sliced, roof-following wall sewn into a solid.
      const sloped = hasSlopedTop(doc, wall) ? slopedTopWallMesh(doc, wall) : null;
      // Wall solid: the joined plan footprint extruded from bottom to top.
      const fp = joinedWallFootprint(doc, wall);
      const wire = keep(new oc.BRepBuilderAPI_MakeWire());
      fp.forEach((a, i) => {
        const b = fp[(i + 1) % fp.length]!;
        const edge = keep(new oc.BRepBuilderAPI_MakeEdge(keep(new oc.gp_Pnt(a.x, a.y, bottom)), keep(new oc.gp_Pnt(b.x, b.y, bottom))));
        wire.Add(keep(edge.Edge()));
      });
      const face = keep(keep(new oc.BRepBuilderAPI_MakeFace(keep(wire.Wire()), true)).Shape());
      let solid: TopoDS_Shape = sloped ? this.meshToSolid(sloped, keep) : keep(keep(new oc.BRepPrimAPI_MakePrism(face, keep(new oc.gp_Vec(0, 0, top - bottom)), false, true)).Shape());

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
