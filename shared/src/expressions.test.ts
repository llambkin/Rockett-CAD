import { describe, expect, it } from "vitest";
import {
  evaluateExpression,
  ExpressionError,
  type Scalar,
} from "./expressions.js";

const width: Scalar = { value: 40, dimension: "length" };

function refuses(text: string, code: ExpressionError["code"], inputs = {}) {
  try {
    evaluateExpression(text, inputs);
    expect.fail(`Accepted ${text.slice(0, 80)}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ExpressionError);
    expect((error as ExpressionError).code).toBe(code);
  }
}

describe("scalar expressions", () => {
  it("resolves named lengths without changing the inputs", () => {
    const inputs = Object.freeze({ width: Object.freeze(width) });
    expect(evaluateExpression("width / 2", inputs)).toEqual({
      value: 20,
      dimension: "length",
    });
    expect(evaluateExpression("width / 10mm", inputs)).toEqual({
      value: 4,
      dimension: "unitless",
    });
    expect(inputs.width).toEqual({ value: 40, dimension: "length" });
  });

  it("obeys precedence, brackets, unary signs and right associative powers", () => {
    for (const [text, value] of [
      ["2 + 3 * 4", 14],
      ["(2 + 3) * 4", 20],
      ["-2^2", -4],
      ["2^-2", 0.25],
      ["2^3^2", 512],
      ["--2 + +3", 5],
      ["1e2 + .5", 100.5],
      ["7 % 3", 1],
    ] as const)
      expect(evaluateExpression(text)).toEqual({
        value,
        dimension: "unitless",
      });
  });

  it("uses the existing length scales and converts angles to degrees", () => {
    const length = evaluateExpression("1in + 2.54cm + .0254m");
    expect(length.dimension).toBe("length");
    expect(length.value).toBeCloseTo(76.2, 12);
    expect(evaluateExpression("180deg + 90°")).toEqual({
      value: 270,
      dimension: "angle",
    });
    expect(evaluateExpression("3.141592653589793rad")).toEqual({
      value: 180,
      dimension: "angle",
    });
  });

  it("evaluates common functions with their dimensional rules", () => {
    for (const [text, value, dimension] of [
      ["abs(-2mm)", 2, "length"],
      ["min(width, 1in)", 25.4, "length"],
      ["max(1, 2, 3)", 3, "unitless"],
      ["round(2.4) + floor(2.9) + ceil(2.1)", 7, "unitless"],
      ["sqrt(9) + pow(2, 3)", 11, "unitless"],
      ["sin(90deg)", 1, "unitless"],
      ["cos(pi)", -1, "unitless"],
      ["tan(45deg)", 1, "unitless"],
      ["asin(1)", 90, "angle"],
      ["acos(0)", 90, "angle"],
      ["atan(1)", 45, "angle"],
      ["atan2(1mm, 1mm)", 45, "angle"],
    ] as const) {
      const result = evaluateExpression(text, { width });
      expect(result.dimension).toBe(dimension);
      expect(result.value).toBeCloseTo(value);
    }
    expect(evaluateExpression("sqrt(16) + 2")).toEqual({
      value: 6,
      dimension: "unitless",
    });
  });

  it("preserves arithmetic and dimensions across generated finite inputs", () => {
    for (let a = -12; a <= 12; a++) {
      for (let b = 1; b <= 8; b++) {
        const result = evaluateExpression(`(a + ${b}mm) / ${b}`, {
          a: { value: a, dimension: "length" },
        });
        expect(result.dimension).toBe("length");
        expect(result.value).toBeCloseTo((a + b) / b, 12);
        const count = evaluateExpression(`(${a} + ${b}) * ${b}`);
        expect(count).toEqual({ value: (a + b) * b, dimension: "unitless" });
        refuses(`${a}mm + ${b}deg`, "dimension");
      }
    }
  });

  it("reports unknown names and never reads inherited properties", () => {
    for (const text of [
      "missing",
      "constructor",
      "toString",
      "__proto__",
      "unknown(1)",
    ])
      refuses(text, "name");
    refuses("width", "name", Object.create({ width }));
  });

  it("rejects incompatible dimensions", () => {
    for (const text of [
      "1mm + 1",
      "1deg - 1mm",
      "1mm * 2mm",
      "1 / 1mm",
      "1deg / 1mm",
      "1mm ^ 2",
      "2 ^ 1deg",
      "sqrt(4mm)",
      "sin(1mm)",
      "asin(1deg)",
      "min(1mm, 1)",
      "atan2(1mm, 1deg)",
    ])
      refuses(text, "dimension");
  });

  it("rejects malformed syntax and executable input", () => {
    for (const text of [
      "",
      " ",
      "1 +",
      "(1",
      "1)",
      "1 2",
      "1ft",
      "min()",
      "sin(1,2)",
      "min(1,)",
      "[1]",
      "globalThis.process.exit()",
      "(()=>1)()",
      "1;2",
      "width.value",
      "Math.sin(1)",
      "1/*x*/+2",
      "1e+",
    ])
      refuses(text, "syntax");
  });

  it("rejects zero division and nonfinite arithmetic or named inputs", () => {
    for (const text of [
      "1/0",
      "0/0",
      "1%0",
      "1e999",
      "1e308*1e308",
      "sqrt(-1)",
      "pow(-1,.5)",
      "asin(2)",
      "2^1024",
    ])
      refuses(text, "arithmetic");
    for (const value of [NaN, Infinity, -Infinity])
      refuses("bad", "arithmetic", { bad: { value, dimension: "unitless" } });
  });

  it("bounds bytes, tokens, nesting and unary or power recursion recoverably", () => {
    for (const text of [
      " ".repeat(65537),
      "1+".repeat(8192) + "1",
      "(".repeat(129) + "1" + ")".repeat(129),
      "-".repeat(129) + "1",
      "2^".repeat(129) + "1",
      "é".repeat(32769),
    ])
      refuses(text, "limit");
    expect(
      evaluateExpression("(".repeat(30) + "1" + ")".repeat(30)).value,
    ).toBe(1);
    expect(evaluateExpression("1+".repeat(1000) + "1").value).toBe(1001);
  });
});
