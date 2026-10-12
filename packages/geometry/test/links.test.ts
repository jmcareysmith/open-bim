import { describe, expect, it } from "vitest";
import {
  Document,
  applyResidentialTemplate,
  createLink,
  createWall,
  ensureProjectSettings,
  linkDocument,
  reloadLink,
  type Link,
  type LinkParams,
} from "@open-bim/core";
import { SimpleKernel, boundingBox } from "../src/index.ts";

function neighbour(at: { e: number; n: number }) {
  const doc = new Document();
  const ids = applyResidentialTemplate(doc);
  doc.transact("W", (tx) => {
    createWall(tx, ids.wallTypes.exterior, { x: 0, y: 0 }, { x: 4000, y: 0 }, ids.levels.ground, { topLevelId: ids.levels.first });
    const s = ensureProjectSettings(tx, doc);
    tx.update(s.id, { location: { epsg: 2193, eastings: at.e, northings: at.n, height: 0, rotation: 0 } });
  });
  return doc;
}

describe("links", () => {
  it("draws the linked project origin to origin, or by shared coordinates, plus an offset", () => {
    const host = new Document();
    host.transact("Loc", (tx) => {
      const s = ensureProjectSettings(tx, host);
      tx.update(s.id, { location: { epsg: 2193, eastings: 1756000, northings: 5920000, height: 0, rotation: 0 } });
    });
    const json = neighbour({ e: 1756020, n: 5920005 }).toJSON();
    const link = host.transact("Link", (tx) => createLink(tx, json, "C:/jobs/neighbour.obim"));
    expect(link.name).toBe("neighbour.obim");
    const k = new SimpleKernel();
    const box = () => boundingBox(k.build(host, host.require(link.id))!);
    expect(box().min[0]).toBeCloseTo(0, 0);
    host.transact("Shared", (tx) => tx.update<LinkParams>(link.id, { positioning: "shared" }));
    // 20 m east, 5 m north of the host's survey point.
    expect(box().min[0]).toBeCloseTo(20000, 0);
    expect(box().min[1]).toBeLessThan(5000);
    expect(box().max[1]).toBeGreaterThan(5000);
    host.transact("Move", (tx) => tx.update<LinkParams>(link.id, { offset: { x: 1000, y: 0, z: 500 } }));
    expect(box().min[0]).toBeCloseTo(21000, 0);
    expect(box().min[2]).toBeCloseTo(500, 0);
  });

  it("reloads a new snapshot", () => {
    const host = new Document();
    const before = neighbour({ e: 0, n: 0 });
    const link = host.transact("Link", (tx) => createLink(tx, before.toJSON(), "n.obim"));
    expect(linkDocument(link).byCategory("Wall")).toHaveLength(1);
    const after = neighbour({ e: 0, n: 0 });
    const ids = after.byCategory("WallType")[0]!.id;
    after.transact("More", (tx) => createWall(tx, ids, { x: 0, y: 3000 }, { x: 4000, y: 3000 }, after.byCategory("Level")[0]!.id, { height: 2400 }));
    host.transact("Reload", (tx) => reloadLink(tx, link.id, after.toJSON()));
    expect(linkDocument(host.require(link.id) as Link).byCategory("Wall")).toHaveLength(2);
    expect(() => host.transact("Bad", (tx) => createLink(tx, { format: "x" } as never, "x"))).toThrow(/Open-BIM project/);
  });
});
