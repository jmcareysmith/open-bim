import { describe, expect, it } from "vitest";
import {
  Document,
  PLAN_CUT_HEIGHT,
  TemporaryVisibility,
  typeCategoryOf,
  applyResidentialTemplate,
  planViewRange,
  type LevelParams,
} from "../src/index.ts";

describe("plan view range", () => {
  it("runs from the level to the cut plane and follows level changes", () => {
    const doc = new Document();
    const ids = applyResidentialTemplate(doc);
    expect(planViewRange(doc, ids.levels.first)).toEqual({ bottom: 2700, cut: 2700 + PLAN_CUT_HEIGHT });
    doc.transact("Raise", (tx) => tx.update<LevelParams>(ids.levels.first, { elevation: 3000 }));
    expect(planViewRange(doc, ids.levels.first, 1500)).toEqual({ bottom: 3000, cut: 4500 });
  });

  it("throws for a missing level", () => {
    expect(() => planViewRange(new Document(), "nope")).toThrow(/not found/);
  });
});

describe("temporary hide/isolate", () => {
  const wall = { id: "w1", category: "Wall" };
  const wall2 = { id: "w2", category: "Wall" };
  const door = { id: "d1", category: "Door" };

  it("hides elements and categories, accumulating", () => {
    const v = new TemporaryVisibility();
    expect(v.active).toBe(false);
    v.hide(["w1"]);
    v.hideCategories(["Door"]);
    expect([wall, wall2, door].map((e) => v.isVisible(e))).toEqual([false, true, false]);
    expect(v.active).toBe(true);
  });

  it("isolates elements or categories, replacing the previous isolate", () => {
    const v = new TemporaryVisibility();
    v.isolate(["w1", "d1"]);
    expect([wall, wall2, door].map((e) => v.isVisible(e))).toEqual([true, false, true]);
    v.isolateCategories(["Wall"]);
    expect([wall, wall2, door].map((e) => v.isVisible(e))).toEqual([true, true, false]);
  });

  it("unhides elements and categories, including into an isolation", () => {
    const v = new TemporaryVisibility();
    v.hide(["w1"]);
    v.hideCategories(["Door"]);
    v.unhide(["w1"]);
    v.unhideCategories(["Door"]);
    expect([wall, wall2, door].every((e) => v.isVisible(e))).toBe(true);
    v.isolate(["w1"]);
    v.unhide(["w2"]);
    expect([wall, wall2, door].map((e) => v.isVisible(e))).toEqual([true, true, false]);
  });

  it("combines hide with isolate and resets", () => {
    const v = new TemporaryVisibility();
    v.isolateCategories(["Wall"]);
    v.hide(["w2"]);
    expect([wall, wall2, door].map((e) => v.isVisible(e))).toEqual([true, false, false]);
    v.reset();
    expect(v.active).toBe(false);
    expect([wall, wall2, door].every((e) => v.isVisible(e))).toBe(true);
  });
});

describe("type categories", () => {
  it("map instances to their types", () => {
    expect(typeCategoryOf("Wall")).toBe("WallType");
    expect(typeCategoryOf("Window")).toBe("WindowType");
    expect(typeCategoryOf("Grid")).toBeUndefined();
  });
});
