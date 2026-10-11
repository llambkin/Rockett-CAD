import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importLinuxcnc } from "../src/import/linuxcnc.js";

const table = readFileSync(
  new URL("fixtures/tools/tool.tbl", import.meta.url),
  "utf8",
);

const made = {
  fluteLength: 20,
  overallLength: 50,
  shankDiameter: 6,
  flutes: 2,
  centreCutting: true,
};

describe("LinuxCNC tool.tbl", () => {
  it("lists a line without D as rejected", () => {
    expect(importLinuxcnc("T3 P3 Z+1.0 ;no diameter\n", "mm", "flat")).toEqual({
      tools: [],
      presets: [],
      rejects: [{ item: "Line 1", reason: "has no diameter D" }],
    });
  });

  it("makes a tool from T, D and the comment in the units and kind given", () => {
    const result = importLinuxcnc(table, "inch", "flat");
    expect(result.tools).toEqual([
      {
        ...made,
        id: expect.any(String),
        name: "1/4 flat end mill",
        kind: "flat",
        diameter: expect.closeTo(6.35, 12),
      },
      {
        ...made,
        id: expect.any(String),
        name: "1/8 flat end mill",
        kind: "flat",
        diameter: expect.closeTo(3.175, 12),
      },
      {
        ...made,
        id: expect.any(String),
        name: "T4",
        kind: "flat",
        diameter: expect.closeTo(12.7, 12),
      },
    ]);
    expect(new Set(result.tools.map((tool) => tool.id)).size).toBe(3);
    expect(result.presets).toEqual([]);
  });

  it("lists each malformed line with its reason", () => {
    expect(importLinuxcnc(table, "inch", "flat").rejects).toEqual([
      { item: "Line 4", reason: "has no diameter D" },
      { item: "Line 6", reason: "T1 appears twice" },
      { item: "Line 7", reason: "diameter must be greater than 0" },
      { item: "Line 8", reason: "Dabc is not a tool table word" },
      { item: "Line 9", reason: "K5 is not a tool table word" },
      { item: "Line 10", reason: "T-9 is not a tool number" },
      { item: "Line 11", reason: "has no tool number T" },
    ]);
  });

  it("keeps mm as given and applies the kind's own fields", () => {
    const result = importLinuxcnc(
      "T1 P1 D6 ;bull\nT2 P2 D1 ;tiny bull\nT3 P3 D6 D7\n",
      "mm",
      "bull",
    );
    expect(result.tools).toEqual([
      {
        ...made,
        id: expect.any(String),
        name: "bull",
        kind: "bull",
        diameter: 6,
        cornerRadius: 1,
      },
    ]);
    expect(result.rejects).toEqual([
      {
        item: "Line 2",
        reason: "corner radius must be between 0 and half the diameter",
      },
      { item: "Line 3", reason: "D appears twice" },
    ]);
  });

  it("reads a table of only comments and blank lines as empty", () => {
    expect(importLinuxcnc(";remark\n\n  \n", "mm", "vbit")).toEqual({
      tools: [],
      presets: [],
      rejects: [],
    });
  });
});
