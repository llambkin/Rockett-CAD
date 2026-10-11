import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkProgram, type CheckInput } from "../src/post/check.js";
import { normalise } from "../src/post/normalise.js";
import {
  endOf,
  type Move,
  type Program,
  type Section,
  type Xyz,
} from "../src/shared/ir.js";
import { newMachine, type MachineProfile } from "../src/shared/machine.js";
import type { Fixture, Setup } from "../src/shared/setup.js";
import type { Preset, Tool } from "../src/shared/tools.js";
import { facing } from "../src/toolpath/facing.js";
import { loadPost } from "./goldens.js";

const flat: Tool & { number: number } = {
  id: "t1",
  number: 1,
  name: "6 mm flat",
  kind: "flat",
  diameter: 6,
  fluteLength: 20,
  overallLength: 50,
  shankDiameter: 6,
  flutes: 2,
  centreCutting: true,
};

const machine = newMachine(0);

const known: Xyz = [100, 100, -30];

function setup(changes: Partial<Setup> = {}, origin?: Xyz): Setup {
  return {
    id: "s1",
    name: "Setup 1",
    bodies: ["b1"],
    stock: { kind: "box", size: [100, 50, 20] },
    wcs: {
      origin: { kind: "stockCorner", x: "min", y: "min", z: "max" },
      axes: { x: "+x", z: "+z" },
      offsetIndex: 1,
      machine: origin ? { kind: "known", origin } : { kind: "unknown" },
    },
    safeHeight: 15,
    clearance: 3,
    tolerance: 0.01,
    fixtures: [],
    ...changes,
  };
}

const golden = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`golden/ir/${name}.json`, import.meta.url), "utf8"),
  ) as Section;

function section(moves: Move[], changes: Partial<Section> = {}): Section {
  return {
    operationId: "op1",
    toolId: "t1",
    pass: "rough",
    spindle: { rpm: 18000, dir: "cw" },
    coolant: "off",
    moves,
    ...changes,
  };
}

function program(sections: Section[], tools = [flat]): Program {
  return {
    irVersion: 1,
    units: "mm",
    setupId: "s1",
    offsetIndex: 1,
    tools,
    sections,
  };
}

function input(changes: Partial<CheckInput> = {}): CheckInput {
  return {
    program: program([golden("facing")]),
    setup: setup({}, known),
    stock: { min: [0, 0, -20], max: [100, 50, 0] },
    operations: [{ id: "op1", type: "rockett.cam.facing" }],
    machine,
    post: loadPost("grbl"),
    units: "mm",
    ...changes,
  };
}

const plunge: Move[] = [
  { kind: "rapid", to: [10, 10, 15] },
  { kind: "rapid", to: [10, 10, 3] },
  { kind: "feed", to: [10, 10, -1], feed: 300, role: "plunge" },
];

function cut(moves: Move[], changes: Partial<Section> = {}) {
  let at: Xyz | undefined;
  for (const move of [...plunge, ...moves]) at = endOf(move, at);
  const up: Move = { kind: "rapid", to: [at![0], at![1], 15] };
  return program([section([...plunge, ...moves, up], changes)]);
}

const across: Move = {
  kind: "feed",
  to: [40, 10, -1],
  feed: 1000,
  role: "cut",
};

function found(changes: Partial<CheckInput>) {
  return checkProgram(input(changes)).problems.map(
    ({ rule, section: s, move: m }) => `${rule} ${s ?? "-"}:${m ?? "-"}`,
  );
}

const clamp = (min: Xyz, max: Xyz): Fixture => ({
  name: "Toe clamp 1",
  min,
  max,
});

describe("checkProgram", () => {
  it("passes the facing golden and qualifies it with a known machine mapping", () => {
    expect(checkProgram(input())).toEqual({
      problems: [],
      travel: { status: "within" },
      qualified: true,
    });
  });

  it("passes the contour golden, with arcs, inside its stock", () => {
    const result = checkProgram(
      input({
        program: program([golden("contour")]),
        stock: { min: [-10, -10, -10], max: [50, 40, 0] },
        operations: [{ id: "op1", type: "rockett.cam.contour" }],
      }),
    );
    expect(result.problems).toEqual([]);
    expect(result.qualified).toBe(true);
  });

  it("marks travel unverified without a WCS-to-machine mapping and blocks qualified output", () => {
    expect(checkProgram(input({ setup: setup() }))).toEqual({
      problems: [],
      travel: { status: "unverified" },
      qualified: false,
    });
  });

  it("lists every problem with its rule, section and move instead of stopping at the first", () => {
    const result = checkProgram(
      input({
        program: cut([{ ...across, feed: 5000 }], {
          spindle: { rpm: 30000, dir: "cw" },
        }),
      }),
    );
    expect(result.problems).toEqual([
      { rule: "rpm", section: 0, reason: expect.stringContaining("30000") },
      {
        rule: "feed",
        section: 0,
        move: 3,
        reason: expect.stringContaining("X"),
      },
    ]);
    expect(result.qualified).toBe(false);
  });

  it("rejects an invalid IR program through validateProgram", () => {
    const arc: Move = {
      kind: "arc",
      to: [30, 10, -1],
      centre: [15, 10, -1],
      dir: "cw",
      plane: "xy",
      feed: 1000,
      role: "cut",
    };
    expect(found({ program: cut([arc]) })).toEqual(["ir 0:3"]);
    expect(found({ program: { ...cut([]), setupId: "s2" } })).toEqual([
      "ir -:-",
    ]);
  });

  it("rejects non-finite values in the program and the setup", () => {
    expect(found({ program: cut([{ ...across, feed: NaN }]) })).toEqual([
      "finite 0:3",
    ]);
    expect(found({ setup: setup({ safeHeight: Infinity }, known) })).toEqual([
      "finite -:-",
    ]);
  });

  it("rejects a feed of zero, a feed above an axis maximum and a missing maximum", () => {
    expect(found({ program: cut([{ ...across, feed: 0 }]) })).toEqual([
      "feed 0:3",
    ]);
    const steep: Move = {
      kind: "feed",
      to: [10, 10, -5],
      feed: 1500,
      role: "plunge",
    };
    expect(found({ program: cut([steep]) })).toEqual(["feed 0:3"]);
    const { maxFeedZ: _, ...partial } = machine;
    expect(found({ machine: partial as MachineProfile })).toEqual(["feed -:-"]);
  });

  it("rejects a zero rpm and an rpm outside the machine range, measured over nameplate", () => {
    const at = (rpm: number) =>
      found({ program: cut([across], { spindle: { rpm, dir: "cw" } }) });
    expect(at(24001)).toEqual(["rpm 0:-"]);
    expect(at(0)).toEqual(["rpm 0:-"]);
    const measured = (changes: Partial<MachineProfile>) =>
      found({ machine: { ...machine, ...changes } });
    expect(measured({ measuredRpmMax: 12000 })).toEqual(["rpm 0:-"]);
    expect(measured({ measuredRpmMin: 20000 })).toEqual(["rpm 0:-"]);
  });

  it("rejects cutting with no spindle state", () => {
    const { spindle: _, ...off } = cut([across]).sections[0]!;
    expect(found({ program: program([off]) })).toEqual(["spindle 0:2"]);
  });

  it("rejects a tool the operation does not take, an unknown operation, an invalid tool and a missing shank", () => {
    const ball = { ...flat, kind: "ball" as const };
    expect(found({ program: program([golden("facing")], [ball]) })).toEqual([
      "tool 0:-",
    ]);
    expect(found({ operations: [] })).toEqual(["tool 0:-"]);
    expect(
      found({ operations: [{ id: "op1", type: "rockett.cam.engrave" }] }),
    ).toEqual(["tool 0:-"]);
    const { shankDiameter: _, ...bare } = flat;
    for (const bad of [{ ...flat, diameter: 0 }, bare as typeof flat])
      expect(found({ program: program([golden("facing")], [bad]) })).toEqual([
        "tool -:-",
      ]);
  });

  it("reads the tool kinds each operation takes from the shared table", () => {
    const pocket = [{ id: "op1", type: "rockett.cam.pocket" }];
    expect(found({ operations: pocket })).toEqual([]);
    const ball = { ...flat, kind: "ball" as const };
    const result = checkProgram(
      input({ program: program([golden("facing")], [ball]) }),
    );
    const refusal = "facing needs a flat or bull end mill, not a ball";
    expect(result.problems.map((p) => p.reason)).toEqual([refusal]);
    const preset = { stepdown: 1, stepoverFraction: 0.5 } as Preset;
    const face = { operationId: "op1", modelTop: -1, preset, ...input() };
    expect(() => facing({ ...face, tool: ball })).toThrow(refusal);
  });

  it("treats the first move after every emitted tool change as an entry, past empty and comment-only sections", () => {
    const t2 = { ...flat, id: "t2", number: 2 };
    const tools = [t2, { ...t2, id: "t3", number: 3 }];
    const fast = section(
      [
        { kind: "feed", to: [50, 25, -5], feed: 100000, role: "plunge" },
        { kind: "rapid", to: [50, 25, 15] },
      ],
      { toolId: "t2" },
    );
    const empty = (toolId: string, changes: Partial<Section> = {}) =>
      section([], { toolId, ...changes });
    const run = (...sections: Section[]) =>
      program([...cut([across]).sections, ...sections], [flat, ...tools]);
    const swap = (...sections: Section[]) =>
      found({ program: run(...sections) });
    const hidden = run(empty("t2"), fast);
    expect(found({ program: hidden })).toEqual(["entry 2:0"]);
    expect(checkProgram(input({ program: hidden })).qualified).toBe(false);
    const note = section([{ kind: "comment", text: "t2" }], { toolId: "t2" });
    expect(swap(note, { ...fast, toolId: "t1" })).toEqual(["entry 2:0"]);
    expect(swap(empty("t3"), empty("t2"), fast)).toEqual(["entry 3:0"]);
    const perFile = { units: "mm" as const, toolChange: false };
    const { files } = normalise(hidden, loadPost("grbl"), perFile);
    expect(files.map((file) => file.length)).toEqual([1, 2]);
    const start = program([empty("t2"), fast], tools);
    expect(found({ program: start })).toEqual(["entry 1:0"]);
    expect(swap(empty("t2"))).toEqual([]);
    const rpm = { spindle: { rpm: 12000, dir: "cw" as const } };
    const down = section([across, { kind: "rapid", to: [40, 10, 15] }], rpm);
    expect(swap(empty("t1", rpm), down)).toEqual([]);
  });

  it("refuses duplicate tool ids and numbers, since the post could load another tool", () => {
    const fixtures = [clamp([40, 60, -20], [60, 70, 10])];
    const near = cut([{ ...across, to: [50, 52, -1] }]);
    const big = { ...flat, diameter: 20 };
    const run = (tools: Program["tools"]) =>
      found({ program: { ...near, tools }, setup: setup({ fixtures }, known) });
    expect(run([big])).toEqual(["fixture 0:3", "fixture 0:4"]);
    expect(run([big, { ...flat, number: 2, diameter: 3 }])).toEqual(["ir -:-"]);
    expect(run([flat, { ...flat, id: "t2" }])).toEqual(["ir -:-"]);
  });

  it("refuses a non-finite machine origin instead of reporting travel within", () => {
    expect(checkProgram(input({ setup: setup({}, [NaN, 100, -30]) }))).toEqual({
      problems: [expect.objectContaining({ rule: "finite" })],
      travel: { status: "unverified" },
      qualified: false,
    });
  });

  it("refuses stock and fixture boxes with min above max on any axis", () => {
    const stock = { min: [0, 50, -20] as Xyz, max: [100, 0, 0] as Xyz };
    expect(found({ stock, program: cut([across]) })).toEqual(["stock -:-"]);
    const fixtures = [clamp([20, 15, 10], [30, 25, -20])];
    expect(
      found({ program: cut([across]), setup: setup({ fixtures }, known) }),
    ).toEqual(["fixture -:-"]);
  });

  it("keeps setup clearance beside the stock faces below the stock top", () => {
    const beside = program([
      section([
        { kind: "rapid", to: [-4.5, -10, 15] },
        { kind: "rapid", to: [-4.5, -10, -1] },
        { kind: "rapid", to: [-4.5, 60, -1] },
        { kind: "rapid", to: [-4.5, 60, 15] },
      ]),
    ]);
    expect(found({ program: beside })).toEqual(["stock 0:2"]);
  });

  it("rejects an entry below safe height, a plunge without centre cutting and an unsafe setup", () => {
    const low = cut([across]);
    low.sections[0]!.moves[0] = { kind: "rapid", to: [10, 10, 5] };
    expect(found({ program: low })).toEqual(["entry 0:0"]);
    const side = { ...flat, centreCutting: false };
    expect(found({ program: program(cut([across]).sections, [side]) })).toEqual(
      ["entry 0:2"],
    );
    expect(found({ setup: setup({ clearance: 0 }, known) })).toEqual([
      "entry -:-",
    ]);
    expect(found({ setup: setup({ safeHeight: 2 }, known) })).toEqual([
      "entry -:-",
    ]);
  });

  it("rejects a section that does not retract to safe height", () => {
    const moves = cut([across]).sections[0]!.moves.slice(0, -1);
    expect(found({ program: program([section(moves)]) })).toEqual([
      "retract 0:3",
    ]);
  });

  it("rejects a rapid through stock whose endpoints are both clear of it", () => {
    const through = program([
      section([
        { kind: "rapid", to: [-10, 25, 15] },
        { kind: "rapid", to: [-10, 25, -1] },
        { kind: "rapid", to: [110, 25, -1] },
        { kind: "rapid", to: [110, 25, 15] },
      ]),
    ]);
    expect(found({ program: through })).toEqual(["stock 0:2"]);
    const inside = cut([{ kind: "rapid", to: [40, 10, -1] }]);
    expect(found({ program: inside })).toEqual(["stock 0:3"]);
  });

  it("rejects a move within setup clearance of a fixture, naming it, and a safe height below its top", () => {
    const fixtures = [clamp([20, 15, -20], [30, 25, 10])];
    const result = checkProgram(
      input({ program: cut([across]), setup: setup({ fixtures }, known) }),
    );
    expect(result.problems).toEqual([
      {
        rule: "fixture",
        section: 0,
        move: 3,
        reason: expect.stringContaining("Toe clamp 1"),
      },
    ]);
    const tall = [clamp([150, 10, -20], [160, 20, 14])];
    expect(found({ setup: setup({ fixtures: tall }, known) })).toEqual([
      "fixture -:-",
    ]);
  });

  it("rejects travel outside the machine axes when the mapping is known", () => {
    expect(found({ setup: setup({}, [250, 100, -30]) })).toEqual(
      expect.arrayContaining(["travel 0:3"]),
    );
    expect(
      checkProgram(input({ setup: setup({}, [250, 100, -30]) })).travel,
    ).toEqual({ status: "outside", axes: ["x"] });
  });

  it("rejects an arc with safe endpoints whose midpoint leaves machine travel or nears a fixture", () => {
    const arc: Move = {
      kind: "arc",
      to: [10, 30, -1],
      centre: [10, 20, -1],
      dir: "ccw",
      plane: "xy",
      feed: 1000,
      role: "cut",
    };
    const bulge = program([
      section([...plunge, arc, { kind: "rapid", to: [10, 30, 15] }]),
    ]);
    expect(
      found({ program: bulge, setup: setup({}, [285, 100, -30]) }),
    ).toEqual(["travel 0:3"]);
    const fixtures = [clamp([24, 15, -20], [30, 25, 10])];
    expect(
      found({ program: bulge, setup: setup({ fixtures }, known) }),
    ).toEqual(["fixture 0:3"]);
    const chord = program([
      section([
        ...plunge,
        { kind: "feed", to: [10, 30, -1], feed: 1000, role: "cut" },
        { kind: "rapid", to: [10, 30, 15] },
      ]),
    ]);
    expect(
      found({ program: chord, setup: setup({}, [285, 100, -30]) }),
    ).toEqual([]);
    expect(
      found({ program: chord, setup: setup({ fixtures }, known) }),
    ).toEqual([]);
  });

  it("checks every point of a cycle and lets pecks re-enter their own hole", () => {
    const drill = { ...flat, id: "t2", kind: "drill" as const, tipAngle: 118 };
    const peck: Move = {
      kind: "cycle",
      cycle: "peck",
      points: [
        [10, 10],
        [40, 10],
      ],
      clear: 3,
      top: 0,
      bottom: -12,
      peck: 4,
      feed: 200,
    };
    const holes = (fixtures: Fixture[]) =>
      found({
        program: program(
          [
            section(
              [
                { kind: "rapid", to: [10, 10, 15] },
                peck,
                { kind: "rapid", to: [40, 10, 15] },
              ],
              { toolId: "t2", operationId: "op2" },
            ),
          ],
          [drill],
        ),
        operations: [{ id: "op2", type: "rockett.cam.contour" }],
        setup: setup({ fixtures }, known),
      });
    expect(holes([])).toEqual(["tool 0:-"]);
    expect(holes([clamp([-5, 5, -20], [5, 15, 10])])).toEqual([
      "tool 0:-",
      "fixture 0:1",
    ]);
  });

  it("rejects output units that differ from the machine and a non-mm IR", () => {
    expect(found({ units: "inch" })).toEqual(["units -:-"]);
    const inch = { ...input().program, units: "inch" } as unknown as Program;
    expect(found({ program: inch })).toEqual(["units -:-"]);
  });

  it("rejects a post whose footer leaves the spindle or coolant running", () => {
    const post = loadPost("grbl");
    post.templates.footer = ["M30"];
    expect(found({ post })).toEqual(["termination -:-"]);
  });

  it("rejects an invalid machine profile", () => {
    expect(found({ machine: { ...machine, xMax: -1 } })).toEqual([
      "machine -:-",
    ]);
  });

  it("rejects raw post text, which the check cannot see into", () => {
    const raw: Move = { kind: "raw", post: "grbl", text: "G0 Z-50" };
    expect(found({ program: cut([raw]) })).toEqual(["raw 0:3"]);
  });
});
