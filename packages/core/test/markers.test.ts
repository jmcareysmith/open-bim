import { describe, expect, it } from "vitest";
import {
  Document,
  applyFamilyTemplate,
  applyResidentialTemplate,
  createSection,
  createSheet,
  familyInfo,
  loadFamily,
  markerFamilies,
  markerRole,
  markerText,
  placeView,
  viewMarkerFamily,
  viewNumber,
  views,
  type ViewParams,
} from "../src/index.ts";

function headFamily(): Document {
  const fam = new Document();
  applyFamilyTemplate(fam, "ViewMarker", "My Head");
  fam.transact("Role", (tx) => tx.update(familyInfo(fam)!.id, { markerRole: "sectionHead" }));
  return fam;
}

describe("view marker families", () => {
  it("are 2D at paper size, know their role, and are picked per view", () => {
    const fam = headFamily();
    expect(views(fam).map((v) => [v.params.kind, v.params.scale])).toEqual([["floorPlan", 1]]);
    const doc = new Document();
    applyResidentialTemplate(doc);
    const def = doc.transact("Load", (tx) => loadFamily(tx, doc, fam, "My Head"));
    expect(markerRole(def)).toBe("sectionHead");
    expect(markerFamilies(doc, "sectionHead").map((f) => f.id)).toEqual([def.id]);
    expect(markerFamilies(doc, "elevation")).toEqual([]);

    const sec = doc.transact("S", (tx) => createSection(tx, doc, { x: 0, y: 0 }, { x: 4000, y: 0 }, { name: "Section 12" }));
    expect(viewMarkerFamily(doc, sec, "sectionHead")).toBeUndefined();
    doc.transact("Pick", (tx) => tx.update<ViewParams>(sec.id, { headFamilyId: def.id }));
    const s2 = doc.require<ViewParams>(sec.id) as typeof sec;
    expect(viewMarkerFamily(doc, s2, "sectionHead")?.id).toBe(def.id);
    // The wrong role is ignored (built-in drawn instead).
    expect(viewMarkerFamily(doc, s2, "sectionTail")).toBeUndefined();

    // Text fields.
    expect(markerText(doc, s2, "{n} / {sheet}")).toBe("12 / ");
    const sheet = doc.transact("Sheet", (tx) => createSheet(tx, doc, { number: "A201" }));
    doc.transact("Place", (tx) => placeView(tx, doc, sheet.id, sec.id, { x: 200, y: 150 }));
    expect(markerText(doc, s2, "{n} / {sheet} {name}")).toBe("12 / A201 Section 12");
    // Deleting the family leaves the view, back on the built-in marks.
    doc.transact("Delete", (tx) => tx.delete(def.id));
    expect(doc.has(sec.id)).toBe(true);
    expect(viewMarkerFamily(doc, doc.require<ViewParams>(sec.id) as typeof sec, "sectionHead")).toBeUndefined();
  });

  it("view numbers come from the name", () => {
    expect(viewNumber("Section 3")).toBe("3");
    expect(viewNumber("North")).toBe("Nor");
  });
});
