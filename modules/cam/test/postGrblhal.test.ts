import { describe, expect, it } from "vitest";
import { validatePost } from "../src/post/schema.js";
import {
  fixture,
  fixtures,
  format,
  golden,
  lines,
  loadPost,
} from "./goldens.js";

const post = loadPost("grblhal");
const files = (name: string, toolChange?: boolean) =>
  format(post, fixture(name), "mm", toolChange);

describe("grblHAL post", () => {
  it("validates the dialect and matches four fixture goldens", () => {
    expect(validatePost(post)).toEqual([]);
    for (const name of fixtures) {
      const out = files(name, true);
      expect(out).toEqual(golden(post, name, out.length));
    }
  });

  it("requires configured tool change for T then M6", () => {
    const configured = files("drill", true);
    expect(configured).toHaveLength(1);
    expect(lines(configured).filter((line) => /\bM6\b/.test(line))).toEqual([
      "T1 M6",
      "T2 M6",
    ]);
    const unconfigured = files("drill");
    expect(unconfigured).toHaveLength(2);
    expect(
      lines(unconfigured).filter((line) => /\bM6\b|\bT\d/.test(line)),
    ).toEqual([]);
    expect(files("facing")).toHaveLength(1);
  });

  it("emits incremental arcs and G81 through G83 cycles", () => {
    const contour = lines(files("contour", true));
    expect(
      contour
        .filter((line) => /\bG[23]\b/.test(line))
        .every((line) => / I\S+ J\S+/.test(line)),
    ).toBe(true);
    const drill = lines(files("drill", true));
    expect(drill).toContain("G81 X10 Y10 Z-1.5 R2 F150");
    expect(drill).toContain("G83 X10 Y10 Z-12 R2 Q4 F200");
    expect(drill.filter((line) => line === "G80")).toHaveLength(2);
    const program = fixture("drill");
    const first = program.sections[0]!.moves.find(
      (move) => move.kind === "cycle",
    );
    if (!first || first.kind !== "cycle")
      throw new Error("drill cycle missing");
    first.dwell = 0.5;
    const dwelled = lines(format(post, program));
    expect(dwelled).toContain("G82 X10 Y10 Z-1.5 R2 P0.5 F150");
  });
});
