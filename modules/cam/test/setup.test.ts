import {
  Placement as Kit,
  type Placement as KitPlacement,
  type VertexRef as KitVertexRef,
} from "@rockett/shared";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Xyz } from "../src/shared/ir.js";
import {
  checkTravel,
  stockBox,
  type Axis,
  type Box,
  type Placement,
  type Setup,
  type VertexRef,
  type Wcs,
} from "../src/shared/setup.js";

const plate: Box = { min: [0, 0, 0], max: [100, 50, 20] };

const topLeft: Wcs["origin"] = {
  kind: "stockCorner",
  x: "min",
  y: "min",
  z: "max",
};

function setup(changes: Partial<Setup> = {}): Setup {
  return {
    id: "s1",
    name: "Setup 1",
    bodies: ["b1"],
    stock: {
      kind: "boxAround",
      margins: { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 0 },
    },
    wcs: {
      origin: topLeft,
      axes: { x: "+x", z: "+z" },
      offsetIndex: 1,
      machine: { kind: "unknown" },
    },
    safeHeight: 15,
    clearance: 3,
    tolerance: 0.01,
    fixtures: [],
    ...changes,
  };
}

function wcs(changes: Partial<Wcs>): Wcs {
  return { ...setup().wcs, ...changes };
}

function close(actual: number[], expected: number[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 9));
}

function unit(axis: Axis): Xyz {
  const v: Xyz = [0, 0, 0];
  v["xyz".indexOf(axis[1]!)] = axis[0] === "+" ? 1 : -1;
  return v;
}

function dot(a: Xyz, b: Xyz): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

describe("setup types", () => {
  it("match the KIT placement and REF vertex reference", () => {
    expectTypeOf<Placement>().toEqualTypeOf<KitPlacement>();
    expectTypeOf<VertexRef>().toEqualTypeOf<KitVertexRef>();
  });
});

describe("stockBox", () => {
  it("adds six margins around the bodies", () => {
    const margins = { xMin: 1, xMax: 2, yMin: 3, yMax: 4, zMin: 5, zMax: 6 };
    const result = stockBox(setup({ stock: { kind: "boxAround", margins } }), {
      b1: plate,
    });
    expect(result.min).toEqual([0, 0, -31]);
    expect(result.max).toEqual([103, 57, 0]);
  });

  it("reads only the setup bodies, by stable id", () => {
    const result = stockBox(setup({ bodies: ["b1", "b2"] }), {
      b1: plate,
      b2: { min: [-10, 20, 0], max: [0, 80, 30] },
      b3: { min: [500, 500, 500], max: [600, 600, 600] },
    });
    expect(result.min).toEqual([0, 0, -30]);
    expect(result.max).toEqual([110, 80, 0]);
  });

  it("names a setup body with no box and refuses no bodies", () => {
    expect(() =>
      stockBox(setup({ bodies: ["b1", "gone"] }), { b1: plate }),
    ).toThrow("setup body gone has no box");
    expect(() => stockBox(setup({ bodies: [] }), { b1: plate })).toThrow(
      "setup has no bodies",
    );
  });

  it("centres a fixed box on the bodies and sits it on their bottom", () => {
    const result = stockBox(
      setup({
        stock: { kind: "box", size: [120, 60, 25] },
        wcs: wcs({
          origin: { kind: "stockCorner", x: "min", y: "min", z: "min" },
        }),
      }),
      { b1: plate },
    );
    expect(result.min).toEqual([0, 0, 0]);
    expect(result.max).toEqual([120, 60, 25]);
    close(Kit.applyToPoint(result.modelToSetup, [0, 0, 0]), [10, 5, 0]);
  });

  it("stands a cylinder on setup Z around the bodies", () => {
    const result = stockBox(
      setup({ stock: { kind: "cylinder", diameter: 80, height: 30 } }),
      { b1: { min: [-20, -20, 0], max: [20, 20, 10] } },
    );
    expect(result.min).toEqual([0, 0, -30]);
    expect(result.max).toEqual([80, 80, 0]);
    close(Kit.applyToPoint(result.modelToSetup, [0, 0, 10]), [40, 40, -20]);
  });

  it("turns the part over when machining Z points down the model", () => {
    const result = stockBox(
      setup({ wcs: wcs({ axes: { x: "+x", z: "-z" } }) }),
      { b1: plate },
    );
    expect(result.min).toEqual([0, 0, -20]);
    expect(result.max).toEqual([100, 50, 0]);
    close(Kit.applyToPoint(result.modelToSetup, [10, 5, 3]), [10, 45, -3]);
  });

  it("puts the origin on a resolved reference plus an offset", () => {
    const origin: Wcs["origin"] = {
      kind: "reference",
      ref: { kind: "vertex", bodyId: "b1", vertexName: "v1" },
      offset: [0, 0, 5],
    };
    const result = stockBox(
      setup({ wcs: wcs({ origin }) }),
      { b1: plate },
      [10, 10, 20],
    );
    expect(result.min).toEqual([-10, -10, -25]);
    expect(result.max).toEqual([90, 40, -5]);
    expect(() =>
      stockBox(setup({ wcs: wcs({ origin }) }), { b1: plate }),
    ).toThrow("the WCS reference needs its resolved point");
  });

  it("builds a KIT placement for every orientation of the setup axes", () => {
    const axes: Axis[] = ["+x", "-x", "+y", "-y", "+z", "-z"];
    const p: Xyz = [7, -3, 11];
    let orientations = 0;
    for (const x of axes)
      for (const z of axes) {
        const s = setup({ wcs: wcs({ axes: { x, z } }) });
        if (x[1] === z[1]) {
          expect(() => stockBox(s, { b1: plate })).toThrow(
            "setup X and Z axes must be perpendicular",
          );
          continue;
        }
        orientations++;
        const [X, Z] = [unit(x), unit(z)];
        const Y: Xyz = [
          Z[1] * X[2] - Z[2] * X[1],
          Z[2] * X[0] - Z[0] * X[2],
          Z[0] * X[1] - Z[1] * X[0],
        ];
        const result = stockBox(s, { b1: plate });
        const corner = Kit.applyToPoint(result.modelToSetup, [0, 0, 0]);
        close(
          Kit.applyToPoint(result.modelToSetup, p),
          [X, Y, Z].map((axis, i) => dot(axis, p) + corner[i]!),
        );
        close(
          [0, 1, 2].map((i) => result.max[i]! - result.min[i]!),
          [X, Y, Z].map((axis) => Math.abs(dot(axis, [100, 50, 20]))),
        );
      }
    expect(orientations).toBe(24);
  });
});

describe("checkTravel", () => {
  const travel: Box = { min: [-400, -300, -100], max: [0, 0, 0] };
  const part: Box = { min: [0, 0, -20], max: [100, 50, 0] };

  it("never claims travel was verified with an unknown machine offset", () => {
    const tiny: Box = { min: [0, 0, 0], max: [0, 0, 0] };
    const huge: Box = { min: [-1e9, -1e9, -1e9], max: [1e9, 1e9, 1e9] };
    expect(checkTravel(setup().wcs, tiny, huge)).toEqual({
      status: "unverified",
    });
  });

  it("maps the WCS into machine coordinates through the known offset", () => {
    const at = (origin: Xyz) =>
      checkTravel(wcs({ machine: { kind: "known", origin } }), part, travel);
    expect(at([-300, -200, -40])).toEqual({ status: "within" });
    expect(at([-350, -20, 10])).toEqual({
      status: "outside",
      axes: ["y", "z"],
    });
  });
});
