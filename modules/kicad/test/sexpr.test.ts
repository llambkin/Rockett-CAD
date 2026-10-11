import { describe, expect, it } from "vitest";
import {
  child,
  children,
  num,
  parseSexpr,
  SEXPR_LIMITS,
  SexprError,
  str,
  type Sexpr,
  type SexprList,
} from "../src/sexpr.js";

const print = (tree: Sexpr): string =>
  typeof tree === "string" ? tree : `(${tree.map(print).join(" ")})`;

function refusal(text: string, line: number, column: number) {
  try {
    parseSexpr(text);
    expect.fail("Malformed input was accepted");
  } catch (error) {
    expect(error).toBeInstanceOf(SexprError);
    expect(error).toMatchObject({ kind: "syntax", line, column });
    expect((error as Error).message).toContain(`${line}:${column}`);
  }
}

describe("KiCad S-expressions", () => {
  it("keeps number spelling, unknown tokens and quoted source intact", () => {
    const text =
      "(kicad_pcb (version 20241229) (at +01.000 -0 1e-3) (future_token | a/b ${KIPRJMOD}/x) (name " +
      String.raw`"a\"b\\c"` +
      "))";
    const tree = parseSexpr(text);
    expect(tree).toEqual([
      "kicad_pcb",
      ["version", "20241229"],
      ["at", "+01.000", "-0", "1e-3"],
      ["future_token", "|", "a/b", "${KIPRJMOD}/x"],
      ["name", String.raw`"a\"b\\c"`],
    ]);
    expect(parseSexpr(print(tree))).toEqual(tree);
    expect(text).toContain("+01.000");
  });

  it("finds immediate children and converts only requested atoms", () => {
    const tree = parseSexpr(
      '(board (at +01.000 -0 .5) (item "one") (nested (item "hidden")) (item two))',
    );
    expect(children(tree, "item").map((item) => str(item))).toEqual([
      "one",
      "two",
    ]);
    expect(child(tree, "nested")).toEqual(["nested", ["item", '"hidden"']]);
    expect(num(child(tree, "at"))).toBe(1);
    expect(num(child(tree, "at"), 2)).toBe(-0);
    expect(num(child(tree, "at"), 3)).toBe(0.5);
    expect(child(tree, "missing")).toBeUndefined();
    expect(children(undefined, "item")).toEqual([]);
    expect(str(undefined)).toBeUndefined();
    expect(str(tree, 1)).toBeUndefined();
    for (const value of ["0x10", "Infinity", "NaN", "1mm", '"12"', "1e9999"])
      expect(num(["value", value])).toBeUndefined();
  });

  it("decodes KiCad escaped strings without JSON escape assumptions", () => {
    const raw = String.raw`"\a\b\f\n\r\t\v\x41\101\"\\\q\xZ"`;
    expect(str(parseSexpr(`(text ${raw})`))).toBe('\x07\b\f\n\r\t\vAA"\\\\qxZ');
    expect(parseSexpr(`(text ${raw})`)[1]).toBe(raw);
    expect(str(parseSexpr('(text "µ Ω 😀 (hello)")'))).toBe("µ Ω 😀 (hello)");
    expect(str(parseSexpr(String.raw`(text "\xc3\xa9 \303\251 \\x41")`))).toBe(
      "é é \\x41",
    );
  });

  it("handles ASCII whitespace and line comments, preserving unknown hashes", () => {
    expect(
      parseSexpr("# header\r\n (root\t\0\n # another\n (value a#b))"),
    ).toEqual(["root", ["value", "a#b"]]);
    expect(parseSexpr("(root a|b)")).toEqual(["root", "a", "|", "b"]);
    expect(parseSexpr("()")).toEqual([]);
  });

  it.each([
    ["", 1, 1],
    ["atom", 1, 1],
    [")", 1, 1],
    ["(root))", 1, 7],
    ["(a) (b)", 1, 5],
    ["(root\n (value 1)", 2, 11],
    ['(root\n "unfinished)', 2, 2],
    ['(root "line\nbreak")', 1, 12],
    ['(root "slash\\', 1, 7],
  ] as const)("refuses %j with a typed location", refusal);

  it("prints and reparses deterministic random trees unchanged", () => {
    let seed = 0x5e7f012;
    const random = (bound: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % bound;
    };
    const atoms = [
      "root",
      "unknown_future",
      "+001.20",
      "-0",
      "1E-8",
      "a/b",
      "${KIPRJMOD}",
      '""',
      String.raw`"quote\"slash\\"`,
      String.raw`"\n\x41\101\q"`,
      '"µ Ω 😀"',
      "|",
    ];
    const generate = (depth: number): Sexpr => {
      if (depth === 0 || random(3) === 0) return atoms[random(atoms.length)]!;
      return Array.from({ length: random(6) }, () => generate(depth - 1));
    };
    for (let i = 0; i < 500; i++) {
      const tree: SexprList = [generate(6), generate(6)];
      expect(parseSexpr(print(tree))).toEqual(tree);
    }
  });

  it("bounds bytes, tokens and nesting recoverably before overflow", () => {
    expect(() => parseSexpr(" ".repeat(SEXPR_LIMITS.bytes + 1))).toThrow(
      SexprError,
    );
    expect(() => parseSexpr("😀".repeat(SEXPR_LIMITS.bytes / 4 + 1))).toThrow(
      /input.*large/i,
    );
    expect(() => parseSexpr(`(${"a ".repeat(SEXPR_LIMITS.tokens)})`)).toThrow(
      /tokens/i,
    );
    expect(() => parseSexpr("(".repeat(SEXPR_LIMITS.depth + 1))).toThrow(
      /nesting/i,
    );
    const atDepth =
      "(".repeat(SEXPR_LIMITS.depth) + ")".repeat(SEXPR_LIMITS.depth);
    expect(parseSexpr(atDepth)).toHaveLength(1);
    for (const text of [
      " ".repeat(SEXPR_LIMITS.bytes + 1),
      "(".repeat(SEXPR_LIMITS.depth + 1),
    ]) {
      try {
        parseSexpr(text);
        expect.fail("Oversized input was accepted");
      } catch (error) {
        expect(error).toMatchObject({ kind: "limit" });
      }
    }
  });
});
