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

const post = loadPost("linuxcnc");
const files = (name: string) => format(post, fixture(name));

const ACTIVE =
  /^(msg|debug|print|log|logopen|logappend|py|pyrun|abort),|^(logclose|pyreload)$|^probe(open|close)/i;

function active(line: string) {
  const inner = /\(([^)]*)\)/.exec(line)?.[1];
  return (
    line.startsWith(";py,") ||
    (inner !== undefined && ACTIVE.test(inner.trimStart()))
  );
}

describe("LinuxCNC post", () => {
  it("is a valid post", () => {
    expect(validatePost(post)).toEqual([]);
  });

  it("matches the goldens byte for byte", () => {
    for (const name of fixtures) {
      const out = files(name);
      expect(out).toEqual(golden(post, name, out.length));
    }
  });

  it("keeps LinuxCNC rules", () => {
    const all = fixtures.flatMap((name) => files(name));
    expect(all).toHaveLength(fixtures.length);
    for (const file of all) {
      expect(file).toMatch(/^G90 G94 G91\.1 G17 G40 G49 G80 G99 G21\nG54\n/);
      expect(file).toMatch(/\nM2\n$/);
    }
    const drill = lines(files("drill"));
    for (const tool of [1, 2])
      expect(drill.slice(drill.indexOf(`T${tool} M6`))[1]).toBe(`G43 H${tool}`);
    expect(drill.filter((l) => /^G8[013]\b/.test(l))).toEqual([
      "G81 X10 Y10 Z-1.5 R2 F150",
      "G80",
      "G83 X10 Y10 Z-12 R2 Q4 F200",
      "G80",
    ]);
  });
});

describe("LinuxCNC comments", () => {
  const hostile = [
    "MSG, pwned",
    "  debug, #<_x>",
    "PRINT,#5220",
    "PROBEOPEN probe.txt",
    "PROBECLOSE",
    "LOGOPEN,log.txt",
    "LOGAPPEND,log.txt",
    "LOG,x",
    "LOGCLOSE",
    "PY,import os",
    "pyrun,x",
    "PYRELOAD",
    "ABORT,stop",
    "(MSG, nested)",
    ";py,import os",
  ];

  it("detects the active forms it guards against", () => {
    expect(["(MSG, x)", "( logclose)", ";py,x"].map(active)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("writes hostile comment text as passive comments only", () => {
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
    expect(out.filter(active)).toEqual([]);
    expect(out.filter((l) => l.includes("("))).toEqual([]);
    expect(out.filter((l) => /^;py|^;[^ ]/.test(l))).toEqual([]);
    expect(out).toContain("; MSG, pwned");
    expect(out).toContain("; py,import os");
  });
});
