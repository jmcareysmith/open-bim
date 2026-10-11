import { describe, expect, it } from "vitest";
import { FormulaError, evaluate, evaluateParameters, formulaRefs } from "../src/index.ts";

const v = { Width: 900, Height: 2100, "Frame Width": 40, Count: 3 };

describe("formulas", () => {
  it.each([
    ["Width / 2", 450],
    ["Width - 2 * Frame Width", 820],
    ["(Width + Height) * 2", 6000],
    ["-Width + 1000", 100],
    ["2 ^ 3", 8],
    ["if(Width > 800, 1, 0)", 1],
    ["if(Width < 800 or Height > 2000, 10, 20)", 10],
    ["if(Width < 800 and Height > 2000, 10, 20)", 20],
    ["if(not(Width = 900), 1, 2)", 2],
    ["min(Width, Height, 500)", 500],
    ["max(Width, Height)", 2100],
    ["round(Width / 7)", 129],
    ["roundup(1.2) + rounddown(1.8) + abs(-3)", 6],
    ["sqrt(16)", 4],
    ["sin(30) * 2", 1],
    ["  42 ", 42],
  ])("%s = %d", (f, expected) => expect(evaluate(f, v)).toBeCloseTo(expected));

  it("numbers pass straight through", () => {
    expect(evaluate(250, {})).toBe(250);
  });

  it("reports errors clearly", () => {
    expect(() => evaluate("Width +", v)).toThrow(FormulaError);
    expect(() => evaluate("Depth * 2", v)).toThrow(/Unknown name "Depth"/);
    expect(() => evaluate("(Width", v)).toThrow(/Missing \)/);
    expect(() => evaluate("Width / 0", v)).toThrow(/Division by zero/);
    expect(() => evaluate("if(1, 2)", v)).toThrow(/3 arguments/);
  });

  it("finds referenced parameters", () => {
    expect(formulaRefs("Width - 2 * Frame Width", Object.keys(v)).sort()).toEqual(["Frame Width", "Width"]);
  });
});

describe("parameter evaluation", () => {
  it("evaluates formulas in dependency order", () => {
    const vals = evaluateParameters(
      [
        { name: "Leaf Width", formula: "Width - 2 * Frame" },
        { name: "Width" },
        { name: "Frame" },
        { name: "Half Leaf", formula: "Leaf Width / 2" },
      ],
      { Width: 900, Frame: 40 },
    );
    expect(vals).toEqual({ "Leaf Width": 820, Width: 900, Frame: 40, "Half Leaf": 410 });
  });

  it("rejects circular formulas", () => {
    expect(() => evaluateParameters([{ name: "A", formula: "B + 1" }, { name: "B", formula: "A * 2" }], {})).toThrow(/Circular/);
  });
});
