import { describe, expect, it } from "vitest";
import type { PlaneFrame, Vec3 } from "../src/api.js";
import type { Instance } from "../src/assembly.js";
import {
  type Joint,
  type JointFrames,
  solvePlacements,
} from "../src/assemblyJoints.js";
import { Placement } from "../src/placement.js";
import { UNIT_DOT_TOL } from "../src/tolerance.js";

const instance = (
  id: string,
  grounded: boolean,
  placement = Placement.identity(),
): Instance => ({
  id,
  name: `${id}:1`,
  documentId: "part",
  placement,
  grounded,
});

const origin = (id: string): Joint["a"] => ({
  path: [id],
  ref: { kind: "face", bodyId: "body-1", faceName: "F1" },
});

const rigid = (id: string, a: string, b: string): Joint => ({
  id,
  name: id,
  type: "rigid",
  a: origin(a),
  b: origin(b),
  flipped: false,
});

const frame = (
  at: Vec3,
  xAxis: Vec3 = [1, 0, 0],
  yAxis: Vec3 = [0, 1, 0],
  normal: Vec3 = [0, 0, 1],
): PlaneFrame => ({ origin: at, xAxis, yAxis, normal });

const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v);
  return [v[0] / length, v[1] / length, v[2] / length];
};

const flat: JointFrames = { a: frame([0, 0, 0]), b: frame([0, 0, 0]) };

const turnZ = (degrees: number, translation: Vec3): Placement => ({
  ...Placement.fromAxisAngle([0, 0, 1], (degrees * Math.PI) / 180),
  translation,
});

const expectNear = (actual: Vec3, expected: Vec3) =>
  actual.forEach((value, i) =>
    expect(Math.abs(value - expected[i]!)).toBeLessThanOrEqual(UNIT_DOT_TOL),
  );

const expectPlaced = (
  placements: ReadonlyMap<string, Placement>,
  id: string,
  expected: Placement,
) => {
  const actual = placements.get(id);
  expect(actual).toBeDefined();
  if (!actual) return;
  const probes: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (const probe of probes)
    expectNear(
      Placement.applyToPoint(actual, probe),
      Placement.applyToPoint(expected, probe),
    );
};

describe("solvePlacements", () => {
  it("reports overconstrained when two joints drive one child", () => {
    const base = Placement.fromTranslation([0, 0, 0]);
    const other = Placement.fromTranslation([7, 0, 0]);
    const { placements, errors } = solvePlacements(
      [
        instance("g1", true, base),
        instance("g2", true, other),
        instance("c", false),
      ],
      [rigid("j1", "g1", "c"), rigid("j2", "g2", "c")],
      new Map([
        ["j1", flat],
        ["j2", flat],
      ]),
    );
    expect(errors).toEqual(new Map([["j2", "overconstrained"]]));
    expectPlaced(placements, "c", Placement.fromAxisAngle([1, 0, 0], Math.PI));
    expectPlaced(placements, "g2", other);
  });

  it("walks a chain from a grounded instance, inverting a joint reached at b", () => {
    const hinge: Joint = {
      id: "hinge",
      name: "Hinge",
      type: "revolute",
      a: origin("g"),
      b: origin("arm"),
      value: 90,
      limits: { min: -180, max: 180 },
      flipped: false,
    };
    const slide: Joint = {
      id: "slide",
      name: "Slide",
      type: "slider",
      a: origin("pin"),
      b: origin("arm"),
      value: 5,
      flipped: true,
    };
    const frames = new Map<string, JointFrames>([
      [
        "hinge",
        {
          a: frame([0, 0, 5]),
          b: frame([0, 0, 0], [1, 0, 0], [0, -1, 0], [0, 0, -1]),
        },
      ],
      ["slide", { a: frame([0, 0, 0]), b: frame([2, 0, 0]) }],
    ]);
    const { placements, errors } = solvePlacements(
      [
        instance("pin", false, Placement.fromTranslation([99, 99, 99])),
        instance("arm", false),
        instance("g", true, Placement.fromTranslation([10, 0, 0])),
      ],
      [slide, hinge],
      frames,
    );
    expect(errors.size).toBe(0);
    expectPlaced(placements, "g", Placement.fromTranslation([10, 0, 0]));
    expectPlaced(placements, "arm", turnZ(90, [10, 0, 5]));
    expectPlaced(placements, "pin", turnZ(90, [10, 2, 0]));
  });

  it("lands an oblique frame b face to face on frame a", () => {
    const tilt = Placement.fromAxisAngle([1, 2, 3], 0.7);
    const a = Placement.applyToFrame(tilt, frame([1, 2, 3]));
    const normal = unit([-1, 1, -2]);
    const xAxis = unit([1, 1, 0]);
    const yAxis = Placement.applyToDirection(
      Placement.fromAxisAngle(normal, Math.PI / 2),
      xAxis,
    );
    const b = frame([4, -1, 0.5], xAxis, yAxis, normal);
    const ground = Placement.fromAxisAngle([0, 1, 1], -1.2, [2, 0, 0]);
    const { placements } = solvePlacements(
      [instance("g", true, ground), instance("c", false)],
      [rigid("j", "g", "c")],
      new Map([["j", { a, b }]]),
    );
    const landed = Placement.applyToFrame(placements.get("c")!, b);
    const target = Placement.applyToFrame(ground, a);
    expectNear(landed.origin, target.origin);
    expectNear(landed.xAxis, target.xAxis);
    expectNear(landed.yAxis, target.yAxis.map((v) => -v) as Vec3);
    expectNear(landed.normal, target.normal.map((v) => -v) as Vec3);
  });

  it("reports unreachable joints and keeps unjointed placements", () => {
    const loose = Placement.fromAxisAngle([0, 1, 0], 0.4, [3, 1, 2]);
    const stored = Placement.fromTranslation([4, 5, 6]);
    const { placements, errors } = solvePlacements(
      [
        instance("g", true),
        instance("c", false, stored),
        instance("d", false),
        instance("e", false, loose),
      ],
      [rigid("j", "c", "d")],
      new Map([["j", flat]]),
    );
    expect(errors).toEqual(new Map([["j", "unreachable"]]));
    expectPlaced(placements, "c", stored);
    expectPlaced(placements, "e", loose);
  });

  it("reports outsideLimits when the value leaves its limits", () => {
    const joint: Joint = {
      id: "j",
      name: "Hinge",
      type: "revolute",
      a: origin("g"),
      b: origin("c"),
      value: 120,
      limits: { min: 0, max: 90 },
      flipped: true,
    };
    const { placements, errors } = solvePlacements(
      [instance("g", true), instance("c", false)],
      [joint],
      new Map([["j", flat]]),
    );
    expect(errors).toEqual(new Map([["j", "outsideLimits"]]));
    expectPlaced(placements, "c", turnZ(120, [0, 0, 0]));
  });
});
