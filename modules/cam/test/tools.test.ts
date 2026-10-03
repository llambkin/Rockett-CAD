import { describe, expect, it } from "vitest";
import {
  validatePreset,
  validateTool,
  type Preset,
  type Tool,
} from "../src/shared/tools.js";

const common = {
  id: "t1",
  name: "6 mm",
  diameter: 6,
  fluteLength: 20,
  overallLength: 50,
  shankDiameter: 6,
  flutes: 2,
  centreCutting: true,
};

const tools: Tool[] = [
  { ...common, kind: "flat" },
  { ...common, kind: "ball" },
  { ...common, kind: "bull", cornerRadius: 3 },
  { ...common, kind: "vbit", tipAngle: 60 },
  { ...common, kind: "drill", tipAngle: 118 },
  { ...common, kind: "chamfer", tipAngle: 90 },
];

const preset: Preset = {
  id: "p1",
  name: "MDF rough",
  rpm: 18000,
  cutFeed: 1800,
  plungeFeed: 600,
  rampFeed: 900,
  stepdown: 3,
  stepoverFraction: 0.4,
  coolant: "off",
};

describe("validateTool", () => {
  it("accepts every kind", () => {
    expect(tools.map(validateTool)).toEqual(tools.map(() => []));
  });

  it.each([0, -1, Number.NaN])("rejects a diameter of %s", (diameter) => {
    expect(validateTool({ ...common, kind: "flat", diameter })).toEqual([
      "diameter must be greater than 0",
    ]);
  });

  it.each([3.001, -0.1])("rejects a corner radius of %s on 6 mm", (r) => {
    expect(validateTool({ ...common, kind: "bull", cornerRadius: r })).toEqual([
      "corner radius must be between 0 and half the diameter",
    ]);
  });
});

describe("validatePreset", () => {
  it("accepts a preset with positive feeds", () => {
    expect(validatePreset(preset)).toEqual([]);
  });

  it.each(["cutFeed", "plungeFeed", "rampFeed"] as const)(
    "rejects %s of 0 or less",
    (key) => {
      expect(validatePreset({ ...preset, [key]: 0 })).toEqual([
        `${key} must be greater than 0`,
      ]);
      expect(validatePreset({ ...preset, [key]: -5 })).toEqual([
        `${key} must be greater than 0`,
      ]);
    },
  );
});
