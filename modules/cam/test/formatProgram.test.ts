import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatProgram } from "../src/post/format.js";
import { normalise } from "../src/post/normalise.js";
import { validatePost, type Post } from "../src/post/schema.js";
import type { Move, Program, Section } from "../src/shared/ir.js";

const tool = {
  id: "t1",
  number: 1,
  name: "6 mm flat",
  kind: "flat" as const,
  diameter: 6,
  fluteLength: 20,
  overallLength: 50,
  shankDiameter: 6,
  flutes: 2,
  centreCutting: true,
};

const axis = { decimals: 3, trim: true };

const fake: Post = {
  id: "fake",
  label: "Fake",
  extension: "nc",
  capabilities: { arcs: true, cycles: true, toolChange: true },
  words: [
    "G0 G1 G2 G3 G4 G17 G18 G19 G20 G21 G43 G54 G55 G80 G81 G82 G83 G90",
    "M0 M1 M3 M4 M5 M6 M7 M8 M9 M30",
  ]
    .join(" ")
    .split(" "),
  formats: {
    X: axis,
    Y: axis,
    Z: axis,
    I: axis,
    J: axis,
    K: axis,
    R: axis,
    Q: axis,
    F: { decimals: 1, trim: true },
    S: { decimals: 0, trim: true },
    P: { decimals: 2, trim: true },
    T: { decimals: 0, trim: true },
    H: { decimals: 0, trim: true },
  },
  modal: [
    ["G0", "G1", "G2", "G3", "G80", "G81", "G82", "G83"],
    ["G17", "G18", "G19"],
    ["M3", "M4", "M5"],
    ["M7", "M8", "M9"],
    ..."XYZRQFS",
  ],
  workOffsets: ["G54", "G55"],
  templates: {
    header: ["G90 G17 {units}", "{offset}"],
    footer: ["M5", "M9", "M30"],
    toolChange: ["T{tool} M6"],
    toolLength: ["G43 H{tool}"],
    spindleCw: ["M3 S{rpm}"],
    spindleCcw: ["M4 S{rpm}"],
    spindleOff: ["M5"],
    coolantFlood: ["M8"],
    coolantMist: ["M7"],
    coolantOff: ["M9"],
    rapid: ["G0 X{x} Y{y} Z{z}"],
    linear: ["G1 X{x} Y{y} Z{z} F{feed}"],
    arcCw: ["{plane} G2 X{x} Y{y} Z{z} I{i} J{j} K{k} F{feed}"],
    arcCcw: ["{plane} G3 X{x} Y{y} Z{z} I{i} J{j} K{k} F{feed}"],
    drill: ["G81 X{x} Y{y} Z{bottom} R{clear} F{feed}"],
    drillDwell: ["G82 X{x} Y{y} Z{bottom} R{clear} P{dwell} F{feed}"],
    peck: ["G83 X{x} Y{y} Z{bottom} R{clear} Q{peck} F{feed}"],
    cycleEnd: ["G80"],
    dwell: ["G4 P{seconds}"],
    stop: ["M0"],
    optionalStop: ["M1"],
    comment: "({text})",
  },
};

const manual: Post = {
  ...fake,
  id: "manual",
  capabilities: { ...fake.capabilities, toolChange: false },
  templates: { ...fake.templates, toolChange: [], toolLength: [] },
};

function section(moves: Move[], toolId = "t1"): Section {
  return {
    operationId: "op1",
    toolId,
    pass: "rough",
    spindle: { rpm: 18000, dir: "cw" },
    coolant: "flood",
    moves,
  };
}

function program(sections: Section[], offsetIndex = 1): Program {
  return {
    irVersion: 1,
    units: "mm",
    setupId: "s1",
    offsetIndex,
    tools: [tool, { ...tool, id: "t2", number: 3 }],
    sections,
  };
}

function format(p: Program, post = fake, units: "mm" | "inch" = "mm") {
  return formatProgram(normalise(p, post, { units }), post, {});
}

function lines(text: string): string[] {
  return text.split("\n").slice(0, -1);
}

const header = ["G90 G17 G21", "G54"];
const footer = ["M5", "M9", "M30"];

describe("formatProgram", () => {
  it("interprets a minimal fake post with modal suppression", () => {
    const [file, ...rest] = format(
      program([
        section([
          { kind: "rapid", to: [0, 0, 5] },
          { kind: "rapid", to: [0, 0, 5] },
          { kind: "rapid", to: [10, 0, 5] },
          { kind: "feed", to: [10, 0, -1], feed: 300, role: "plunge" },
          { kind: "feed", to: [20, 0, -1], feed: 600, role: "cut" },
          { kind: "feed", to: [20, 5.5, -1], feed: 600, role: "cut" },
          {
            kind: "arc",
            to: [20, 5.5, -1],
            centre: [15, 5.5, -1],
            dir: "ccw",
            plane: "xy",
            feed: 600,
            role: "cut",
          },
          { kind: "dwell", seconds: 0.5 },
          { kind: "stop", optional: true },
          { kind: "rapid", to: [20, 5.5, -1] },
          { kind: "rapid", to: [20, 5.5, 5] },
        ]),
      ]),
    );
    expect(rest).toEqual([]);
    expect(lines(file!)).toEqual([
      ...header,
      "T1 M6",
      "G43 H1",
      "M3 S18000",
      "M8",
      "G0 X0 Y0 Z5",
      "X10",
      "G1 Z-1 F300",
      "X20 F600",
      "Y5.5",
      "G17 G3 X20 Y5.5 I-5 J0",
      "G4 P0.5",
      "M1",
      "G0 Z5",
      ...footer,
    ]);
  });

  it("prints an inch program unscaled after G20", () => {
    const p = program([
      section([
        { kind: "rapid", to: [25.4, 50.8, 12.7] },
        { kind: "feed", to: [25.4, 0, -2.54], feed: 254, role: "cut" },
      ]),
    ]);
    const moves = (units: "mm" | "inch") =>
      lines(format(p, fake, units)[0]!).filter((l) => /^G[01] /.test(l));
    expect(lines(format(p, fake, "inch")[0]!)[0]).toBe("G90 G17 G20");
    expect(moves("inch")).toEqual(["G0 X1 Y2 Z0.5", "G1 Y0 Z-0.1 F10"]);
    expect(lines(format(p)[0]!)[0]).toBe("G90 G17 G21");
    expect(moves("mm")).toEqual(["G0 X25.4 Y50.8 Z12.7", "G1 Y0 Z-2.54 F254"]);
  });

  it("derives tool changes from toolId and resets modal state after them", () => {
    const p = program([
      section([{ kind: "rapid", to: [0, 0, 5] }]),
      section([{ kind: "rapid", to: [0, 0, 5] }]),
      section([{ kind: "rapid", to: [0, 0, 5] }], "t2"),
    ]);
    const tail = ["M3 S18000", "M8", "G0 X0 Y0 Z5"];
    const change = (n: number) => [`T${n} M6`, `G43 H${n}`, ...tail];
    expect(format(p).map(lines)).toEqual([
      [...header, ...change(1), ...change(3), ...footer],
    ]);
    expect(format(p, manual).map(lines)).toEqual([
      [...header, ...tail, ...footer],
      [...header, ...tail, ...footer],
    ]);
  });

  it("writes cycles per point and resets modal state around them", () => {
    const text = format(
      program([
        section([
          { kind: "rapid", to: [0, 0, 10] },
          {
            kind: "cycle",
            cycle: "peck",
            points: [
              [5, 0],
              [5, 5],
            ],
            clear: 2,
            top: 0,
            bottom: -5,
            peck: 2,
            feed: 200,
          },
          { kind: "feed", to: [5, 5, -5], feed: 200, role: "cut" },
        ]),
      ]),
    )[0]!;
    expect(lines(text).slice(6, -3)).toEqual([
      "G0 X0 Y0 Z10",
      "G83 X5 Y0 Z-5 R2 Q2 F200",
      "Y5",
      "G80",
      "G1 X5 Y5 Z-5 F200",
    ]);
  });

  it("keeps the plane axes of an arc and selects its plane", () => {
    const text = format(
      program([
        section([
          { kind: "rapid", to: [0, 3, 10] },
          {
            kind: "arc",
            to: [0, 3, -10],
            centre: [0, 3, 0],
            dir: "cw",
            plane: "zx",
            feed: 600,
            role: "cut",
          },
        ]),
      ]),
    )[0]!;
    expect(lines(text)).toContain("G18 G2 X0 Z-10 I0 K-10 F600");
  });

  it("formats numbers per word and never prints a negative zero", () => {
    const fixed: Post = {
      ...fake,
      formats: { ...fake.formats, X: { decimals: 3, trim: false } },
    };
    const text = format(
      program([section([{ kind: "rapid", to: [-0.0001, -0.0001, 1] }])]),
      fixed,
    )[0]!;
    expect(lines(text)).toContain("G0 X0.000 Y0 Z1");
  });

  it("selects the work offset and rejects one the post lacks", () => {
    const p = (index: number) => program([section([])], index);
    expect(lines(format(p(2))[0]!)[1]).toBe("G55");
    expect(() => format(p(3))).toThrow("post fake has no work offset 3");
  });

  it("rejects a program normalised for another post", () => {
    const p = normalise(program([section([])]), manual, { units: "mm" });
    expect(() => formatProgram(p, fake, {})).toThrow(
      "program is normalised for post manual, not fake",
    );
  });

  it("bounds the output size", () => {
    const moves: Move[] = Array.from({ length: 50 }, (_, i) => ({
      kind: "rapid",
      to: [i, 0, 5],
    }));
    const p = program([section(moves)]);
    expect(format(p)[0]!.length).toBeGreaterThan(200);
    expect(() =>
      formatProgram(normalise(p, fake, { units: "mm" }), fake, {
        maxBytes: 200,
      }),
    ).toThrow("output is over 200 bytes");
  });
});

describe("formatProgram injection", () => {
  const hostile = "Pocket (1); M3\nS9)\r\nM30\n(é\u0000";

  it("keeps comments, names and ids from adding words", () => {
    for (const [post, comment] of [
      [fake, "(Pocket 1 M3 S9 M30)"],
      [
        { ...fake, templates: { ...fake.templates, comment: "; {text}" } },
        "; Pocket 1 M3 S9 M30",
      ],
    ] as const) {
      const p: Program = {
        ...program([
          {
            ...section([
              { kind: "rapid", to: [0, 0, 5] },
              { kind: "comment", text: hostile },
            ]),
            operationId: hostile,
          },
        ]),
        setupId: hostile,
      };
      p.tools[0] = { ...tool, name: hostile, id: "t1" };
      const out = lines(format(p, post)[0]!);
      expect(out.filter((l) => l.includes("Pocket"))).toEqual([comment]);
      expect(out.filter((l) => l.includes("M30"))).toEqual([comment, "M30"]);
      expect(out).toHaveLength(header.length + 5 + 1 + footer.length);
    }
  });

  it("checks raw lines against the post dialect and resets modal state", () => {
    const raw = (text: string) =>
      program([
        section([
          { kind: "rapid", to: [0, 0, 5] },
          { kind: "raw", post: "fake", text },
          { kind: "rapid", to: [1, 0, 5] },
        ]),
      ]);
    expect(lines(format(raw("M7\nM9"))[0]!).slice(6, -3)).toEqual([
      "G0 X0 Y0 Z5",
      "M7",
      "M9",
      "G0 X1 Y0 Z5",
    ]);
    expect(() => format(raw("M62 P1"))).toThrow(
      "line 8 is not in the fake dialect: M62 P1",
    );
    expect(() => format(raw("G0X1"))).toThrow(
      "line 8 is not in the fake dialect: G0X1",
    );
  });
});

describe("post schema", () => {
  it("accepts the fake post", () => {
    expect(validatePost(fake)).toEqual([]);
    expect(validatePost(JSON.parse(JSON.stringify(fake)))).toEqual([]);
  });

  it("names each invalid path with its accepted values", () => {
    const shape = {
      ...fake,
      extra: 1,
      capabilities: { ...fake.capabilities, arcs: "yes" },
      formats: { ...fake.formats, G: axis },
      templates: { ...fake.templates, comment: "{text}" },
    };
    expect(validatePost(shape)).toEqual([
      "extra: unknown key; accepted: id, label, extension, capabilities, toolChangeDefault, words, formats, modal, workOffsets, laser, templates",
      'capabilities.arcs: is not an accepted value; accepted: true, false or "xy"',
      "formats.G: unknown key; accepted: address letters other than G, M, N and O",
      'templates.comment: must match pattern "^(?:(\\()\\{text\\}\\)|(; ?)\\{text\\})$"; accepted: "({text})", ";{text}" or "; {text}"',
    ]);
    const bad = {
      ...fake,
      workOffsets: ["G59"],
      modal: [...fake.modal, "A", ["G0"]],
      templates: {
        ...fake.templates,
        header: ["G90 G17", "{offset}"],
        footer: ["M5 G999"],
        rapid: ["G0 X{x} Y{y} Z{z} F{feed}"],
        linear: ["G1 A{x} Y{y} Z{z} F{feed}"],
        dwell: ["G4  P{seconds}"],
        cycleEnd: [],
      },
    };
    const letters = Object.keys(fake.formats).join(", ");
    const inWords = "accepted: a word listed in words";
    expect(validatePost(bad)).toEqual([
      `modal[11]: A has no number format; accepted: a letter in formats (${letters})`,
      "modal[12]: G0 is already in a modal group; accepted: each word in one group",
      `workOffsets[0]: G59 is not in words; ${inWords}`,
      "templates.header: needs {units}",
      `templates.footer[0]: G999 is not in words; ${inWords}`,
      "templates.rapid[0]: {feed} is not a rapid variable; accepted: {x}, {y}, {z}",
      `templates.linear[0]: A has no number format; accepted: a letter in formats (${letters})`,
      "templates.cycleEnd: must not be empty when capabilities.cycles is true; accepted: at least one line, or capabilities.cycles false",
      'templates.dwell[0]: malformed token ""; accepted: a word in words, {units}, {offset}, {plane}, or a letter and a variable as X{x}, separated by single spaces',
    ]);
    expect(validatePost(null)).toEqual([
      "(top level): is not an object; accepted: a post object",
    ]);
  });
});

describe("post dialect limits", () => {
  const arcs = { needs: "X{x} Y{y} Z{z} I{i} J{j} F{feed}" };
  const xyOnly: Post = {
    ...fake,
    id: "xyonly",
    capabilities: { ...fake.capabilities, arcs: "xy" },
    words: fake.words.filter((w) => !["G17", "G18", "G19", "G20"].includes(w)),
    modal: fake.modal.filter((entry) => !entry.includes("G17")),
    templates: {
      ...fake.templates,
      header: ["G90 {units}", "{offset}"],
      arcCw: [`G2 ${arcs.needs}`],
      arcCcw: [`G3 ${arcs.needs}`],
    },
  };

  it("writes xy arcs with no plane word or K", () => {
    expect(validatePost(xyOnly)).toEqual([]);
    const text = format(
      program([
        section([
          { kind: "rapid", to: [10, 0, 0] },
          {
            kind: "arc",
            to: [0, 10, -1],
            centre: [0, 0, 0],
            dir: "ccw",
            plane: "xy",
            feed: 600,
            role: "cut",
          },
        ]),
      ]),
      xyOnly,
    )[0]!;
    expect(lines(text)).toContain("G3 X0 Y10 Z-1 I-10 J0 F600");
    expect(
      validatePost({ ...xyOnly, capabilities: fake.capabilities }),
    ).toEqual([
      "templates.arcCw: needs {k}",
      "templates.arcCw: needs {plane}",
      "templates.arcCcw: needs {k}",
      "templates.arcCcw: needs {plane}",
      "words: needs G17",
      "words: needs G18",
      "words: needs G19",
    ]);
  });

  it("rejects inch output on a post without G20", () => {
    const p = program([section([{ kind: "rapid", to: [25.4, 0, 5] }])]);
    expect(lines(format(p, xyOnly)[0]!)[0]).toBe("G90 G21");
    expect(() => format(p, xyOnly, "inch")).toThrow(
      "line 1 is not in the xyonly dialect: G90 G20",
    );
  });
});

describe("posts are data, never code", () => {
  const attempts = [
    "G0 X{constructor}",
    "G0 X{__proto__}",
    "G0 X{x.constructor}",
    "G0 X{globalThis.pwned=1}",
    "G0 X${process.exit(1)}",
    "G0 X{x} {toString}",
    "G0 X`{x}`",
  ];

  it("rejects a template that tries to execute code", () => {
    for (const attempt of attempts) {
      const post = {
        ...fake,
        templates: { ...fake.templates, rapid: [attempt] },
      };
      expect(validatePost(post).join("\n")).toMatch(/templates\.rapid\[0\]/);
      expect(() =>
        format(program([section([{ kind: "rapid", to: [1, 2, 3] }])]), post),
      ).toThrow(/templates\.rapid\[0\]/);
    }
    expect("pwned" in globalThis).toBe(false);
  });

  it("has no eval, Function or dynamic import in the post code", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "../src/post");
    const code = readdirSync(dir)
      .map((name) => readFileSync(join(dir, name), "utf8"))
      .join("\n");
    expect(code).not.toMatch(
      /\beval\b|\bFunction\b|\bimport\s*\(|\brequire\s*\(|\bwith\s*\(/,
    );
  });
});
