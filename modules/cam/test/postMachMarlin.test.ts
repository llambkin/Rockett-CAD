import { describe, expect, it } from "vitest";
import { validatePost, type Post } from "../src/post/schema.js";
import type { Move, Program } from "../src/shared/ir.js";
import {
  fixture,
  fixtures,
  format,
  golden,
  lines,
  loadPost,
} from "./goldens.js";

const mach = loadPost("mach");
const commands = (line: string) =>
  line.split(" ").filter((word) => /^[GMT]\d/.test(word));
const marlin = loadPost("marlin");

function withComments(texts: string[]): Program {
  const facing = fixture("facing");
  const comments = texts.map((text): Move => ({ kind: "comment", text }));
  return {
    ...facing,
    sections: facing.sections.map((section) => ({
      ...section,
      moves: [...comments, ...section.moves],
    })),
  };
}

function dwelling(): Program {
  const program = fixture("drill");
  const spot = program.sections[0]!.moves[2]!;
  if (spot.kind === "cycle") spot.dwell = 1;
  program.sections[1]!.moves.push({ kind: "dwell", seconds: 0.5 });
  return program;
}

function matchesGoldens(post: Post) {
  for (const name of fixtures) {
    const out = format(post, fixture(name));
    expect(out).toEqual(golden(post, name, out.length));
  }
}

describe("Mach3 and Mach4 post", () => {
  const files = (name: string) => format(mach, fixture(name));

  it("is a valid post that matches the goldens byte for byte", () => {
    expect(validatePost(mach)).toEqual([]);
    matchesGoldens(mach);
  });

  it("keeps Mach rules", () => {
    const all = fixtures.flatMap(files);
    expect(all).toHaveLength(fixtures.length);
    for (const file of all) {
      expect(file).toMatch(/^G80\nG90 G94 G91\.1 G17 G40 G49 G21\nG54\n/);
      expect(file).toMatch(/\nM30\n$/);
    }
    const out = lines(all);
    expect(out.filter((l) => (l.match(/\bM\d/g) ?? []).length > 1)).toEqual([]);
    const drill = lines(files("drill"));
    for (const tool of [1, 2])
      expect(drill.slice(drill.indexOf(`T${tool} M6`))[1]).toBe(`G43 H${tool}`);
    expect(drill.slice(3).filter((l) => /^G99|^G80|^[XY]/.test(l))).toEqual([
      "G99 G81 X10 Y10 Z-1.5 R2 F150",
      "X30",
      "Y25",
      "G80",
      "G99 G83 X10 Y10 Z-12 R2 Q4 F200",
      "X30 Q4",
      "Y25 Q4",
      "G80",
    ]);
  });

  it("writes every dwell P with a decimal point", () => {
    const out = lines(format(mach, dwelling()));
    expect(out).toContain("G99 G82 X10 Y10 Z-1.5 R2 P1.000 F150");
    expect(out).toContain("G4 P0.500");
    expect(out.filter((l) => /\bP\d+(?!\.)\b/.test(l))).toEqual([]);
  });

  it("keeps hostile comment text inside one closed comment", () => {
    const hostile = ["MSG, pwned", "a) M30 (b", "x; M3 S9", "#3000=1"];
    const out = lines(format(mach, withComments(hostile)));
    const comments = out.filter((l) => l.includes("("));
    expect(comments).toEqual([
      "(MSG, pwned)",
      "(a M30 b)",
      "(x M3 S9)",
      "(#3000=1)",
      "(Face 60 x 40 by 0.5 mm)",
    ]);
    expect(out.filter((l) => /[;)].|\(.*\(/.test(l))).toEqual([]);
  });
});

describe("Marlin post", () => {
  const files = (name: string) => format(marlin, fixture(name));

  it("is a valid post that matches the goldens byte for byte", () => {
    expect(validatePost(marlin)).toEqual([]);
    matchesGoldens(marlin);
  });

  it("keeps Marlin rules", () => {
    const all = fixtures.flatMap(files);
    expect(files("drill")).toHaveLength(2);
    for (const file of all) {
      expect(file).toMatch(/^G90\nG21\nG54\n/);
      expect(file).toMatch(/\nM5\n(M9\n)?$/);
    }
    const out = lines(all).filter((l) => !l.startsWith("; "));
    expect(out.filter((l) => commands(l).length !== 1)).toEqual([]);
    expect(
      out.filter((l) => !/^(G[0-4]|G21|G54|G90|M[035789]) ?/.test(l)),
    ).toEqual([]);
    expect(out.filter((l) => /\bK|\bG1[789]\b|\bM30\b|\bT\d/.test(l))).toEqual(
      [],
    );
    expect(Math.max(...out.map((l) => l.length))).toBeLessThanOrEqual(95);
  });

  it("dwells in seconds with S and refuses what Marlin would ignore", () => {
    const out = lines(format(marlin, dwelling()));
    expect(out).toContain("G4 S0.5");
    expect(out.filter((l) => l.startsWith("G4 P"))).toEqual([]);
    expect(() => format(marlin, fixture("contour"), "inch")).toThrow(
      "line 2 is not in the marlin dialect: G20",
    );
    expect(() => format(marlin, fixture("drill"), "mm", true)).toThrow(
      "post marlin does not support tool changes",
    );
    expect(() =>
      format(marlin, { ...fixture("contour"), offsetIndex: 2 }),
    ).toThrow("post marlin has no work offset 2");
  });

  it("writes hostile comment text after a semicolon only", () => {
    const hostile = ["go (to Y20)", "M30 delete.gcode", "N5 G1 X9*42"];
    const out = lines(format(marlin, withComments(hostile)));
    expect(out.filter((l) => l.includes("("))).toEqual([]);
    expect(out.filter((l) => /Y20|M30|X9/.test(l))).toEqual([
      "; go to Y20",
      "; M30 delete.gcode",
      "; N5 G1 X9*42",
    ]);
  });
});
