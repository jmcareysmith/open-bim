import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, movePanel, placeOf, restoreLayout, setDockWidth, toggleCollapsed, untab } from "../src/docklayout.ts";

describe("dock layout", () => {
  it("moves panels between docks, tabs and floating", () => {
    let l = movePanel(DEFAULT_LAYOUT, "browser", { kind: "dock", side: "right", index: 0 });
    expect(l.right.panels).toEqual(["browser", "properties"]);
    expect(l.left.panels).toEqual([]);
    expect(l.right.tabbed).toBe(false);

    l = movePanel(l, "browser", { kind: "tab", with: "properties" });
    expect(l.right).toMatchObject({ panels: ["properties", "browser"], tabbed: true, active: "browser" });
    l = untab(l, "right");
    expect(l.right.tabbed).toBe(false);

    l = movePanel(l, "properties", { kind: "float", at: { x: 100, y: 80, w: 300, h: 400 } });
    expect(placeOf(l, "properties")).toBe("float");
    expect(l.right.panels).toEqual(["browser"]);
    // Tabbing onto a floating panel docks both as tabs.
    l = movePanel(l, "browser", { kind: "tab", with: "properties" });
    expect(l.right).toMatchObject({ panels: ["properties", "browser"], tabbed: true });
    expect(l.floats).toEqual({});
    // The original layout is untouched.
    expect(DEFAULT_LAYOUT.left.panels).toEqual(["browser"]);
  });

  it("clamps widths and toggles collapse", () => {
    expect(setDockWidth(DEFAULT_LAYOUT, "left", 50).left.width).toBe(160);
    expect(setDockWidth(DEFAULT_LAYOUT, "left", 5000).left.width).toBe(700);
    const c = toggleCollapsed(DEFAULT_LAYOUT, "browser");
    expect(c.collapsed).toEqual(["browser"]);
    expect(toggleCollapsed(c, "browser").collapsed).toEqual([]);
  });

  it("restores saved layouts safely", () => {
    expect(restoreLayout(null, ["browser", "properties"])).toEqual(DEFAULT_LAYOUT);
    const saved = { left: { panels: ["gone", "properties"], tabbed: true, active: "gone", width: "x" }, right: { panels: [], tabbed: false, active: null, width: 300 }, floats: {}, collapsed: ["gone"] };
    const l = restoreLayout(saved, ["browser", "properties"]);
    expect(l.left).toMatchObject({ panels: ["properties", "browser"], tabbed: false, width: 220 });
    expect(l.collapsed).toEqual([]);
  });
});
