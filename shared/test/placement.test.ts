import { describe, expect, it } from "vitest";
import type { PlaneFrame, Vec3 } from "../src/api.js";
import { Placement } from "../src/placement.js";
import { LINEAR_TOL } from "../src/tolerance.js";

const near = (a: readonly number[], b: readonly number[]) =>
  a.forEach((v, i) => expect(Math.abs(v - b[i]!)).toBeLessThan(LINEAR_TOL));

const turn = Placement.compose(
  Placement.fromTranslation([3, -7, 2]),
  Placement.fromAxisAngle([1, 2, 3], 1.1, [4, 5, -6]),
);

describe("placement", () => {
  it("composes with its inverse to the identity", () => {
    const id = Placement.identity();
    for (const p of [
      Placement.compose(turn, Placement.invert(turn)),
      Placement.compose(Placement.invert(turn), turn),
    ]) {
      near(p.rotation, id.rotation);
      near(p.translation, id.translation);
    }
    const x: Vec3 = [12.5, -3, 8];
    near(
      Placement.applyToPoint(
        Placement.invert(turn),
        Placement.applyToPoint(turn, x),
      ),
      x,
    );
  });

  it("maps X to Y with a 90 degree turn about Z", () => {
    const quarter = Placement.fromAxisAngle([0, 0, 1], Math.PI / 2);
    near(Placement.applyToDirection(quarter, [1, 0, 0]), [0, 1, 0]);
    near(Placement.applyToPoint(quarter, [2, 0, 5]), [0, 2, 5]);
  });

  it("turns about an axis through its origin", () => {
    const half = Placement.fromAxisAngle([0, 0, 2], Math.PI, [10, 0, 0]);
    near(Placement.applyToPoint(half, [10, 0, 3]), [10, 0, 3]);
    near(Placement.applyToPoint(half, [11, 1, 0]), [9, -1, 0]);
  });

  it("applies the right operand first in compose", () => {
    const quarter = Placement.fromAxisAngle([0, 0, 1], Math.PI / 2);
    const shift = Placement.fromTranslation([5, 0, 0]);
    near(
      Placement.applyToPoint(Placement.compose(quarter, shift), [1, 0, 0]),
      [0, 6, 0],
    );
    near(
      Placement.applyToPoint(Placement.compose(shift, quarter), [1, 0, 0]),
      [5, 1, 0],
    );
  });

  it("moves the origin of a frame and turns its axes", () => {
    const frame: PlaneFrame = {
      origin: [1, 2, 3],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
    };
    const out = Placement.applyToFrame(
      Placement.compose(
        Placement.fromTranslation([0, 0, 10]),
        Placement.fromAxisAngle([0, 0, 1], Math.PI / 2),
      ),
      frame,
    );
    near(out.origin, [-2, 1, 13]);
    near(out.xAxis, [0, 1, 0]);
    near(out.yAxis, [-1, 0, 0]);
    near(out.normal, [0, 0, 1]);
  });

  it("rejects a zero axis", () => {
    expect(() => Placement.fromAxisAngle([0, 0, 0], 1)).toThrow();
  });
});
