import { beforeAll, describe, expect, it } from "vitest";
import { validateProgram, type Cycle, type Xy } from "../src/shared/ir.js";
import type { Placement } from "../src/shared/setup.js";
import type { Preset, Tool } from "../src/shared/tools.js";
import type { Hole, HolesInput } from "../src/kernel/holes.js";
import { drill, type DrillInput } from "../src/toolpath/drill.js";
import {
  SAME,
  box,
  brep,
  cut,
  cylinder,
  fuse,
  moduleJob,
  oc,
  startKernel,
  type Own,
  type Shape,
} from "./helpers/kernel.js";

const ENTRY = new URL("../src/kernel/holes.ts", import.meta.url).href;

beforeAll(startKernel, 120_000);

const holes = (input: HolesInput) =>
  moduleJob(ENTRY, "rockett.cam.holes", input) as Promise<Hole[]>;

const preset: Preset = {
  id: "p1",
  name: "Drill steel",
  rpm: 3000,
  cutFeed: 300,
  plungeFeed: 120,
  rampFeed: 120,
  stepdown: 2,
  stepoverFraction: 1,
  coolant: "flood",
};

function drillTool(id: string, diameter: number): Tool {
  return {
    id,
    name: `${diameter} mm drill`,
    kind: "drill",
    diameter,
    fluteLength: 30,
    overallLength: 60,
    shankDiameter: diameter,
    flutes: 2,
    centreCutting: true,
    tipAngle: 118,
  };
}

const flat: Tool = {
  id: "f5",
  name: "5 mm flat",
  kind: "flat",
  diameter: 5,
  fluteLength: 20,
  overallLength: 50,
  shankDiameter: 5,
  flutes: 2,
  centreCutting: true,
};

const HOLES: [number, number, number][] = [
  [45, 10, 1.5],
  [15, 30, 1.5],
  [50, 30, 2.5],
  [10, 20, 2.5],
];

const plate = (
  own: Own,
  size: number[],
  axis: number[],
  at: (x: number, y: number) => number[],
) =>
  HOLES.reduce<Shape>(
    (body, [x, y, r]) => cut(own, body, cylinder(own, at(x, y), axis, r)),
    box(own, [0, 0, 0], size),
  );

const upright = (own: Own) =>
  plate(own, [60, 40, 10], [0, 0, 1], (x, y) => [x, y, -5]);

const close = (points: Xy[]) =>
  points.map(([x, y]) => [expect.closeTo(x, 9), expect.closeTo(y, 9)]);

const hole = (centre: Xy, bottom = 0): Hole => ({
  centre,
  diameter: 3,
  top: 10,
  bottom,
  blocked: false,
});

const pierced = (own: Own, at: number[], axis: number[], r = 1.5) =>
  cut(own, box(own, [0, 0, 0], [60, 40, 10]), cylinder(own, at, axis, r));

function half(own: Own, x: number, z = -5, height = 20) {
  const frame = own(
    new oc.gp_Ax2_2(
      own(new oc.gp_Pnt_3(20, 20, z)),
      own(new oc.gp_Dir_5(0, 0, 1)),
      own(new oc.gp_Dir_5(x, 0, 0)),
    ),
  );
  return own(
    own(new oc.BRepPrimAPI_MakeCylinder_4(frame, 1.5, height, Math.PI)).Shape(),
  );
}

function mirrored(own: Own, shape: Shape): Shape {
  const trsf = own(new oc.gp_Trsf_1());
  trsf.SetMirror_3(
    own(
      new oc.gp_Ax2_4(
        own(new oc.gp_Pnt_3(0, 0, 0)),
        own(new oc.gp_Dir_5(0, 1, 0)),
      ),
    ),
  );
  return own(
    own(new oc.BRepBuilderAPI_Transform_2(shape, trsf, true, false)).Shape(),
  );
}

const holesOf = (make: (own: Own) => Shape) =>
  holes({ brep: brep(make), modelToSetup: SAME });

const at = (x: number, y: number, top = 10, bottom = 0) => ({
  centre: [expect.closeTo(x, 9), expect.closeTo(y, 9)],
  diameter: expect.closeTo(3, 9),
  top: expect.closeTo(top, 9),
  bottom: expect.closeTo(bottom, 9),
  blocked: false,
});

function operation(found: Hole[], changes: Partial<DrillInput> = {}) {
  return drill({
    operationId: "op1",
    setup: { safeHeight: 15, clearance: 3 },
    stock: { min: [0, 0, 0], max: [60, 40, 10] },
    holes: found,
    drills: [
      { tool: flat, preset },
      { tool: drillTool("d5", 5.004), preset },
      { tool: drillTool("d3", 3), preset },
    ],
    ...changes,
  });
}

const cycles = (result: ReturnType<typeof drill>) =>
  result.sections.map((section) => {
    const found = section.moves.filter(
      (move): move is Cycle => move.kind === "cycle",
    );
    expect(found).toHaveLength(1);
    return { toolId: section.toolId, cycle: found[0]! };
  });

describe("rockett.cam.drill", () => {
  it("a plate with two 3 mm and two 5 mm holes gives two cycles of two points", async () => {
    const result = operation(
      await holes({ brep: brep(upright), modelToSetup: SAME }),
    );
    expect(result.refused).toEqual([]);
    const found = cycles(result);
    expect(found.map(({ toolId }) => toolId)).toEqual(["d3", "d5"]);
    expect(found[0]!.cycle).toEqual({
      kind: "cycle",
      cycle: "drill",
      points: close([
        [15, 30],
        [45, 10],
      ]),
      clear: expect.closeTo(13, 9),
      top: expect.closeTo(10, 9),
      bottom: expect.closeTo(0, 9),
      feed: 120,
    });
    expect(found[1]!.cycle.points).toEqual(
      close([
        [10, 20],
        [50, 30],
      ]),
    );
    expect(result.sections[0]!.moves[0]).toEqual({
      kind: "rapid",
      to: [expect.closeTo(15, 9), expect.closeTo(30, 9), 25],
    });
    expect(result.sections[0]!.moves.at(-1)).toEqual({
      kind: "rapid",
      to: [expect.closeTo(45, 9), expect.closeTo(10, 9), 25],
    });
    expect(
      validateProgram({
        irVersion: 1,
        units: "mm",
        setupId: "s1",
        offsetIndex: 1,
        tools: [
          { ...drillTool("d3", 3), number: 1 },
          { ...drillTool("d5", 5.004), number: 2 },
        ],
        sections: result.sections,
      }),
    ).toEqual([]);
  });

  it("finds holes along model Y once the setup turns Y up", async () => {
    const text = brep((own) =>
      plate(own, [60, 10, 40], [0, 1, 0], (x, y) => [x, -5, y]),
    );
    expect(await holes({ brep: text, modelToSetup: SAME })).toEqual([]);
    const turned: Placement = {
      rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
      translation: [0, 0, 0],
    };
    const found = await holes({ brep: text, modelToSetup: turned });
    expect(
      cycles(operation(found)).map(({ cycle: { points, top, bottom } }) => ({
        points,
        top,
        bottom,
      })),
    ).toEqual([
      {
        points: close([
          [15, -30],
          [45, -10],
        ]),
        top: expect.closeTo(10, 9),
        bottom: expect.closeTo(0, 9),
      },
      {
        points: close([
          [10, -20],
          [50, -30],
        ]),
        top: expect.closeTo(10, 9),
        bottom: expect.closeTo(0, 9),
      },
    ]);
  });

  it("ignores a pin and a half hole cut through an edge", async () => {
    expect(
      await holes({
        brep: brep((own) => cylinder(own, [10, 10, 0], [0, 0, 1], 2)),
        modelToSetup: SAME,
      }),
    ).toEqual([]);
    expect(
      await holes({
        brep: brep((own) =>
          cut(
            own,
            box(own, [0, 0, 0], [60, 40, 10]),
            cylinder(own, [0, 20, -5], [0, 0, 1], 3),
          ),
        ),
        modelToSetup: SAME,
      }),
    ).toEqual([]);
  });

  it("orders points nearest-neighbour from the WCS origin and pecks", () => {
    const [found] = cycles(
      operation([hole([0, 12]), hole([20, 0]), hole([10, 0])], { peck: 2 }),
    );
    expect(found!.cycle).toMatchObject({
      cycle: "peck",
      peck: 2,
      points: [
        [10, 0],
        [20, 0],
        [0, 12],
      ],
    });
  });

  it("splits a group into one cycle per depth", () => {
    const result = operation([hole([10, 0]), hole([20, 0], 4)]);
    const moves = result.sections[0]!.moves.filter(
      (move): move is Cycle => move.kind === "cycle",
    );
    expect(moves.map(({ bottom, points }) => [bottom, points])).toEqual([
      [0, [[10, 0]]],
      [4, [[20, 0]]],
    ]);
  });

  it("reports a group with no drill within 0.01 mm and drills the rest", async () => {
    const result = operation(
      await holes({ brep: brep(upright), modelToSetup: SAME }),
      {
        drills: [
          { tool: drillTool("d3", 3.008), preset },
          { tool: drillTool("d5", 5.02), preset },
          { tool: flat, preset },
        ],
      },
    );
    expect(cycles(result).map(({ toolId }) => toolId)).toEqual(["d3"]);
    expect(result.refused).toEqual([
      {
        reason: "noDrill",
        diameter: expect.closeTo(5, 9),
        points: [
          [expect.closeTo(10, 9), expect.closeTo(20, 9)],
          [expect.closeTo(50, 9), expect.closeTo(30, 9)],
        ],
      },
    ]);
  });

  it("refuses a peck it cannot cut", () => {
    for (const peck of [0, Number.NaN, Infinity])
      expect(() => operation([hole([0, 0])], { peck })).toThrow(RangeError);
  });

  it("refuses a hole blind from below and drills the rest", async () => {
    const blind = await holesOf((own) =>
      cut(
        own,
        cut(
          own,
          pierced(own, [45, 10, -5], [0, 0, 1]),
          cylinder(own, [15, 30, -5], [0, 0, 1], 1.5),
        ),
        cylinder(own, [30, 20, 5], [0, 0, -1], 1.5),
      ),
    );
    expect(blind).toHaveLength(3);
    expect(blind).toEqual(
      expect.arrayContaining([
        at(45, 10),
        at(15, 30),
        { ...at(30, 20, 5), blocked: true },
      ]),
    );
    const result = operation(blind);
    expect(cycles(result).map(({ cycle }) => cycle.points)).toEqual([
      close([
        [15, 30],
        [45, 10],
      ]),
    ]);
    expect(result.refused).toEqual([
      {
        reason: "blocked",
        diameter: expect.closeTo(3, 9),
        points: close([[30, 20]]),
      },
    ]);
  });

  it("refuses the lower of two coaxial holes split by a solid web", async () => {
    const webbed = await holesOf((own) =>
      cut(
        own,
        pierced(own, [30, 20, 7], [0, 0, 1]),
        cylinder(own, [30, 20, 3], [0, 0, -1], 1.5),
      ),
    );
    expect(webbed).toHaveLength(2);
    expect(webbed).toEqual(
      expect.arrayContaining([
        at(30, 20, 10, 7),
        { ...at(30, 20, 3), blocked: true },
      ]),
    );
    const result = operation(webbed);
    expect(cycles(result).map(({ cycle }) => cycle.bottom)).toEqual([
      expect.closeTo(7, 9),
    ]);
    expect(result.refused).toEqual([
      {
        reason: "blocked",
        diameter: expect.closeTo(3, 9),
        points: close([[30, 20]]),
      },
    ]);
  });

  it("joins coaxial holes that meet into one", async () => {
    expect(
      await holesOf((own) =>
        cut(
          own,
          pierced(own, [30, 20, 7], [0, 0, 1]),
          cylinder(own, [30, 20, 7], [0, 0, -1], 1.5),
        ),
      ),
    ).toEqual([at(30, 20)]);
  });

  it("refuses a hole under an overhang", async () => {
    expect(
      await holesOf((own) =>
        cut(
          own,
          cut(
            own,
            box(own, [0, 0, 0], [60, 40, 25]),
            box(own, [10, -1, 10], [51, 42, 10]),
          ),
          cylinder(own, [30, 20, -5], [0, 0, 1], 1.5),
        ),
      ),
    ).toEqual([{ ...at(30, 20), blocked: true }]);
  });

  it("refuses a socket with a pin standing in it", async () => {
    const socket = await holesOf((own) =>
      fuse(
        own,
        cut(
          own,
          box(own, [0, 0, 0], [60, 40, 10]),
          cylinder(own, [20, 20, 4], [0, 0, 1], 4),
        ),
        cylinder(own, [20, 20, 4], [0, 0, 1], 1.5, 4),
      ),
    );
    expect(socket).toEqual([
      { ...at(20, 20, 10, 4), diameter: expect.closeTo(8, 9), blocked: true },
    ]);
    expect(operation(socket).sections).toEqual([]);
  });

  it("refuses a bore with a rib across it", async () => {
    const ribbed = await holesOf((own) =>
      fuse(
        own,
        pierced(own, [30, 20, -5], [0, 0, 1]),
        box(own, [28, 19.5, 4], [4, 1, 2]),
      ),
    );
    expect(ribbed).toEqual([{ ...at(30, 20), blocked: true }]);
  });

  it("drills a hole crossed by a side hole", async () => {
    expect(
      await holesOf((own) =>
        cut(
          own,
          pierced(own, [30, 20, -5], [0, 0, 1], 2.5),
          cylinder(own, [-5, 20, 5], [1, 0, 0], 1, 70),
        ),
      ),
    ).toEqual([{ ...at(30, 20), diameter: expect.closeTo(5, 9) }]);
  });

  it("drills a hole in a pocket floor", async () => {
    expect(
      await holesOf((own) =>
        cut(
          own,
          cut(
            own,
            box(own, [0, 0, 0], [60, 40, 10]),
            box(own, [20, 10, 6], [20, 20, 5]),
          ),
          cylinder(own, [30, 20, -5], [0, 0, 1], 1.5),
        ),
      ),
    ).toEqual([at(30, 20, 6)]);
  });

  it("sets R above stock that stands above the hole top", () => {
    const { cycle } = cycles(
      operation([hole([10, 0])], {
        stock: { min: [0, 0, 0], max: [60, 40, 12] },
      }),
    )[0]!;
    expect(cycle).toMatchObject({ clear: 15, top: 10, bottom: 0 });
  });

  it("finds a hole cut along -Z", async () => {
    expect(
      await holesOf((own) => pierced(own, [20, 20, 15], [0, 0, -1])),
    ).toEqual([at(20, 20)]);
  });

  it("keeps a hole under a counterbore open", async () => {
    const bored = await holesOf((own) =>
      cut(
        own,
        pierced(own, [20, 20, -5], [0, 0, 1]),
        cylinder(own, [20, 20, 7], [0, 0, 1], 5),
      ),
    );
    expect(bored).toHaveLength(2);
    expect(bored).toEqual(
      expect.arrayContaining([
        at(20, 20, 7),
        { ...at(20, 20, 10, 7), diameter: expect.closeTo(10, 9) },
      ]),
    );
  });

  it("finds a hole made of two half faces", async () => {
    expect(
      await holesOf((own) =>
        cut(
          own,
          cut(own, box(own, [0, 0, 0], [60, 40, 10]), half(own, 1)),
          half(own, -1),
        ),
      ),
    ).toEqual([at(20, 20)]);
  });

  it("ignores half faces that turn a full circle only across Z", async () => {
    expect(
      await holesOf((own) =>
        cut(
          own,
          cut(own, box(own, [0, 0, 0], [60, 40, 10]), half(own, 1, 5, 10)),
          half(own, -1, -5, 10),
        ),
      ),
    ).toEqual([]);
  });

  it("finds holes in a mirrored plate", async () => {
    expect(
      await holesOf((own) =>
        mirrored(own, pierced(own, [20, 20, -5], [0, 0, 1])),
      ),
    ).toEqual([at(20, -20)]);
  });
});
