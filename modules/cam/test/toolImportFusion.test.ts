import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importFusion } from "../src/import/fusion.js";

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/tools/${name}`, import.meta.url), "utf8");

const mm = importFusion(fixture("fusion-mm.json"));
const inch = importFusion(fixture("fusion-inch.json"));

const library = (data: unknown[]) => JSON.stringify({ data, version: 36 });

const refused = (reason: string) => ({
  tools: [],
  presets: [],
  rejects: [{ item: "File", reason }],
  numbers: {},
});

function expectClose(actual: unknown, expected: unknown, path = "") {
  if (typeof expected === "number")
    return void expect(
      Math.abs((actual as number) - expected),
      path,
    ).toBeLessThanOrEqual(1e-6);
  if (typeof expected !== "object" || expected === null)
    return void expect(actual, path).toBe(expected);
  expect(new Set(Object.keys(actual as object)), path).toEqual(
    new Set(Object.keys(expected)),
  );
  for (const [key, value] of Object.entries(expected))
    expectClose(
      (actual as Record<string, unknown>)[key],
      value,
      `${path}.${key}`,
    );
}

describe("Fusion tool library JSON", () => {
  it("rejects a face mill and a holder by name", () => {
    expect(mm.rejects).toEqual(
      expect.arrayContaining([
        {
          item: "2 in face mill",
          reason: 'type "face mill" is not a tool type Rockett imports',
        },
        {
          item: "ER20 collet holder",
          reason: 'type "holder" is not a tool type Rockett imports',
        },
      ]),
    );
    expect(mm.tools.map((tool) => tool.name)).not.toContain("2 in face mill");
  });

  it("reads mm and inch fixtures within 1e-6 mm of each other", () => {
    expect(inch.tools).toHaveLength(5);
    expect(inch.presets).toHaveLength(3);
    expectClose(inch, mm);
  });

  it("maps each kind, its numbers and its presets", () => {
    const [flat, ball, bull, chamfer, drill] = mm.tools;
    expect(flat).toEqual({
      id: "5b0d2c1e-0001-4a00-8000-000000000001",
      name: "1/4 in flat",
      kind: "flat",
      diameter: 6.35,
      fluteLength: 19.05,
      overallLength: 63.5,
      shankDiameter: 6.35,
      flutes: 2,
      centreCutting: true,
    });
    expect(ball).toMatchObject({ kind: "ball", diameter: 3.175 });
    expect(bull).toMatchObject({ kind: "bull", cornerRadius: 1.5875 });
    expect(chamfer).toMatchObject({ kind: "chamfer", tipAngle: 90 });
    expect(drill).toMatchObject({ kind: "drill", tipAngle: 118 });
    expect(Object.values(mm.numbers)).toEqual([1, 2, 3, 4, 5]);
    expect(mm.numbers[flat!.id]).toBe(1);

    const [mdf, walnut, aluminium] = mm.presets;
    expect(mdf).toEqual({
      id: "5b0d2c1e-0101-4a00-8000-000000000001",
      name: "1/4 in flat: MDF",
      rpm: 18000,
      cutFeed: 2540,
      plungeFeed: 762,
      rampFeed: 1270,
      stepdown: 3.175,
      stepoverFraction: expect.closeTo(0.4, 9),
      coolant: "off",
    });
    expect(walnut).toMatchObject({ rampFeed: 508, coolant: "mist" });
    expect(aluminium).toMatchObject({ rampFeed: 952.5, coolant: "flood" });
    expect(mm.rejects).toContainEqual({
      item: "1/4 in drill: No stepdown",
      reason: "must have required properties stepdown, stepoverFraction",
    });
  });

  it("refuses a file that is not a Fusion library and an unknown unit", () => {
    expect(importFusion("{data")).toEqual(refused("is not JSON"));
    expect(importFusion(JSON.stringify({ tools: [] }))).toEqual(
      refused("is not a Fusion tool library"),
    );
    const flat = JSON.parse(fixture("fusion-mm.json")).data[0];
    expect(
      importFusion(library([{ ...flat, unit: "feet" }, 7])).rejects,
    ).toEqual([
      {
        item: "1/4 in flat",
        reason: 'unit "feet" is not millimeters or inches',
      },
      { item: "Tool 2", reason: "must be object" },
    ]);
  });
});

describe("Fusion entries Rockett cannot represent", () => {
  const [flat, , , chamfer] = JSON.parse(fixture("fusion-mm.json")).data;
  const [mdf] = flat["start-values"].presets;
  const withPreset = (preset: object) => ({
    ...flat,
    "start-values": { presets: [{ ...mdf, ...preset }] },
  });
  const read = (...data: unknown[]) => importFusion(library(data));

  it("maps disabled, flood and mist and rejects other coolant by name", () => {
    const coolant = (mode: unknown) =>
      read(withPreset({ "tool-coolant": mode }));
    expect(coolant("disabled").presets[0]?.coolant).toBe("off");
    expect(coolant("flood").presets[0]?.coolant).toBe("flood");
    expect(coolant("mist").presets[0]?.coolant).toBe("mist");
    for (const mode of [
      "flood mist",
      "flood tool",
      "tool",
      "air",
      "air through tool",
      "suction",
      undefined,
    ])
      expect(coolant(mode)).toMatchObject({
        presets: [],
        rejects: [
          {
            item: "1/4 in flat: MDF",
            reason: `tool-coolant ${JSON.stringify(mode)} is not a coolant Rockett imports`,
          },
        ],
      });
  });

  it("rejects a chamfer mill with a flat tip and its presets", () => {
    const result = read({
      ...chamfer,
      geometry: { ...chamfer.geometry, "tip-diameter": 2 },
      "start-values": flat["start-values"],
    });
    expect(result).toEqual({
      tools: [],
      presets: [],
      rejects: [
        {
          item: "1/2 in 90 degree chamfer",
          reason:
            "tip-diameter 2 is above 0; Rockett chamfer mills come to a point",
        },
      ],
      numbers: {},
    });
    expect(
      read({ ...chamfer, geometry: { ...chamfer.geometry, "tip-diameter": 0 } })
        .tools,
    ).toHaveLength(1);
  });

  it("treats use-stepdown or use-stepover false as missing", () => {
    expect(read(withPreset({ "use-stepdown": false })).rejects).toEqual([
      {
        item: "1/4 in flat: MDF",
        reason: "must have required properties stepdown",
      },
    ]);
    expect(read(withPreset({ "use-stepover": false })).rejects).toEqual([
      {
        item: "1/4 in flat: MDF",
        reason: "must have required properties stepoverFraction",
      },
    ]);
  });

  it("drops the presets of a tool rejected for its geometry", () => {
    const result = read({
      ...flat,
      geometry: { ...flat.geometry, DC: 0 },
    });
    expect(result).toEqual({
      tools: [],
      presets: [],
      rejects: [
        { item: "1/4 in flat", reason: "diameter must be greater than 0" },
      ],
      numbers: {},
    });
  });

  it("rejects a preset with no name", () => {
    expect(read(withPreset({ name: "" }))).toMatchObject({
      tools: [{ name: "1/4 in flat" }],
      presets: [],
      rejects: [{ item: "1/4 in flat: Preset 1", reason: "has no name" }],
    });
  });
});
