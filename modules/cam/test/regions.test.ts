import { beforeAll, describe, expect, it } from "vitest";
import { arcSweep, type Xy } from "../src/shared/ir.js";
import { stockBox, type Placement, type Setup } from "../src/shared/setup.js";
import type {
  Regions,
  RegionLoop,
  RegionsInput,
} from "../src/kernel/regions.js";
import {
  SAME,
  box,
  brep,
  cut,
  cylinder,
  moduleJob,
  oc,
  startKernel,
  type Own,
  type Shape,
} from "./helpers/kernel.js";

const ENTRY = new URL("../src/kernel/regions.ts", import.meta.url).href;

beforeAll(startKernel, 120_000);

function turned(own: Own, shape: Shape): Shape {
  const trsf = own(new oc.gp_Trsf_1());
  trsf.SetRotation_2(
    own(new oc.gp_Quaternion_2(-Math.SQRT1_2, 0, 0, Math.SQRT1_2)),
  );
  return own(
    own(new oc.BRepBuilderAPI_Transform_2(shape, trsf, true, false)).Shape(),
  );
}

const pocketBlock = (own: Own) =>
  cut(
    own,
    box(own, [0, 0, 0], [60, 40, 10]),
    box(own, [20, 15, 5], [20, 10, 5]),
  );

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

const CORNERS: Xy[] = [
  [22, 17],
  [38, 17],
  [38, 23],
  [22, 23],
];

const roundedPocketBlock = (own: Own) =>
  CORNERS.reduce(
    (body, [x, y]) => cut(own, body, cylinder(own, [x, y, 5], [0, 0, 1], 2)),
    cut(
      own,
      cut(
        own,
        box(own, [0, 0, 0], [60, 40, 10]),
        box(own, [22, 15, 5], [16, 10, 5]),
      ),
      box(own, [20, 17, 5], [20, 6, 5]),
    ),
  );

const holeBlock = (own: Own) =>
  cut(
    own,
    box(own, [0, 0, 0], [60, 40, 10]),
    cylinder(own, [30, 20, 5], [0, 0, 1], 4),
  );

function regions(input: RegionsInput) {
  return moduleJob(ENTRY, "rockett.cam.regions", input) as Promise<Regions>;
}

function signedArea({ start, segments }: RegionLoop): number {
  let from: Xy = start;
  let twice = 0;
  for (const segment of segments) {
    const [x, y] = segment.to;
    if (segment.kind === "line") twice += from[0] * y - x * from[1];
    else {
      const [cx, cy] = segment.centre;
      const sweep = arcSweep([...from, 0], {
        kind: "arc",
        to: [x, y, 0],
        centre: [cx, cy, 0],
        dir: segment.dir,
        plane: "xy",
        feed: 1,
        role: "cut",
      });
      const r = Math.hypot(from[0] - cx, from[1] - cy);
      twice +=
        cx * (y - from[1]) -
        cy * (x - from[0]) +
        r * r * (segment.dir === "ccw" ? sweep : -sweep);
    }
    from = segment.to;
  }
  return twice / 2;
}

const area = (loop: RegionLoop) => Math.abs(signedArea(loop));

function turnedSetup(): Placement {
  const setup: Setup = {
    id: "s1",
    name: "Setup 1",
    bodies: ["b1"],
    stock: {
      kind: "boxAround",
      margins: { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 0 },
    },
    wcs: {
      origin: { kind: "stockCorner", x: "min", y: "min", z: "min" },
      axes: { x: "+x", z: "+y" },
      offsetIndex: 1,
      machine: { kind: "unknown" },
    },
    safeHeight: 15,
    clearance: 3,
    tolerance: 0.01,
    fixtures: [],
  };
  return stockBox(setup, { b1: { min: [0, 0, -40], max: [60, 10, 0] } })
    .modelToSetup;
}

function expectAreas(loops: RegionLoop[], wanted: number[]) {
  expect(loops).toHaveLength(wanted.length);
  expect(loops.map(area)).toEqual(
    expect.arrayContaining(wanted.map((value) => expect.closeTo(value, 9))),
  );
}

describe("rockett.cam.regions", () => {
  it("a 60 by 40 by 10 block with a 20 by 10 by 5 pocket gives floors 10 and 5 and one loop of area 200", async () => {
    const found = await regions({
      brep: brep(pocketBlock),
      modelToSetup: SAME,
      z: [7.5, 12],
    });
    expect(found.floors).toEqual([10, 5]);
    expect(found.sections.map(({ z }) => z)).toEqual([7.5, 12]);
    expect(found.sections[1]!.loops).toEqual([]);
    const loops = found.sections[0]!.loops;
    expect(
      loops.filter((loop) => Math.abs(area(loop) - 200) < 1e-9),
    ).toHaveLength(1);
    expectAreas(loops, [200, 2400]);
    for (const loop of loops)
      expect(loop.segments.every(({ kind }) => kind === "line")).toBe(true);
    const pocket = loops.find((loop) => area(loop) < 1000)!;
    expect(pocket.segments.map(({ to }) => to)).toHaveLength(4);
    expect(pocket.segments.map(({ to }) => to)).toEqual(
      expect.arrayContaining([
        [20, 15],
        [40, 15],
        [40, 25],
        [20, 25],
      ]),
    );
  });

  it("finds floors 10 and 5 on the pocket block mirrored through a plane", async () => {
    const found = await regions({
      brep: brep((own) => mirrored(own, pocketBlock(own))),
      modelToSetup: SAME,
      z: [7.5],
    });
    expect(found.floors).toEqual([10, 5]);
    expectAreas(found.sections[0]!.loops, [200, 2400]);
  });

  it.each([
    ["in the model frame", roundedPocketBlock, () => SAME, 1],
    [
      "in a turned setup",
      (own: Own) => turned(own, roundedPocketBlock(own)),
      turnedSetup,
      1,
    ],
    [
      "on a mirrored body",
      (own: Own) => mirrored(own, roundedPocketBlock(own)),
      () => SAME,
      -1,
    ],
  ] as const)(
    "keeps rounded pocket corners as arcs with their centres and turn %s",
    async (_, make, frame, y) => {
      const found = await regions({
        brep: brep(make),
        modelToSetup: frame(),
        z: [7.5],
      });
      const pocket = found.sections[0]!.loops.find(
        (loop) => area(loop) < 1000,
      )!;
      expect(area(pocket)).toBeCloseTo(184 + 4 * Math.PI, 9);
      const turn = signedArea(pocket) > 0 ? "ccw" : "cw";
      const arcs = pocket.segments.flatMap((segment, index) =>
        segment.kind === "arc"
          ? [{ ...segment, from: pocket.segments.at(index - 1)!.to }]
          : [],
      );
      expect(arcs).toHaveLength(4);
      for (const arc of arcs) {
        expect(arc.dir).toBe(turn);
        for (const end of [arc.from, arc.to])
          expect(
            Math.hypot(end[0] - arc.centre[0], end[1] - arc.centre[1]),
          ).toBeCloseTo(2, 9);
      }
      expect(
        arcs.map(({ centre }) => centre.map((v) => Math.round(v * 1e6) / 1e6)),
      ).toEqual(
        expect.arrayContaining(CORNERS.map(([cx, cy]) => [cx, cy * y])),
      );
    },
  );

  it("keeps a round pocket wall as arcs about its axis", async () => {
    const found = await regions({
      brep: brep(holeBlock),
      modelToSetup: SAME,
      z: [7.5, 2],
    });
    expect(found.floors).toEqual([10, 5]);
    const [upper, lower] = found.sections;
    expectAreas(upper!.loops, [16 * Math.PI, 2400]);
    const hole = upper!.loops.find((loop) => area(loop) < 100)!;
    for (const segment of hole.segments) {
      expect(segment.kind).toBe("arc");
      if (segment.kind !== "arc") continue;
      expect(segment.centre[0]).toBeCloseTo(30, 9);
      expect(segment.centre[1]).toBeCloseTo(20, 9);
      expect(Math.hypot(segment.to[0] - 30, segment.to[1] - 20)).toBeCloseTo(
        4,
        9,
      );
    }
    expectAreas(lower!.loops, [2400]);
  });

  it("reads floors and loops in the setup frame, not the model frame", async () => {
    const modelToSetup = turnedSetup();
    const found = await regions({
      brep: brep((own) => turned(own, pocketBlock(own))),
      modelToSetup,
      z: [7.5],
    });
    expect(found.floors).toEqual([expect.closeTo(10, 9), expect.closeTo(5, 9)]);
    const pocket = found.sections[0]!.loops.find((loop) => area(loop) < 1000)!;
    expect(area(pocket)).toBeCloseTo(200, 9);
    const xs = pocket.segments.map(({ to }) => to[0]);
    const ys = pocket.segments.map(({ to }) => to[1]);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([
      expect.closeTo(20, 9),
      expect.closeTo(40, 9),
    ]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([
      expect.closeTo(15, 9),
      expect.closeTo(25, 9),
    ]);
  });

  it("refuses a section edge that is neither a line nor an arc, never approximating it", async () => {
    const tilted = brep((own) =>
      cut(
        own,
        box(own, [0, 0, 0], [60, 40, 10]),
        cylinder(own, [30, 20, -2], [1, 0, 1], 4),
      ),
    );
    await expect(
      regions({ brep: tilted, modelToSetup: SAME, z: [5] }),
    ).rejects.toThrow(
      "section at Z 5 has an edge of type Ellipse, not a line or arc",
    );
  });

  it("refuses input that is not a BREP body", async () => {
    await expect(
      regions({ brep: "not a shape", modelToSetup: SAME, z: [5] }),
    ).rejects.toThrow("regions input is not a readable BREP body");
  });
});
