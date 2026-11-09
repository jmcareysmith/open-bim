import {
  Cat,
  analyticalModel,
  floorExtent,
  sectionMaterial,
  wallThickness,
  type Document,
  type ElementId,
  type Floor,
  type LoadCase,
  type StructuralLoadParams,
  type StructuralSectionParams,
  type Wall,
} from "@open-bim/core";
import { ifcGuid } from "./guid.ts";
import { DERIVED, en, real, typed, type Ref, type StepWriter } from "./step.ts";

// IFC4 Structural Analysis View: the analytical model (core `analyticalModel`) as an
// IfcStructuralAnalysisModel — curve members (columns, beams, braces) with their profiles and
// materials, surface members (walls, floors), point connections (pinned supports where the
// model has them), load cases G/Q/W with the line, point and area loads. Coordinates are model
// mm in one shared placement; forces are written in newtons per the units added here.

const CASES: Record<LoadCase, { name: string; action: string; source: string }> = {
  G: { name: "G - permanent", action: "PERMANENT_G", source: "DEAD_LOAD_G" },
  Q: { name: "Q - imposed", action: "VARIABLE_Q", source: "LIVE_LOAD_Q" },
  W: { name: "W - wind", action: "VARIABLE_Q", source: "WIND_W" },
};

/** Force units for the analysis model (N, N/m, N/m²), for the project's unit assignment. */
export function forceUnits(w: StepWriter): Ref[] {
  const newton = w.add("IfcSIUnit", DERIVED, en("FORCEUNIT"), null, en("NEWTON"));
  const metre = w.add("IfcSIUnit", DERIVED, en("LENGTHUNIT"), null, en("METRE"));
  const n = w.add("IfcDerivedUnitElement", newton, 1);
  return [
    newton,
    w.add("IfcDerivedUnit", [n, w.add("IfcDerivedUnitElement", metre, -1)], en("LINEARFORCEUNIT"), null),
    w.add("IfcDerivedUnit", [n, w.add("IfcDerivedUnitElement", metre, -2)], en("PLANARFORCEUNIT"), null),
  ];
}

/**
 * Write the analysis model in the model context `ctx`, serving `building`; returns the model,
 * or null when there's nothing structural.
 */
export function writeStructuralModel(w: StepWriter, doc: Document, ctx: Ref, world: Ref, building: Ref): Ref | null {
  const model = analyticalModel(doc);
  const loads = doc.byCategory<StructuralLoadParams>(Cat.StructuralLoad);
  if (!model.members.length && !model.panels.length) return null;
  let n = 0;
  const g = (kind: string, id?: string) => ifcGuid(`sav:${kind}:${id ?? n++}`);

  const topo = (kind: "Vertex" | "Edge" | "Face", item: Ref) => w.add("IfcProductDefinitionShape", null, null, [w.add("IfcTopologyRepresentation", ctx, "Reference", kind, [item])]);
  const placement = w.add("IfcLocalPlacement", null, world);
  const pt = (p: [number, number, number]) => w.add("IfcCartesianPoint", [real(p[0]), real(p[1]), real(p[2])]);

  // Nodes: a vertex each; point connections (supports pinned: translations fixed).
  const pinned = w.add("IfcBoundaryNodeCondition", "Pinned", typed("IFCBOOLEAN", true), typed("IFCBOOLEAN", true), typed("IFCBOOLEAN", true), typed("IFCBOOLEAN", false), typed("IFCBOOLEAN", false), typed("IFCBOOLEAN", false));
  const vertices = model.nodes.map((nd) => w.add("IfcVertexPoint", pt(nd.p)));
  const connections = model.nodes.map((nd, i) =>
    w.add("IfcStructuralPointConnection", g("node", String(i)), null, `N${i + 1}`, null, null, placement, topo("Vertex", vertices[i]!), nd.support ? pinned : null, null),
  );

  // Profiles and materials for curve members, one set per section type.
  const profileSets = new Map<ElementId, Ref>();
  const profileSet = (typeId: ElementId): Ref | null => {
    const t = doc.get<StructuralSectionParams>(typeId);
    if (!t) return null;
    let set = profileSets.get(typeId);
    if (set) return set;
    const s = t.params;
    const name = t.name ?? "Section";
    const profile =
      s.shape === "I"
        ? w.add("IfcIShapeProfileDef", en("AREA"), name, null, real(s.b), real(s.d), real(s.tw), real(s.tf), null, null, null)
        : s.shape === "SHS"
          ? w.add("IfcRectangleHollowProfileDef", en("AREA"), name, null, real(s.b), real(s.d), real(s.tw), null, null)
          : s.shape === "circle"
            ? w.add("IfcCircleProfileDef", en("AREA"), name, null, real(s.d / 2))
            : w.add("IfcRectangleProfileDef", en("AREA"), name, null, real(s.b), real(s.d));
    const kind = sectionMaterial(name, s);
    const mat = w.add("IfcMaterial", kind === "steel" ? "Steel Grade 300" : kind === "timber" ? "Timber SG8" : "Concrete 30 MPa", null, kind === "steel" ? "Steel" : kind === "timber" ? "Wood" : "Concrete");
    set = w.add("IfcMaterialProfileSet", name, null, [w.add("IfcMaterialProfile", name, null, mat, profile, null, null)], null);
    profileSets.set(typeId, set);
    return set;
  };

  // Curve members, connected to their end nodes.
  const memberRefs = new Map<ElementId, Ref>();
  const related: Ref[] = [...connections];
  const materialUse = new Map<Ref, Ref[]>();
  for (const m of model.members) {
    const el = doc.get(m.id);
    const edge = w.add("IfcEdge", vertices[m.a]!, vertices[m.b]!);
    // Axis: the member's local z — up for beams and braces; along plan x for columns.
    const axis = m.kind === "column" ? w.add("IfcDirection", [real(1), real(0), real(0)]) : w.add("IfcDirection", [real(0), real(0), real(1)]);
    const ref = w.add(
      "IfcStructuralCurveMember",
      g("member", m.id),
      null,
      el?.name ?? `${m.kind === "column" ? "C" : m.kind === "brace" ? "BR" : "B"}${memberRefs.size + 1}`,
      null,
      m.kind,
      placement,
      topo("Edge", edge),
      en(m.kind === "column" ? "RIGID_JOINED_MEMBER" : "PIN_JOINED_MEMBER"),
      axis,
    );
    memberRefs.set(m.id, ref);
    related.push(ref);
    for (const k of [m.a, m.b]) w.add("IfcRelConnectsStructuralMember", g("conn"), null, null, null, ref, connections[k]!, null, null, null, null);
    const set = el?.typeId ? profileSet(el.typeId) : null;
    if (set) materialUse.set(set, [...(materialUse.get(set) ?? []), ref]);
  }

  // Surface members: walls and floors as planar faces with their thickness.
  const panelRefs = new Map<ElementId, Ref>();
  for (const p of model.panels) {
    const el = doc.get(p.id);
    if (!el) continue;
    const loop = w.add("IfcPolyLoop", p.loop.map((q) => pt(q)));
    const face = w.add("IfcFace", [w.add("IfcFaceOuterBound", loop, true)]);
    let thickness = 0;
    try {
      if (p.kind === "wall") thickness = wallThickness(doc, el as Wall);
      else {
        const e = floorExtent(doc, el as Floor);
        thickness = e.top - e.bottom;
      }
    } catch {
      thickness = 0;
    }
    const ref = w.add("IfcStructuralSurfaceMember", g("panel", p.id), null, el.name ?? (p.kind === "wall" ? "Wall" : "Floor"), null, p.kind, placement, topo("Face", face), en(p.kind === "wall" ? "SHELL" : "BENDING_ELEMENT"), thickness > 0 ? real(thickness) : null);
    panelRefs.set(p.id, ref);
    related.push(ref);
  }

  // Load cases and the actions in them.
  const caseRefs = new Map<LoadCase, { ref: Ref; actions: Ref[] }>();
  const loadCase = (c: LoadCase) => {
    let lc = caseRefs.get(c);
    if (!lc) {
      const d = CASES[c];
      // Self-weight (gravity, −z) is applied in G only.
      const ref = w.add("IfcStructuralLoadCase", g("case", c), null, d.name, null, null, en("LOAD_CASE"), en(d.action), en(d.source), real(1), null, c === "G" ? [real(0), real(0), real(-1)] : null);
      caseRefs.set(c, (lc = { ref, actions: [] }));
    }
    return lc;
  };
  loadCase("G");
  for (const l of loads) {
    const p = l.params;
    const target = memberRefs.get(p.hostId) ?? panelRefs.get(p.hostId);
    if (!target) continue;
    const lc = loadCase(p.case);
    let action: Ref;
    if (p.kind === "point") {
      const m = model.members.find((x) => x.id === p.hostId)!;
      const a = model.nodes[m.a]!.p;
      const b = model.nodes[m.b]!.p;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
      const t = Math.min(Math.max((p.at ?? len / 2) / len, 0), 1);
      const at = w.add("IfcVertexPoint", pt([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]));
      const load = w.add("IfcStructuralLoadSingleForce", `${p.case} ${p.value} kN`, real(0), real(0), real(-p.value * 1000), null, null, null);
      action = w.add("IfcStructuralPointAction", g("action", l.id), null, `${p.case} point`, null, null, placement, topo("Vertex", at), load, en("GLOBAL_COORDS"), false);
    } else if (p.kind === "line") {
      const load = w.add("IfcStructuralLoadLinearForce", `${p.case} ${p.value} kN/m`, real(0), real(0), real(-p.value * 1000), null, null, null);
      action = w.add("IfcStructuralCurveAction", g("action", l.id), null, `${p.case} line`, null, null, placement, null, load, en("GLOBAL_COORDS"), false, en("TRUE_LENGTH"), en("CONST"));
    } else {
      const load = w.add("IfcStructuralLoadPlanarForce", `${p.case} ${p.value} kPa`, real(0), real(0), real(-p.value * 1000));
      action = w.add("IfcStructuralSurfaceAction", g("action", l.id), null, `${p.case} area`, null, null, placement, null, load, en("GLOBAL_COORDS"), false, en("TRUE_LENGTH"), en("CONST"));
    }
    w.add("IfcRelConnectsStructuralActivity", g("act"), null, null, null, target, action);
    lc.actions.push(action);
  }

  const cases = [...caseRefs.values()];
  const analysis = w.add("IfcStructuralAnalysisModel", g("model", "1"), null, "Analytical model", null, null, en("LOADING_3D"), null, cases.map((c) => c.ref), null, placement);
  w.add("IfcRelAssignsToGroup", g("assign"), null, null, null, related, null, analysis);
  w.add("IfcRelServicesBuildings", g("serves"), null, null, null, analysis, [building]);
  for (const c of cases) if (c.actions.length) w.add("IfcRelAssignsToGroup", g("assign"), null, null, null, c.actions, null, c.ref);
  for (const [set, els] of materialUse) w.add("IfcRelAssociatesMaterial", g("mat"), null, null, null, els, set);
  return analysis;
}
