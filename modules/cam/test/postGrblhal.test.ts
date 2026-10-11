import { describe, expect, it } from "vitest";
import { formatProgram } from "../src/post/format.js";
import { normalise } from "../src/post/normalise.js";
import { validatePost, type Post } from "../src/post/schema.js";
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
const accelerated = (name: string, target: Post = post) =>
  formatProgram(
    normalise(fixture(name), target, {
      units: "mm",
      toolChange: target.capabilities.toolChange,
    }),
    target,
    { accelerationProfiles: true },
  );

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

  it("matches four acceleration profile goldens", () => {
    for (const name of fixtures) {
      const out = accelerated(name);
      expect(out).toEqual(golden(post, `${name}-accel`, out.length));
    }
  });

  it("switches to P3 before a finish pass enters stock and to P1 after it lifts", () => {
    const contour = lines(accelerated("contour"));
    const p3 = contour.indexOf("G187 P3");
    expect(contour.slice(p3 - 1, p3 + 2)).toEqual([
      "Z2",
      "G187 P3",
      "G1 Z-3 F300",
    ]);
    const p1 = contour.lastIndexOf("G187 P1");
    expect(p1).toBeGreaterThan(p3);
    expect(contour.slice(p1 - 1, p1 + 2)).toEqual([
      "G2 X-3 Y5 I0 J8",
      "G187 P1",
      "G0 Z15",
    ]);
    for (const name of fixtures) {
      const out = lines(accelerated(name));
      out.forEach((line, i) => {
        if (line === "G187 P3") expect(out[i + 1]).toMatch(/^G1 /);
        if (line === "G187 P1") expect(out[i + 1]).toMatch(/^G0 |^G8[123] /);
      });
    }
  });

  it("emits no G187 with the flag off or on a post without the template", () => {
    const grbl = loadPost("grbl");
    for (const name of fixtures) {
      expect(lines(files(name, true)).join("\n")).not.toMatch(/G187/);
      expect(lines(accelerated(name, grbl)).join("\n")).not.toMatch(/G187/);
    }
  });
});
