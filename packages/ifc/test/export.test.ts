import { beforeAll, describe, expect, it } from "vitest";
import * as WebIFC from "web-ifc";
import {
  Document,
  applyResidentialTemplate,
  createDoor,
  createFloor,
  createRoom,
  createWall,
  createWindow,
  createProjectParameter,
  setCustomValue,
  type Vec2,
} from "@open-bim/core";
import { exportIfc, formatReal, formatString, ifcGuid, uuidFromIfcGuid } from "../src/index.ts";

let api: WebIFC.IfcAPI;
beforeAll(async () => {
  api = new WebIFC.IfcAPI();
  await api.Init(undefined, true);
}, 60_000);

function house() {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  const pts: Vec2[] = [
    { x: 0, y: 0 },
    { x: 8000, y: 0 },
    { x: 8000, y: 6000 },
    { x: 0, y: 6000 },
  ];
  const walls = doc.transact("Walls", (tx) =>
    pts.map((p, i) => createWall(tx, ids.wallTypes.exterior, p, pts[(i + 1) % 4]!, ids.levels.ground, { topLevelId: ids.levels.first })),
  );
  doc.transact("Openings", (tx) => {
    createDoor(tx, doc, ids.doorTypes.single810, walls[0]!.id, 2000);
    createWindow(tx, doc, ids.windowTypes.w1200x1200, walls[0]!.id, 5500);
  });
  doc.transact("Floor", (tx) => createFloor(tx, ids.floorTypes.slab ?? Object.values(ids.floorTypes)[0]!, ids.levels.ground, pts));
  const room = doc.transact("Room", (tx) => createRoom(tx, doc, ids.levels.ground, { x: 4000, y: 3000 }, { name: "Lounge" }));
  doc.transact("Param", (tx) => {
    createProjectParameter(tx, doc, "Fire Rating", { categories: ["Wall"] });
  });
  doc.transact("Value", (tx) => setCustomValue(tx, doc, doc.require(walls[1]!.id), "Fire Rating", "FRR 30/30/30"));
  return { doc, ids, walls, room };
}

const count = (model: number, type: number) => api.GetLineIDsWithType(model, type).size();

describe("STEP writing", () => {
  it("formats reals, strings and GlobalIds", () => {
    expect(formatReal(2)).toBe("2.");
    expect(formatReal(-0.5)).toBe("-0.5");
    expect(formatReal(1e-7)).toBe("1.E-07");
    expect(formatString("Kāpiti's")).toBe(String.raw`'K\X2\0101\X0\piti''s'`);
    const id = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    const g = ifcGuid(id);
    expect(g).toHaveLength(22);
    expect(uuidFromIfcGuid(g)).toBe(id);
    expect(ifcGuid("not-a-uuid")).toHaveLength(22);
  });
});

describe("IFC export", () => {
  it("opens in web-ifc with the spatial structure, elements, types and geometry", () => {
    const { doc } = house();
    const text = exportIfc(doc, { timestamp: "2026-10-12T00:00:00" });
    expect(text.startsWith("ISO-10303-21;")).toBe(true);
    const model = api.OpenModel(new TextEncoder().encode(text));
    expect(count(model, WebIFC.IFCPROJECT)).toBe(1);
    expect(count(model, WebIFC.IFCBUILDINGSTOREY)).toBe(3);
    expect(count(model, WebIFC.IFCWALL)).toBe(4);
    expect(count(model, WebIFC.IFCDOOR)).toBe(1);
    expect(count(model, WebIFC.IFCWINDOW)).toBe(1);
    expect(count(model, WebIFC.IFCSLAB)).toBe(1);
    expect(count(model, WebIFC.IFCSPACE)).toBe(1);
    expect(count(model, WebIFC.IFCWALLTYPE)).toBe(1);
    expect(count(model, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE)).toBe(1);
    let meshes = 0;
    api.StreamAllMeshes(model, (m) => {
      if (m.geometries.size() > 0) meshes++;
    });
    // 4 walls, door, window, slab (web-ifc does not stream IfcSpace bodies).
    expect(meshes).toBe(7);
    const wall = api.GetLine(model, api.GetLineIDsWithType(model, WebIFC.IFCWALL).get(0));
    expect(wall.GlobalId.value).toHaveLength(22);
    api.CloseModel(model);
  });

  it("writes property sets, quantities and layered materials", () => {
    const { doc } = house();
    const text = exportIfc(doc, { timestamp: "2026-10-12T00:00:00" });
    expect(text).toContain("'Pset_WallCommon'");
    expect(text).toContain("'Qto_WallBaseQuantities'");
    expect(text).toContain("'Qto_SpaceBaseQuantities'");
    expect(text).toContain("IFCLABEL('FRR 30/30/30')");
    expect(text).toMatch(/IFCMATERIALLAYERSET\(\(#\d+(,#\d+)+\),'Exterior/);
    const model = api.OpenModel(new TextEncoder().encode(text));
    expect(count(model, WebIFC.IFCPROPERTYSET)).toBeGreaterThan(5);
    expect(count(model, WebIFC.IFCMATERIALLAYER)).toBeGreaterThan(3);
    // Space area ≈ inside of the walls.
    const q = api.GetLineIDsWithType(model, WebIFC.IFCQUANTITYAREA);
    const areas: number[] = [];
    for (let i = 0; i < q.size(); i++) {
      const l = api.GetLine(model, q.get(i));
      if (l.Name.value === "NetFloorArea") areas.push(l.AreaValue.value);
    }
    expect(areas).toHaveLength(1);
    expect(areas[0]).toBeGreaterThan(40);
    expect(areas[0]).toBeLessThan(48);
    api.CloseModel(model);
  });

  it("georeferences the model with shared coordinates (IfcMapConversion to NZTM)", async () => {
    const { ensureProjectSettings } = await import("@open-bim/core");
    const { doc } = house();
    doc.transact("Location", (tx) => {
      const st = ensureProjectSettings(tx, doc);
      tx.update(st.id, { location: { epsg: 2193, eastings: 1756123.4, northings: 5920456.7, height: 25, rotation: 0.1 } });
    });
    const text = exportIfc(doc, { timestamp: "t" });
    expect(text).toContain("IFCPROJECTEDCRS('EPSG:2193'");
    const model = api.OpenModel(new TextEncoder().encode(text));
    const mc = api.GetLine(model, api.GetLineIDsWithType(model, WebIFC.IFCMAPCONVERSION).get(0));
    expect(mc.Eastings.value).toBeCloseTo(1756123.4);
    expect(mc.Scale.value).toBeCloseTo(0.001);
    expect(mc.XAxisOrdinate.value).toBeCloseTo(Math.sin(0.1));
    api.CloseModel(model);
  });

  it("is deterministic for the same model", () => {
    const { doc } = house();
    expect(exportIfc(doc, { timestamp: "t" })).toBe(exportIfc(doc, { timestamp: "t" }));
  });
});
