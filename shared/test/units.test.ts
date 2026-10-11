import { describe, expect, it } from "vitest";
import {
  UNIT_TO_MM,
  ANGLE_TO_DEGREES,
  formatAngle,
  formatLength,
  fromMm,
  parseLength,
  toMm,
  type Units,
} from "../src/units.js";

const UNITS = Object.keys(UNIT_TO_MM) as Units[];

describe("units", () => {
  it("converts angle units to the degree owner", () => {
    expect(ANGLE_TO_DEGREES.deg).toBe(1);
    expect(ANGLE_TO_DEGREES["°"]).toBe(1);
    expect(Math.PI * ANGLE_TO_DEGREES.rad).toBe(180);
  });

  it("converts inches to millimetres", () => {
    expect(toMm(1, "in")).toBe(25.4);
  });

  it("round trips every unit through millimetres", () => {
    for (const u of UNITS) {
      for (const x of [0, 1, -3.75, 123.456]) {
        expect(fromMm(toMm(x, u), u)).toBeCloseTo(x, 12);
      }
    }
  });

  it("formats lengths rounded to the given digits with the unit", () => {
    expect(formatLength(25.4, "in", 3)).toBe("1 in");
    expect(formatLength(1.23456, "mm", 3)).toBe("1.235 mm");
    expect(formatLength(-0.00001, "mm", 3)).toBe("0 mm");
  });

  it("formats angles in degrees", () => {
    expect(formatAngle(45, 3)).toBe("45°");
    expect(formatAngle(12.34567, 4)).toBe("12.3457°");
  });

  it("parses signed decimals and explicit length suffixes", () => {
    expect(parseLength("25.4mm", "in")).toBe(25.4);
    expect(parseLength("1in", "mm")).toBe(25.4);
    expect(parseLength("-.5 cm", "mm")).toBe(-5);
    expect(parseLength("+1. m", "in")).toBe(1000);
    expect(parseLength("2", "cm")).toBe(20);
  });

  it("rejects incomplete, unknown and overflowing input", () => {
    for (const text of [
      "",
      "-",
      ".",
      "1mm extra",
      "2ft",
      "1,2",
      "1e999",
      "Infinity",
    ])
      expect(parseLength(text, "mm")).toBeNull();
  });
});
