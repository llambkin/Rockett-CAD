import { describe, expect, it } from "vitest";
import { importDxf } from "../src/importDxf.js";
import type { SketchEntity, SketchFeature, SketchPoint } from "../src/model.js";
import { crossingEllipses } from "../src/curveLimits.js";
import { detectProfiles } from "../src/profiles.js";
import { solveSketch } from "../src/solver.js";
import {
  extendSketch,
  offsetSketch,
  offsetSketchSelection,
} from "../src/sketchModify.js";
import { createSketchOffset } from "../src/sketchOffsets.js";
import { trimmable, trimSketch } from "../src/sketchTrim.js";

const TAU = 2 * Math.PI;

const dxf = (...records: (string | number)[][]) =>
  ["0", "SECTION", "2", "ENTITIES", ...records.flat(), "0", "ENDSEC"]
    .map(String)
    .join("\n");

const ellipseRecord = (
  [cx, cy]: [number, number],
  [mx, my]: [number, number],
  ratio: number,
  start = 0,
  end = TAU,
) => [
  0,
  "ELLIPSE",
  8,
  "0",
  10,
  cx,
  20,
  cy,
  30,
  0,
  11,
  mx,
  21,
  my,
  31,
  0,
  210,
  0,
  220,
  0,
  230,
  1,
  40,
  ratio,
  41,
  start,
  42,
  end,
];

const P = (id: string, x: number, y: number): SketchPoint => ({
  id,
  kind: "point",
  x,
  y,
});

function ellipse(
  id: string,
  [cx, cy]: [number, number],
  a: number,
  b: number,
  angle = 0,
): SketchEntity[] {
  const [ux, uy] = [Math.cos(angle), Math.sin(angle)];
  return [
    P(`${id}c`, cx, cy),
    P(`${id}m`, cx + a * ux, cy + a * uy),
    P(`${id}n`, cx - b * uy, cy + b * ux),
    {
      id,
      kind: "ellipse",
      center: `${id}c`,
      major: `${id}m`,
      minor: `${id}n`,
    } as unknown as SketchEntity,
  ];
}

function rect(x: number, y: number, w: number, h: number): SketchEntity[] {
  const corners: [number, number][] = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
  return [
    ...corners.map(([px, py], i) => P(`r${i}`, px, py)),
    ...corners.map((_, i): SketchEntity => ({
      id: `rl${i}`,
      kind: "line",
      p1: `r${i}`,
      p2: `r${(i + 1) % 4}`,
    })),
  ];
}

const at = (entities: SketchEntity[], id: string) => {
  const p = entities.find((e) => e.id === id);
  if (p?.kind !== "point") throw new Error(`no point ${id}`);
  return p;
};

function axisCosine(entities: SketchEntity[], id: string): number {
  const c = at(entities, `${id}c`);
  const m = at(entities, `${id}m`);
  const n = at(entities, `${id}n`);
  const [ux, uy, vx, vy] = [m.x - c.x, m.y - c.y, n.x - c.x, n.y - c.y];
  return (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
}

describe("DXF ellipse import", () => {
  it("imports a closed 20 by 10 ellipse as one exact sketch ellipse", () => {
    const imported = importDxf(dxf(ellipseRecord([5, 3], [10, 0], 0.5)));
    expect(imported.skipped).toBe(0);
    const curves = imported.entities.filter((e) => e.kind !== "point");
    expect(curves).toHaveLength(1);
    const [curve] = curves as unknown as {
      kind: string;
      center: string;
      major: string;
      minor: string;
    }[];
    expect(curve!.kind).toBe("ellipse");
    const xy = (id: string) => {
      const p = at(imported.entities, id);
      return [p.x, p.y];
    };
    expect(xy(curve!.center)).toEqual([5, 3]);
    expect(xy(curve!.major)).toEqual([15, 3]);
    expect(xy(curve!.minor)).toEqual([5, 8]);
    expect(imported.entities).toHaveLength(4);
  });

  it("keeps a rotated ellipse's minor axis perpendicular", () => {
    const imported = importDxf(dxf(ellipseRecord([0, 0], [6, 8], 0.5)));
    expect(imported.skipped).toBe(0);
    const curve = imported.entities.find(
      (e) => e.kind !== "point",
    ) as unknown as {
      minor: string;
    };
    const n = at(imported.entities, curve.minor);
    expect(Math.hypot(n.x, n.y)).toBeCloseTo(5, 12);
    expect(n.x * 6 + n.y * 8).toBeCloseTo(0, 12);
  });

  it("accepts a full turn written to five decimals", () => {
    const imported = importDxf(
      dxf(ellipseRecord([0, 0], [10, 0], 0.5, 0, 6.28319)),
    );
    expect(imported.skipped).toBe(0);
    expect(imported.entities).toHaveLength(4);
  });

  it("counts invalid ratios as skipped", () => {
    const imported = importDxf(
      dxf(
        ellipseRecord([0, 0], [10, 0], 1.5),
        ellipseRecord([0, 0], [10, 0], 0),
        ellipseRecord([0, 0], [0, 0], 0.5),
      ),
    );
    expect(imported).toEqual({ entities: [], skipped: 3 });
  });
});

describe("ellipse solver inputs", () => {
  const base = ellipse("e", [0, 0], 10, 5);
  for (const [input, x, y] of [
    ["ec", 3, -2],
    ["em", 8, 6],
    ["en", 1, 7],
  ] as const) {
    it(`drags ${input} and keeps the axes perpendicular`, () => {
      const solved = solveSketch({
        entities: base,
        constraints: [],
        drag: { pointId: input, x, y },
      });
      expect(solved.converged).toBe(true);
      const moved = at(solved.entities, input);
      expect(Math.hypot(moved.x - x, moved.y - y)).toBeLessThan(1e-3);
      expect(Math.abs(axisCosine(solved.entities, "e"))).toBeLessThan(1e-6);
    });
  }
});

describe("ellipse profiles", () => {
  it("gives a lone ellipse one closed region", () => {
    const profiles = detectProfiles(ellipse("e", [0, 0], 10, 5));
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.outer).toEqual([{ entityId: "e", reversed: false }]);
    expect(profiles[0]!.holes).toEqual([]);
    expect(profiles[0]!.area).toBeCloseTo(Math.PI * 50, -1);
  });

  it("nests an elliptical hole in a rectangle and in a larger ellipse", () => {
    const plate = detectProfiles([
      ...rect(-20, -15, 40, 30),
      ...ellipse("e", [0, 0], 10, 5, 0.3),
    ]);
    expect(plate).toHaveLength(2);
    const outer = plate.find((p) => p.outer.length === 4)!;
    expect(outer.holes).toEqual([[{ entityId: "e", reversed: false }]]);

    const ring = detectProfiles([
      ...ellipse("o", [0, 0], 15, 8),
      ...ellipse("e", [1, 0], 10, 5, 0.1),
    ]);
    const big = ring.find((p) => p.outer[0]!.entityId === "o")!;
    expect(big.holes).toEqual([[{ entityId: "e", reversed: false }]]);
  });

  it("refuses an ellipse that crosses a circle instead of omitting it silently", () => {
    const entities = [
      ...ellipse("e", [0, 0], 10, 5),
      P("oc", 10, 0),
      { id: "o", kind: "circle", center: "oc", radius: 3 } as SketchEntity,
    ];
    expect(crossingEllipses(entities)).toEqual(["e"]);
    for (const p of detectProfiles(entities))
      expect(JSON.stringify(p)).not.toContain('"e"');
    expect(crossingEllipses(ellipse("e", [0, 0], 10, 5))).toEqual([]);
  });
});

describe("ellipse tangency", () => {
  const turn = 0.3;
  const rot = (x: number, y: number): [number, number] => [
    1 + x * Math.cos(turn) - y * Math.sin(turn),
    2 + x * Math.sin(turn) + y * Math.cos(turn),
  ];
  const base = ellipse("e", [1, 2], 10, 5, turn);
  const circle = (x: number, y: number, radius: number): SketchEntity[] => [
    P("oc", ...rot(x, y)),
    { id: "o", kind: "circle", center: "oc", radius },
  ];
  const arc = (x: number, y: number, r: number): SketchEntity[] => {
    const on = (deg: number) =>
      rot(
        x + r * Math.cos((deg * Math.PI) / 180),
        y + r * Math.sin((deg * Math.PI) / 180),
      );
    return [
      P("ac", ...rot(x, y)),
      P("as", ...on(100)),
      P("ae", ...on(260)),
      { id: "o", kind: "arc", center: "ac", start: "as", end: "ae" },
    ];
  };

  for (const [name, other] of [
    ["an outside circle", circle(15, 0, 5)],
    ["an inside circle", circle(0, 0, 5)],
    ["a circle on the minor axis", circle(0, 8, 3)],
    ["an outside arc", arc(15, 0, 5)],
  ] as const)
    it(`refuses an ellipse tangent to ${name}`, () => {
      expect(crossingEllipses([...base, ...other])).toEqual(["e"]);
    });

  it("keeps an ellipse 1 mm clear of a circle", () => {
    expect(crossingEllipses([...base, ...circle(16, 0, 5)])).toEqual([]);
    expect(crossingEllipses([...base, ...circle(0, 0, 4)])).toEqual([]);
  });
});

describe("unsupported ellipse operations", () => {
  const entities = [
    ...ellipse("e", [0, 0], 10, 5),
    P("a", 20, 0),
    P("b", 30, 0),
    { id: "l", kind: "line", p1: "a", p2: "b" } as SketchEntity,
  ];
  const sketch: SketchFeature = {
    id: "sk",
    type: "sketch",
    name: "Sketch",
    suppressed: false,
    plane: { kind: "origin", plane: "XY" },
    entities,
    constraints: [],
  };
  const before = structuredClone(entities);
  const cases: [string, () => unknown, RegExp][] = [
    ["trim", () => trimSketch(entities, [], "e", { x: 10, y: 0 }), /ellipse/i],
    [
      "extend",
      () => extendSketch(entities, [], "e", { x: 10, y: 0 }),
      /ellipse/i,
    ],
    [
      "extend past",
      () => extendSketch(entities, [], "l", { x: 20, y: 0 }),
      /ellipse/i,
    ],
    ["offset", () => offsetSketch(entities, [], "e", 1), /ellipse/i],
    [
      "offset chain",
      () => offsetSketchSelection(entities, [], ["e", "l"], 1),
      /Select connected lines and arcs/,
    ],
    ["offset feature", () => createSketchOffset(sketch, ["e"], 1), /ellipse/i],
  ];
  for (const [name, run, refusal] of cases)
    it(`refuses ${name} and leaves the sketch unchanged`, () => {
      expect(run).toThrow(refusal);
      expect(entities).toEqual(before);
    });

  it("refuses trimming a circle at a crossing ellipse", () => {
    const crossed = [
      ...ellipse("e", [0, 0], 10, 5),
      P("oc", 10, 0),
      { id: "o", kind: "circle", center: "oc", radius: 3 } as SketchEntity,
    ];
    const copy = structuredClone(crossed);
    expect(() => trimSketch(crossed, [], "o", { x: 13, y: 0 })).toThrow(
      /ellipse/i,
    );
    expect(crossed).toEqual(copy);
    const circle = crossed.find((e) => e.id === "o");
    expect(trimmable(crossed, circle)).toBe(false);
    expect(
      trimmable(
        crossed,
        crossed.find((e) => e.id === "e"),
      ),
    ).toBe(false);
    expect(trimmable(crossed.slice(4), circle)).toBe(true);
  });
});
