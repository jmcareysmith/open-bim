import type { ElementId, FamilySolver, PlaneLine, PlaneSystem, Vec2 } from "@open-bim/core";

// Family constraint solving with PlaneGCS (FreeCAD's sketcher solver, LGPL, as WASM).
// Reference planes become lines; each free plane keeps its direction and can only slide along its
// normal; labelled dimensions are point-to-line distances; EQ puts the outer planes' midpoint on the middle one.

type Prim = Record<string, unknown> & { id?: string; type: string };

interface Gcs {
  clear_data(): void;
  push_primitives_and_params(p: Prim[]): void;
  solve(): number;
  apply_solution(): void;
  sketch_index: { get_primitives(): Prim[] };
}

/** Load PlaneGCS and return a solver for `setFamilySolver`. `options` go to the Emscripten module. */
export async function createPlaneSolver(options?: Record<string, unknown>): Promise<FamilySolver> {
  const { init_planegcs_module, GcsWrapper } = await import("@salusoft89/planegcs");
  const mod = await init_planegcs_module(options);
  const gcs = new GcsWrapper(new mod.GcsSystem()) as unknown as Gcs;
  return (sys) => solvePlanes(gcs, sys);
}

function solvePlanes(gcs: Gcs, sys: PlaneSystem): Map<ElementId, PlaneLine> {
  gcs.clear_data();
  let n = 0;
  // Zero-padded: the wrapper wants a line's points to have lower ids, compared as strings.
  const nextId = () => String(++n).padStart(6, "0");
  const prims: Prim[] = [];
  const point = (p: Vec2, fixed: boolean) => {
    const id = nextId();
    prims.push({ id, type: "point", x: p.x, y: p.y, fixed });
    return id;
  };
  const line = (a: string, b: string) => {
    const id = nextId();
    prims.push({ id, type: "line", p1_id: a, p2_id: b });
    return id;
  };
  const refs = new Map<ElementId, { a: string; b: string; l: string }>();
  for (const pl of sys.planes) {
    const a = point(pl.start, pl.fixed);
    const b = point(pl.end, pl.fixed);
    const l = line(a, b);
    refs.set(pl.id, { a, b, l });
    if (pl.fixed) continue;
    const dx = pl.end.x - pl.start.x;
    const dy = pl.end.y - pl.start.y;
    // Keep the plane's direction.
    if (Math.abs(dx) < 1e-9) prims.push({ id: nextId(), type: "vertical_l", l_id: l });
    else if (Math.abs(dy) < 1e-9) prims.push({ id: nextId(), type: "horizontal_l", l_id: l });
    else prims.push({ id: nextId(), type: "parallel", l1_id: l, l2_id: line(point(pl.start, true), point(pl.end, true)) });
    // Endpoints may only slide along the plane's normal (the plane moves, it doesn't stretch).
    const len = Math.hypot(dx, dy);
    const nrm = { x: -dy / len, y: dx / len };
    for (const [pid, p] of [
      [a, pl.start],
      [b, pl.end],
    ] as const) {
      const guide = line(point(p, true), point({ x: p.x + nrm.x * 1000, y: p.y + nrm.y * 1000 }, true));
      prims.push({ id: nextId(), type: "point_on_line_pl", p_id: pid, l_id: guide });
    }
  }
  for (const d of sys.distances) {
    const A = refs.get(d.a);
    const B = refs.get(d.b);
    if (A && B) prims.push({ id: nextId(), type: "p2l_distance", p_id: B.a, l_id: A.l, distance: d.value });
  }
  // EQ a|b|c: the midpoint of a segment joining a and c lies on b. For parallel planes that's
  // equal spacing (distance to a line is linear), whatever the planes' extents.
  for (const [a, b, c] of sys.equal) {
    const A = refs.get(a);
    const B = refs.get(b);
    const C = refs.get(c);
    if (!A || !B || !C) continue;
    prims.push({ id: nextId(), type: "midpoint_on_line_ll", l1_id: line(A.a, C.a), l2_id: B.l });
  }
  gcs.push_primitives_and_params(prims);
  const status = gcs.solve();
  if (status !== 0 && status !== 1) throw new Error("The family's dimensions can't all be satisfied (over-constrained?)");
  gcs.apply_solution();
  const byId = new Map(gcs.sketch_index.get_primitives().map((p) => [p.id, p]));
  const pt = (id: string): Vec2 => {
    const p = byId.get(id) as unknown as { x: number; y: number };
    return { x: p.x, y: p.y };
  };
  const out = new Map<ElementId, PlaneLine>();
  for (const [id, r] of refs) out.set(id, { start: pt(r.a), end: pt(r.b) });
  return out;
}
