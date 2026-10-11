import { describe, expect, it } from "vitest";
import type { Move, Section, Xyz } from "../src/shared/ir.js";
import { newMachine, type MachineProfile } from "../src/shared/machine.js";
import { byAcceleration, estimateTime } from "../src/shared/time.js";

const machine: MachineProfile = {
  ...newMachine(0),
  maxFeedX: 3000,
  maxFeedY: 3000,
  maxFeedZ: 1000,
  accelX: 100,
  accelY: 100,
  accelZ: 50,
  junctionDeviation: 0.01,
  spinUpSeconds: 2,
};

const section = (moves: Move[], extra: Partial<Section> = {}): Section => ({
  operationId: "op",
  toolId: "t1",
  pass: "rough",
  spindle: { rpm: 12000, dir: "cw" },
  coolant: "off",
  moves,
  ...extra,
});

const motion = (moves: Move[]) => {
  const { spindle: _spindle, ...still } = section(moves);
  return { sections: [still] };
};

const feed = (to: Xyz, rate = 1200): Move => ({
  kind: "feed",
  to,
  feed: rate,
  role: "cut",
});

const start: Move = { kind: "rapid", to: [0, 0, 0] };

const trapezoid = (length: number, speed: number, accel: number) =>
  length >= (speed * speed) / accel
    ? length / speed + speed / accel
    : 2 * Math.sqrt(length / accel);

const circle = (r: number, rate: number) => [
  { kind: "rapid", to: [r, 0, 0] } as Move,
  {
    kind: "arc",
    to: [r, 0, 0],
    centre: [0, 0, 0],
    dir: "ccw",
    plane: "xy",
    feed: rate,
    role: "cut",
  } as Move,
];

const seconds = (moves: Move[], profile = machine) =>
  estimateTime(motion(moves), profile).seconds;

describe("estimateTime", () => {
  it("times a 100 mm line as the analytic trapezoid within 1e-6 s", () => {
    const got = seconds([start, feed([100, 0, 0])]);
    expect(Math.abs(got - trapezoid(100, 20, 100))).toBeLessThan(1e-6);
    expect(Math.abs(got - 5.2)).toBeLessThan(1e-6);
  });

  it("times a line too short to reach its feed as a triangle", () => {
    const got = seconds([start, feed([2, 0, 0])]);
    expect(Math.abs(got - 2 * Math.sqrt(2 / 100))).toBeLessThan(1e-9);
  });

  it("limits rate and acceleration by each axis along the move", () => {
    const got = seconds([start, { kind: "rapid", to: [60, 0, -80] }]);
    const leg = trapezoid(100, 1000 / 60 / 0.8, 50 / 0.8);
    expect(Math.abs(got - leg)).toBeLessThan(1e-9);
  });

  it("caps a feed above the axis maximum at the maximum rate", () => {
    const got = seconds([start, feed([100, 0, 0], 9000)]);
    expect(Math.abs(got - trapezoid(100, 50, 100))).toBeLessThan(1e-9);
  });

  it("slows a corner to the junction deviation speed GRBL plans", () => {
    const got = seconds([start, feed([50, 0, 0]), feed([50, 50, 0])]);
    const sinHalf = Math.sqrt(0.5);
    const accel = 100 / Math.SQRT1_2;
    const corner = Math.sqrt((accel * 0.01 * sinHalf) / (1 - sinHalf));
    const v = 20;
    const up = (v * v) / 200;
    const down = (v * v - corner * corner) / 200;
    const leg = v / 100 + (v - corner) / 100 + (50 - up - down) / v;
    expect(Math.abs(got - 2 * leg)).toBeLessThan(1e-9);
  });

  it("runs straight through a collinear junction", () => {
    const got = seconds([start, feed([50, 0, 0]), feed([100, 0, 0])]);
    expect(Math.abs(got - trapezoid(100, 20, 100))).toBeLessThan(1e-9);
  });

  it("stops for a dwell and adds its seconds", () => {
    const got = seconds([
      start,
      feed([50, 0, 0]),
      { kind: "dwell", seconds: 1.5 },
      feed([100, 0, 0]),
    ]);
    expect(Math.abs(got - 2 * trapezoid(50, 20, 100) - 1.5)).toBeLessThan(1e-9);
  });

  it("adds spin-up when the spindle starts, changes or the tool changes", () => {
    const moves = (x: number) => [feed([x, 0, 0])];
    const time = estimateTime(
      {
        sections: [
          section([start, ...moves(50)]),
          section(moves(100)),
          section(moves(150), { spindle: { rpm: 9000, dir: "cw" } }),
          section(moves(200), {
            toolId: "t2",
            spindle: { rpm: 9000, dir: "cw" },
          }),
        ],
      },
      machine,
    );
    const leg = trapezoid(50, 20, 100);
    const spinUps = time.sections.map((s) => s.seconds - s.motion);
    expect(spinUps.map((s) => Math.round(s * 1e9) / 1e9)).toEqual([2, 0, 2, 2]);
    const run = trapezoid(100, 20, 100);
    expect(Math.abs(time.seconds - run - 2 * leg - 6)).toBeLessThan(1e-9);
  });

  it("limits arc speed by acceleration and radius", () => {
    const tight = estimateTime(motion(circle(2, 6000)), machine);
    expect(tight.seconds).toBeGreaterThan((2 * 2 * Math.PI * 2) / 100);
    expect(byAcceleration(tight.sections[0]!)).toBe(true);
    const wide = estimateTime(motion(circle(500, 600)), machine);
    const length = 2 * Math.PI * 500;
    expect(Math.abs(wide.seconds - trapezoid(length, 10, 100))).toBeLessThan(
      1e-3,
    );
    expect(byAcceleration(wide.sections[0]!)).toBe(false);
  });

  it("marks motion where acceleration, not feed, sets the time", () => {
    const zigzag = Array.from({ length: 40 }, (_, i) =>
      feed([i + 1, i % 2, 0], 3000),
    );
    const line = estimateTime(motion([start, feed([100, 0, 0])]), machine);
    const zig = estimateTime(motion([start, ...zigzag]), machine);
    expect(byAcceleration(line.sections[0]!)).toBe(false);
    expect(byAcceleration(zig.sections[0]!)).toBe(true);
  });

  it("times a finish move at profile 3 as 60% acceleration on a machine with profiles", () => {
    const profiled = { ...machine, accelerationProfiles: true };
    const alone = (moves: Move[], extra: Partial<Section>) => {
      const { spindle: _spindle, ...still } = section(moves, extra);
      return { sections: [still] };
    };
    const cut = [start, feed([100, 0, 0])];
    const time = (extra: Partial<Section>, on: MachineProfile = profiled) =>
      estimateTime(alone(cut, extra), on).seconds;
    const at60 = estimateTime(alone(cut, { pass: "finish" }), {
      ...machine,
      accelX: 60,
      accelY: 60,
      accelZ: 30,
    }).seconds;
    expect(time({ pass: "finish" })).toBe(at60);
    expect(Math.abs(at60 - trapezoid(100, 20, 60))).toBeLessThan(1e-9);
    expect(Math.abs(time({ pass: "finish", profile: 5 }) - 6)).toBeLessThan(
      1e-9,
    );
    expect(time({ pass: "finish", profile: 1 })).toBe(time({ pass: "rough" }));
    expect(Math.abs(time({ pass: "rough" }) - 5.2)).toBeLessThan(1e-6);
    expect(time({ pass: "finish" }, machine)).toBe(time({ pass: "rough" }));
    const rapid = alone([start, { kind: "rapid", to: [100, 0, 0] }], {
      pass: "finish",
    });
    expect(estimateTime(rapid, profiled)).toEqual(estimateTime(rapid, machine));
  });

  it("refuses a machine without its acceleration limits", () => {
    const { accelY: _y, junctionDeviation: _j, ...bare } = machine;
    expect(() => seconds([start, feed([1, 0, 0])], bare)).toThrow(
      "a time estimate needs accelY, junctionDeviation",
    );
  });

  it("refuses a drill cycle rather than timing it wrong", () => {
    const drill: Move = {
      kind: "cycle",
      cycle: "drill",
      points: [[0, 0]],
      clear: 3,
      top: 0,
      bottom: -5,
      feed: 100,
    };
    expect(() => seconds([start, drill])).toThrow(
      "drill cycles are not timed yet",
    );
  });
});
