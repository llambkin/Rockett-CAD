import { describe, expect, it } from "vitest";
import { validatePost } from "../src/post/schema.js";
import { validateProgram, type Program } from "../src/shared/ir.js";
import {
  fixture,
  fixtures,
  format,
  golden,
  lines,
  loadPost,
} from "./goldens.js";

const post = loadPost("grbl");

const rest: Program = {
  ...fixture("contour"),
  offsetIndex: 6,
  sections: [
    {
      operationId: "words-1",
      toolId: "t1",
      pass: "finish",
      spindle: { rpm: 10000, dir: "ccw" },
      coolant: "mist",
      moves: [
        { kind: "comment", text: "Words the fixtures do not reach" },
        { kind: "rapid", to: [0, 0, 15] },
        { kind: "rapid", to: [0, 0, 2] },
        { kind: "feed", to: [0, 0, -1], feed: 100, role: "plunge" },
        {
          kind: "arc",
          to: [2, 0, 1],
          centre: [0, 0, 1],
          dir: "cw",
          plane: "zx",
          feed: 200,
          role: "cut",
        },
        {
          kind: "arc",
          to: [2, 2, -1],
          centre: [2, 0, -1],
          dir: "ccw",
          plane: "yz",
          feed: 200,
          role: "cut",
        },
        { kind: "dwell", seconds: 0.5 },
        { kind: "stop", optional: true },
        { kind: "stop", optional: false },
        { kind: "rapid", to: [2, 2, 15] },
      ],
    },
  ],
};

const outputs = (): [string[], string[]][] => [
  ...fixtures.flatMap((name) => {
    const out = format(post, fixture(name));
    return [[out, golden(post, name, out.length)]] as [string[], string[]][];
  }),
  [format(post, fixture("contour"), "inch"), golden(post, "contour-inch", 1)],
  [format(post, rest), golden(post, "qualified", 1)],
];

describe("GRBL 1.1 post qualified for DEC-610", () => {
  it("is a valid post over a valid program", () => {
    expect(validatePost(post)).toEqual([]);
    expect(validateProgram(rest)).toEqual([]);
  });

  it("matches the goldens byte for byte", () => {
    for (const [out, expected] of outputs()) expect(out).toEqual(expected);
  });

  it("reaches every word it may emit in a golden", () => {
    const emitted = new Set(
      lines(outputs().flatMap(([out]) => out))
        .filter((line) => !line.startsWith("("))
        .flatMap((line) => line.split(" ")),
    );
    expect(post.workOffsets).toEqual([
      "G54",
      "G55",
      "G56",
      "G57",
      "G58",
      "G59",
    ]);
    expect(
      post.words.filter(
        (word) => !emitted.has(word) && !post.workOffsets.includes(word),
      ),
    ).toEqual([]);
    expect(
      [...emitted].filter((word) => /^(G8\d|G43|G90\.1|M6|T\d+)$/.test(word)),
    ).toEqual([]);
  });
});
