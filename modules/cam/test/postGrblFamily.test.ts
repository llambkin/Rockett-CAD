import { describe, expect, it } from "vitest";
import { validatePost } from "../src/post/schema.js";
import type { Move, Program } from "../src/shared/ir.js";
import {
  fixture,
  fixtures,
  format,
  golden,
  lines,
  loadPost,
} from "./goldens.js";

const post = loadPost("fluidnc");
const files = (name: string, toolChange?: boolean) =>
  format(post, fixture(name), "mm", toolChange);
const isToolWord = (line: string) => /\bM6\b|\bT\d/.test(line);

describe("FluidNC post", () => {
  it("is a valid post", () => {
    expect(validatePost(post)).toEqual([]);
  });

  it("matches the goldens byte for byte with and without tool change", () => {
    for (const name of fixtures) {
      const out = files(name, true);
      expect(out).toEqual(golden(post, name, out.length));
    }
    expect(files("drill")).toEqual(golden(post, "drill-files", 2));
    const off = lines(fixtures.flatMap((name) => files(name)));
    expect(off.filter(isToolWord)).toEqual([]);
  });

  it("keeps FluidNC rules", () => {
    const all = fixtures.flatMap((name) => files(name, true));
    expect(all).toHaveLength(fixtures.length);
    for (const file of all) {
      expect(file).toMatch(/^G90 G94 G91\.1 G17 G21\nG54\n/);
      expect(file).toMatch(/\nM30\n$/);
    }
    const out = lines(all);
    expect(
      out.filter((l) => /\bG8\d|\bG9[89]\b|\bG43\b|\bH\d|\bG90\.1/.test(l)),
    ).toEqual([]);
    expect(lines(files("drill", true)).filter(isToolWord)).toEqual([
      "T1 M6",
      "T2 M6",
    ]);
    expect(Math.max(...out.map((l) => l.length))).toBeLessThanOrEqual(127);
  });
});

describe("FluidNC comments", () => {
  const hostile = [
    "MSG,pwned",
    "tool xxMSG here",
    "PRINT,#<_x>",
    "debug,[1+1]",
    "(PRINT,#5220)",
    "M6 T9",
  ];

  it("writes hostile comment text after a semicolon only", () => {
    const facing = fixture("facing");
    const comments = hostile.map((text): Move => ({ kind: "comment", text }));
    const program: Program = {
      ...facing,
      sections: facing.sections.map((section) => ({
        ...section,
        moves: [...comments, ...section.moves],
      })),
    };
    const out = lines(format(post, program));
    expect(out.filter((l) => l.includes("("))).toEqual([]);
    expect(out.filter((l) => /MSG|PRINT|debug|M6 T9/.test(l))).toEqual([
      "; MSG,pwned",
      "; tool xxMSG here",
      "; PRINT,#<_x>",
      "; debug,[1+1]",
      "; PRINT,#5220",
      "; M6 T9",
    ]);
  });
});
