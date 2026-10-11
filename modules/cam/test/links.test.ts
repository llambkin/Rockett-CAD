import { describe, expect, it } from "vitest";
import { checkProgram } from "../src/post/check.js";
import type { Move, Program, Section } from "../src/shared/ir.js";
import { newMachine } from "../src/shared/machine.js";
import type { Box, Fixture, Setup } from "../src/shared/setup.js";
import type { Preset, Tool } from "../src/shared/tools.js";
import type { Loop } from "../src/toolpath/geometry.js";
import { linked } from "../src/post/link.js";
import { pocket } from "../src/toolpath/pocket.js";
import { format, loadPost } from "./goldens.js";

const tool: Tool & { number: number } = {
  id: "t1",
  number: 1,
  name: "6 mm flat",
  kind: "flat",
  diameter: 6,
  fluteLength: 22,
  overallLength: 50,
  shankDiameter: 6,
  flutes: 2,
  centreCutting: true,
};

const preset: Preset = {
  id: "p1",
  name: "MDF pocket",
  rpm: 18000,
  cutFeed: 1000,
  plungeFeed: 300,
  rampFeed: 500,
  stepdown: 3,
  stepoverFraction: 0.5,
  coolant: "off",
};

const stock: Box = { min: [-10, -10, -10], max: [70, 30, 0] };

const clamp: Fixture = {
  name: "toe clamp 1",
  min: [26, -5, 0],
  max: [34, 25, 10],
};

const setup = (fixtures: Fixture[]): Setup => ({
  id: "s1",
  name: "Setup 1",
  bodies: ["b1"],
  stock: { kind: "box", size: [80, 40, 10] },
  wcs: {
    origin: { kind: "stockCorner", x: "min", y: "min", z: "max" },
    axes: { x: "+x", z: "+z" },
    offsetIndex: 1,
    machine: { kind: "unknown" },
  },
  safeHeight: 15,
  clearance: 3,
  tolerance: 0.01,
  fixtures,
});

const square = (x: number): Loop => [
  { x, y: 0 },
  { x: x + 20, y: 0 },
  { x: x + 20, y: 20 },
  { x, y: 20 },
];

const pocketAt = (x: number, operationId: string): Section =>
  pocket({
    operationId,
    setup: { safeHeight: 15, clearance: 3, fixtures: [] },
    stock,
    boundary: square(x),
    islands: [],
    bottom: -6,
    rampAngle: 5,
    tool,
    preset,
  });

const machine = { ...newMachine(0), spinUpSeconds: 2 };

const program = (sections: Section[], tools = [tool]): Program => ({
  irVersion: 1,
  units: "mm",
  setupId: "s1",
  offsetIndex: 1,
  tools,
  sections,
});

const twoPockets = () => program([pocketAt(0, "op1"), pocketAt(40, "op2")]);

const link = (each: Program, fixtures: Fixture[] = []) =>
  linked(each, {
    setup: setup(fixtures),
    stock,
    spinUpSeconds: machine.spinUpSeconds,
  });

const check = (each: Program, fixtures: Fixture[] = []) =>
  checkProgram({
    program: each,
    setup: setup(fixtures),
    stock,
    operations: [
      { id: "op1", type: "rockett.cam.pocket" },
      { id: "op2", type: "rockett.cam.pocket" },
    ],
    machine,
    post: loadPost("grbl"),
    units: "mm",
  }).problems;

const cutting = (move: Move) => move.kind === "feed" || move.kind === "arc";

const cuts = (moves: Move[]) => moves.filter(cutting);

function between({ sections: [first, second] }: Program) {
  const lastCut = first!.moves.findLastIndex(cutting);
  const firstCut = second!.moves.findIndex(cutting);
  return [
    ...first!.moves.slice(lastCut + 1),
    ...second!.moves.slice(0, firstCut),
  ];
}

const heights = (moves: Move[]) =>
  moves.flatMap((move) => (move.kind === "rapid" ? [move.to[2]] : []));

describe("links between cuts", () => {
  it("links two pockets 20 mm apart at clearance height, not safe height", () => {
    const before = twoPockets();
    expect(heights(between(before))).toContain(15);
    const after = link(before);
    expect(heights(between(after))).toEqual([3, 3]);
    expect(after.sections[0]!.moves[1]).toEqual(before.sections[0]!.moves[0]);
    expect(cuts(after.sections[1]!.moves)).toEqual(
      cuts(before.sections[1]!.moves),
    );
    expect(after.sections[1]!.moves.at(-1)).toEqual(
      before.sections[1]!.moves.at(-1),
    );
    expect(check(after)).toEqual([]);
  });

  it("lifts a link across a clamp only to the clamp top plus clearance", () => {
    const after = link(twoPockets(), [clamp]);
    expect(heights(between(after))).toEqual([13, 13, 3]);
    expect(check(after, [clamp])).toEqual([]);
    expect(check(link(twoPockets()), [clamp])).toContainEqual(
      expect.objectContaining({
        rule: "fixture",
        reason: "the tool comes within 3 mm of toe clamp 1",
      }),
    );
  });

  it("dwells the spin-up time after each spindle start and tool change, before entering stock", () => {
    const second = { ...tool, id: "t2", number: 2 };
    const [a, b] = twoPockets().sections;
    const changed = link(
      program([a!, { ...b!, toolId: "t2" }], [tool, second]),
    );
    for (const section of changed.sections)
      expect(section.moves[0]).toEqual({ kind: "dwell", seconds: 2 });
    expect(heights(between(changed))).toEqual([15, 15, 3]);
    const same = link(twoPockets());
    expect(same.sections[0]!.moves[0]).toEqual({ kind: "dwell", seconds: 2 });
    expect(same.sections[1]!.moves.some((m) => m.kind === "dwell")).toBe(false);
    const [text] = format(loadPost("grbl"), same);
    const lines = text!.split("\n");
    const spin = lines.indexOf("M3 S18000");
    const dwell = lines.indexOf("G4 P2");
    expect(spin).toBeGreaterThan(0);
    expect(dwell).toBeGreaterThan(spin);
    expect(dwell).toBeLessThan(lines.findIndex((l) => l.startsWith("G1")));
    expect(lines.filter((l) => l.startsWith("G4"))).toEqual(["G4 P2"]);
    const none = linked(twoPockets(), { setup: setup([]), stock });
    expect(none.sections[0]!.moves[0]!.kind).toBe("rapid");
  });

  it("still reports a tool run that ends below safe height", () => {
    const after = link(twoPockets());
    const last = after.sections[1]!;
    const low = program([
      after.sections[0]!,
      { ...last, moves: last.moves.slice(0, -1) },
    ]);
    expect(check(low).map(({ rule, section }) => [rule, section])).toEqual([
      ["retract", 1],
    ]);
  });
});
