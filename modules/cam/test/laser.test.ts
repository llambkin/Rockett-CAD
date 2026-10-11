import { readFileSync } from "node:fs";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { checkProgram, type CheckInput } from "../src/post/check.js";
import { formatProgram } from "../src/post/format.js";
import { normalise } from "../src/post/normalise.js";
import { validatePost, type Post } from "../src/post/schema.js";
import type { Program, Section } from "../src/shared/ir.js";
import {
  machineKind,
  machineSchema,
  newMachine,
  validateMachine,
  type MachineProfile,
} from "../src/shared/machine.js";
import type { Setup } from "../src/shared/setup.js";
import { golden, loadPost } from "./goldens.js";

const grbl = loadPost("grbl");

const beam = {
  id: "t1",
  number: 1,
  name: "Laser 0.2 mm beam",
  kind: "flat",
  diameter: 0.2,
  fluteLength: 1,
  overallLength: 10,
  shankDiameter: 0.2,
  flutes: 1,
  centreCutting: true,
} as const;

const cut: Section = {
  operationId: "laser-1",
  toolId: "t1",
  pass: "finish",
  coolant: "off",
  moves: [
    { kind: "comment", text: "Laser cut 20 x 20 square, R5 corner" },
    { kind: "rapid", to: [0, 0, 15] },
    { kind: "rapid", to: [0, 0, 5] },
    { kind: "feed", to: [0, 0, 0], feed: 600, role: "plunge" },
    { kind: "feed", to: [15, 0, 0], feed: 1200, role: "cut", power: 75 },
    {
      kind: "arc",
      to: [20, 5, 0],
      centre: [15, 5, 0],
      dir: "ccw",
      plane: "xy",
      feed: 1200,
      role: "cut",
      power: 75,
    },
    { kind: "feed", to: [20, 20, 0], feed: 1200, role: "cut", power: 75 },
    { kind: "feed", to: [0, 20, 0], feed: 1200, role: "cut", power: 60 },
    { kind: "feed", to: [0, 0, 0], feed: 1200, role: "cut", power: 60 },
    { kind: "rapid", to: [0, 0, 15] },
  ],
};

const program = (section: Section): Program => ({
  irVersion: 1,
  units: "mm",
  setupId: "s1",
  offsetIndex: 1,
  tools: [beam],
  sections: [section],
});

const laser: MachineProfile = {
  ...newMachine(0),
  kind: "laser",
  laserPowerMax: 1000,
  focusZ: 0,
  laserMode: true,
};

const setup: Setup = {
  id: "s1",
  name: "Setup 1",
  bodies: ["b1"],
  stock: { kind: "box", size: [20, 20, 3] },
  wcs: {
    origin: { kind: "stockCorner", x: "min", y: "min", z: "max" },
    axes: { x: "+x", z: "+z" },
    offsetIndex: 1,
    machine: { kind: "unknown" },
  },
  safeHeight: 15,
  clearance: 3,
  tolerance: 0.01,
  fixtures: [],
};

const facing = JSON.parse(
  readFileSync(new URL("golden/ir/facing.json", import.meta.url), "utf8"),
) as Section;

function check(machine: MachineProfile, section = cut) {
  const input: CheckInput = {
    program: program(section),
    setup,
    stock: { min: [0, 0, -3], max: [20, 20, 0] },
    operations: [
      { id: "laser-1", type: "rockett.cam.laser" },
      { id: facing.operationId, type: "rockett.cam.facing" },
    ],
    machine,
    post: grbl,
    units: "mm",
  };
  return checkProgram(input).problems;
}

const write = (post: Post, laserPowerMax: number) =>
  formatProgram(normalise(program(cut), post, { units: "mm" }), post, {
    laserPowerMax,
  });

describe("laser mode", () => {
  it("writes the laser fixture in GRBL laser mode", () => {
    expect(validatePost(grbl)).toEqual([]);
    const out = write(grbl, 1000);
    expect(out).toEqual(golden(grbl, "laser-cut", 1));
    const lines = out[0]!.split("\n");
    expect(lines[0]).toBe("(Laser mode: GRBL needs $32=1)");
    expect(lines.filter((l) => /\bM3\b/.test(l))).toEqual([]);
    expect(lines.filter((l) => l.startsWith("G0") && / S/.test(l))).toEqual([]);
    expect(out[0]).toMatch(/\nM5\nM30\n$/);
  });

  it("refuses laser output on a post without laser mode", () => {
    expect(() => write(loadPost("linuxcnc"), 1000)).toThrow(
      "post linuxcnc has no laser mode",
    );
  });

  it("refuses a laser post whose cutting moves carry no power", () => {
    const templates = {
      ...grbl.templates,
      linear: ["G1 X{x} Y{y} Z{z} F{feed}"],
    };
    expect(validatePost({ ...grbl, templates })).toEqual([
      "templates.linear: needs {power}",
    ]);
  });

  it("rejects a laser operation on a mill profile", () => {
    expect(check(newMachine(0))).toContainEqual({
      rule: "laser",
      section: 0,
      move: 4,
      reason: "a mill cannot run a laser operation",
    });
  });

  it("rejects a spindle operation on a laser profile", () => {
    expect(check(laser, facing)).toContainEqual({
      rule: "laser",
      section: 0,
      reason: "a laser cannot run a spindle operation",
    });
  });

  it("passes the laser fixture on a laser profile", () => {
    expect(check(laser)).toEqual([]);
  });

  it("rejects laser power outside 0 to 100 percent", () => {
    const over = structuredClone(cut);
    const first = over.moves[4]!;
    if (first.kind === "feed") first.power = 101;
    expect(check(laser, over)).toContainEqual({
      rule: "laser",
      section: 0,
      move: 4,
      reason: "laser power 101% is outside 0 to 100",
    });
  });

  it("loads a stored profile with no kind as a mill", () => {
    const stored: unknown = JSON.parse(
      JSON.stringify({ ...newMachine(0), laserMode: false }),
    );
    expect(Value.Check(machineSchema, stored)).toBe(true);
    const machine = stored as MachineProfile;
    expect(machine).not.toHaveProperty("kind");
    expect(machineKind(machine)).toBe("mill");
    expect(validateMachine(machine)).toEqual([]);
  });

  it("needs a maximum power S on a laser", () => {
    const { laserPowerMax: _, ...bare } = laser;
    expect(validateMachine(bare)).toEqual([
      "a laser needs its maximum power S",
    ]);
  });

  it("needs the controller's laser mode on a laser", () => {
    const { laserMode: _, ...unset } = laser;
    const off = {
      rule: "laser",
      reason:
        "laser mode is not on: send $32=1 to the controller, or the beam stays on along every rapid",
    };
    expect(check(unset)).toContainEqual(off);
    expect(check({ ...laser, laserMode: false })).toContainEqual(off);
  });

  it("refuses to post a laser power outside 0 to 100 percent", () => {
    const under = structuredClone(cut);
    const first = under.moves[4]!;
    if (first.kind === "feed") first.power = -10;
    expect(() =>
      formatProgram(normalise(program(under), grbl, { units: "mm" }), grbl, {
        laserPowerMax: 1000,
      }),
    ).toThrow("laser power -10% is outside 0 to 100");
  });

  it("refuses to post a laser program without the maximum power S", () => {
    expect(() =>
      formatProgram(normalise(program(cut), grbl, { units: "mm" }), grbl, {}),
    ).toThrow("a laser program needs the laser's maximum power S");
  });

  it("flags a controller laser mode on a mill", () => {
    expect(check({ ...newMachine(0), laserMode: true }, facing)).toContainEqual(
      {
        rule: "laser",
        reason:
          "the controller's laser mode ($32) is on for a mill, so it will not wait for the spindle",
      },
    );
  });
});
