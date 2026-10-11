import { describe, expect, it } from "vitest";
import { normalise } from "../src/post/normalise.js";
import type { Post } from "../src/post/schema.js";
import {
  programStats,
  type Move,
  type Program,
  type Section,
  type Xyz,
} from "../src/shared/ir.js";

type Target = Pick<Post, "id" | "capabilities">;

const tool = {
  id: "t1",
  number: 1,
  name: "6 mm flat",
  kind: "flat" as const,
  diameter: 6,
  fluteLength: 20,
  overallLength: 50,
  shankDiameter: 6,
  flutes: 2,
  centreCutting: true,
};

const plain: Target = {
  id: "plain",
  capabilities: { arcs: false, cycles: false, toolChange: false },
};
const full: Target = {
  id: "full",
  capabilities: { arcs: true, cycles: true, toolChange: true },
};

function section(moves: Move[], toolId = "t1"): Section {
  return {
    operationId: "op1",
    toolId,
    pass: "rough",
    spindle: { rpm: 18000, dir: "cw" },
    coolant: "off",
    moves,
  };
}

function program(moves: Move[]): Program {
  return {
    irVersion: 1,
    units: "mm",
    setupId: "s1",
    offsetIndex: 1,
    tools: [tool],
    sections: [section(moves)],
  };
}

function normalised(p: Program, post: Target) {
  return normalise(p, post, { units: "mm" }).files.flatMap((file) =>
    file.flatMap((s) => s.moves),
  );
}

function points(out: Move[]): Xyz[] {
  return out.flatMap((m) =>
    m.kind === "rapid" || m.kind === "feed" ? [m.to] : [],
  );
}

function segmentDistance(p: Xyz, a: Xyz, b: Xyz): number {
  const ab: Xyz = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap: Xyz = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const len = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const t =
    len === 0
      ? 0
      : Math.min(
          1,
          Math.max(0, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len),
        );
  return Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]);
}

function pathError(exact: (t: number) => Xyz, line: Xyz[]): number {
  let worst = 0;
  for (let i = 0; i <= 4000; i++) {
    const p = exact(i / 4000);
    let near = Number.POSITIVE_INFINITY;
    for (let j = 1; j < line.length; j++)
      near = Math.min(near, segmentDistance(p, line[j - 1]!, line[j]!));
    worst = Math.max(worst, near);
  }
  return worst;
}

function onCircle(deg: number): Xyz {
  return [
    10 * Math.cos((deg * Math.PI) / 180),
    10 * Math.sin((deg * Math.PI) / 180),
    0,
  ];
}

function rapidTo(to: Xyz): Move {
  return { kind: "rapid", to };
}

function plunge(to: Xyz): Move {
  return { kind: "feed", to, feed: 200, role: "plunge" };
}

function extent(line: Xyz[], axis: 0 | 1 | 2) {
  const values = line.map((p) => p[axis]);
  return [Math.min(...values), Math.max(...values)];
}

const planeArc = (plane: "xy" | "zx"): Move => ({
  kind: "arc",
  to: plane === "xy" ? [0, 10, 0] : [0, 0, -10],
  centre: [0, 0, 0],
  dir: "ccw",
  plane,
  feed: 600,
  role: "cut",
});

describe("normalise arcs", () => {
  it("expands a full circle through all four extrema within 0.005 mm", () => {
    for (const dir of ["ccw", "cw"] as const) {
      const out = normalised(
        program([
          { kind: "rapid", to: [10, 0, -1] },
          {
            kind: "arc",
            to: [10, 0, -1],
            centre: [0, 0, -1],
            dir,
            plane: "xy",
            feed: 600,
            role: "cut",
          },
        ]),
        plain,
      );
      expect(out.slice(1).every((m) => m.kind === "feed")).toBe(true);
      const line = points(out);
      expect(line.at(-1)).toEqual([10, 0, -1]);
      const [xMin, xMax] = extent(line, 0);
      const [yMin, yMax] = extent(line, 1);
      expect(xMin).toBeCloseTo(-10, 12);
      expect(xMax).toBeCloseTo(10, 12);
      expect(yMin).toBeCloseTo(-10, 12);
      expect(yMax).toBeCloseTo(10, 12);
      expect(extent(line, 2)).toEqual([-1, -1]);
      for (const p of line) expect(Math.hypot(p[0], p[1])).toBeCloseTo(10, 9);
      const sign = dir === "ccw" ? 1 : -1;
      const error = pathError(
        (t) => [
          10 * Math.cos(2 * Math.PI * t),
          sign * 10 * Math.sin(2 * Math.PI * t),
          -1,
        ],
        line,
      );
      expect(error).toBeLessThanOrEqual(0.005);
      expect(error).toBeGreaterThan(0.001);
    }
  });

  it("keeps the quadrant extreme an arc crosses", () => {
    for (const [from, to, dir] of [
      [30, 135, "ccw"],
      [135, 30, "cw"],
    ] as const) {
      const line = points(
        normalised(
          program([
            { kind: "rapid", to: onCircle(from) },
            {
              kind: "arc",
              to: onCircle(to),
              centre: [0, 0, 0],
              dir,
              plane: "xy",
              feed: 600,
              role: "cut",
            },
          ]),
          plain,
        ),
      );
      expect(extent(line, 1)[1]).toBeCloseTo(10, 12);
      expect(line.at(-1)).toEqual(onCircle(to));
      expect(
        pathError((t) => onCircle(from + (to - from) * t), line),
      ).toBeLessThanOrEqual(0.005);
    }
  });

  it("maps a zx arc back to world axes", () => {
    for (const [dir, x] of [
      ["ccw", 10],
      ["cw", -10],
    ] as const) {
      const line = points(
        normalised(
          program([
            { kind: "rapid", to: [0, 3, 10] },
            {
              kind: "arc",
              to: [0, 3, -10],
              centre: [0, 3, 0],
              dir,
              plane: "zx",
              feed: 600,
              role: "cut",
            },
          ]),
          plain,
        ),
      );
      const [xMin, xMax] = extent(line, 0);
      expect(x > 0 ? xMax : xMin).toBeCloseTo(x, 12);
      expect(extent(line, 1)).toEqual([3, 3]);
    }
  });

  it("expands a full-turn helix along its pitch", () => {
    const out = normalised(
      program([
        { kind: "rapid", to: [10, 0, 0] },
        {
          kind: "arc",
          to: [10, 0, -2],
          centre: [0, 0, 0],
          dir: "ccw",
          plane: "xy",
          feed: 600,
          role: "plunge",
          power: 40,
        },
      ]),
      plain,
    );
    expect(out[1]).toMatchObject({ kind: "feed", role: "plunge", power: 40 });
    const line = points(out);
    const z = line.map((p) => p[2]);
    expect(z.every((v, i) => i === 0 || v <= z[i - 1]!)).toBe(true);
    expect(line.at(-1)).toEqual([10, 0, -2]);
    expect(extent(line, 0)[0]).toBeCloseTo(-10, 12);
    const error = pathError(
      (t) => [
        10 * Math.cos(2 * Math.PI * t),
        10 * Math.sin(2 * Math.PI * t),
        -2 * t,
      ],
      line,
    );
    expect(error).toBeLessThanOrEqual(0.005);
  });

  it("keeps arcs for a post with arcs", () => {
    const arc: Move = {
      kind: "arc",
      to: [0, 10, 0],
      centre: [0, 0, 0],
      dir: "ccw",
      plane: "xy",
      feed: 600,
      role: "cut",
    };
    expect(
      normalised(program([{ kind: "rapid", to: [10, 0, 0] }, arc]), full),
    ).toEqual([{ kind: "rapid", to: [10, 0, 0] }, arc]);
  });

  it("keeps only xy arcs for a post with xy arcs", () => {
    const xyOnly: Target = {
      id: "xy",
      capabilities: { arcs: "xy", cycles: false, toolChange: false },
    };
    const start: Move = { kind: "rapid", to: [10, 0, 0] };
    expect(normalised(program([start, planeArc("xy")]), xyOnly)).toEqual([
      start,
      planeArc("xy"),
    ]);
    const out = normalised(program([start, planeArc("zx")]), xyOnly);
    expect(out.slice(1).every((m) => m.kind === "feed")).toBe(true);
    expect(points(out).at(-1)).toEqual([0, 0, -10]);
  });
});

describe("normalise cycles", () => {
  const peck: Move = {
    kind: "cycle",
    cycle: "peck",
    points: [
      [5, 0],
      [5, 5],
    ],
    clear: 2,
    top: 0,
    bottom: -5,
    peck: 2,
    dwell: 0.5,
    feed: 200,
  };

  it("expands a peck cycle that counts down from top and ends at clear", () => {
    const p = program([{ kind: "rapid", to: [0, 0, 10] }, peck]);
    const out = normalised(p, plain);
    const hole = (x: number, y: number): Move[] => [
      plunge([x, y, -2]),
      rapidTo([x, y, 2]),
      rapidTo([x, y, -2]),
      plunge([x, y, -4]),
      rapidTo([x, y, 2]),
      rapidTo([x, y, -4]),
      plunge([x, y, -5]),
      { kind: "dwell", seconds: 0.5 },
      rapidTo([x, y, 2]),
    ];
    expect(out).toEqual([
      rapidTo([0, 0, 10]),
      rapidTo([5, 0, 10]),
      rapidTo([5, 0, 2]),
      ...hole(5, 0),
      rapidTo([5, 5, 2]),
      ...hole(5, 5),
    ]);
    const expanded = { ...p, sections: [section(out)] };
    const before = programStats(p, 3000);
    const after = programStats(expanded, 3000);
    expect(after.cutLength).toBeCloseTo(before.cutLength, 9);
    expect(after.seconds).toBeCloseTo(before.seconds, 9);
  });

  it("rises to clear before crossing when it starts below clear", () => {
    const p = program([
      { kind: "rapid", to: [0, 0, 1] },
      {
        kind: "cycle",
        cycle: "drill",
        points: [[5, 0]],
        clear: 2,
        top: 0,
        bottom: -3,
        feed: 200,
      },
      { kind: "feed", to: [5, 0, 1], feed: 300, role: "link" },
    ]);
    const out = normalised(p, plain);
    expect(out).toEqual([
      { kind: "rapid", to: [0, 0, 1] },
      { kind: "rapid", to: [0, 0, 2] },
      { kind: "rapid", to: [5, 0, 2] },
      { kind: "feed", to: [5, 0, -3], feed: 200, role: "plunge" },
      { kind: "rapid", to: [5, 0, 2] },
      { kind: "feed", to: [5, 0, 1], feed: 300, role: "link" },
    ]);
    const after = programStats({ ...p, sections: [section(out)] }, 3000);
    expect(after.seconds).toBeCloseTo(programStats(p, 3000).seconds, 9);
  });

  it("keeps cycles for a post with cycles", () => {
    expect(normalised(program([peck]), full)).toEqual([peck]);
  });
});

describe("normalise units", () => {
  it("turns a 25.4 mm move into 1 in and leaves the IR unchanged", () => {
    const p = program([
      { kind: "rapid", to: [25.4, 50.8, 12.7] },
      { kind: "feed", to: [25.4, 0, -2.54], feed: 254, role: "cut" },
      {
        kind: "arc",
        to: [0, 25.4, -2.54],
        centre: [0, 0, -2.54],
        dir: "ccw",
        plane: "xy",
        feed: 508,
        role: "cut",
      },
      {
        kind: "cycle",
        cycle: "peck",
        points: [[25.4, 25.4]],
        clear: 5.08,
        top: 0,
        bottom: -12.7,
        peck: 2.54,
        dwell: 0.5,
        feed: 127,
      },
      { kind: "dwell", seconds: 2 },
    ]);
    const copy = structuredClone(p);
    const result = normalise(p, full, { units: "inch" });
    expect(p).toEqual(copy);
    expect(result.units).toBe("inch");
    expect(result.postId).toBe("full");
    const [rapid, feed, arc, cycle, dwell] = result.files[0]![0]!.moves;
    expect(rapid).toEqual({ kind: "rapid", to: [1, 2, 0.5] });
    expect(feed).toMatchObject({
      kind: "feed",
      to: [1, 0, expect.closeTo(-0.1, 12)],
      feed: expect.closeTo(10, 12),
    });
    expect(arc).toMatchObject({
      to: [0, 1, expect.closeTo(-0.1, 12)],
      centre: [0, 0, expect.closeTo(-0.1, 12)],
      feed: expect.closeTo(20, 12),
    });
    expect(cycle).toMatchObject({
      points: [[1, 1]],
      clear: expect.closeTo(0.2, 12),
      top: 0,
      bottom: -0.5,
      peck: expect.closeTo(0.1, 12),
      dwell: 0.5,
      feed: expect.closeTo(5, 12),
    });
    expect(dwell).toEqual({ kind: "dwell", seconds: 2 });
    expect(normalise(p, full, { units: "mm" }).files[0]![0]!.moves).toEqual(
      p.sections[0]!.moves,
    );
  });
});

describe("normalise tool changes and checks", () => {
  function tools(ids: string[]): Program {
    return {
      ...program([]),
      tools: [tool, { ...tool, id: "t2", number: 2 }],
      sections: ids.map((id) =>
        section([{ kind: "rapid", to: [0, 0, 5] }], id),
      ),
    };
  }

  it("splits one file per tool run for a post without tool change", () => {
    const files = normalise(tools(["t1", "t1", "t2", "t1"]), plain, {
      units: "mm",
    }).files;
    expect(files.map((file) => file.map((s) => s.toolId))).toEqual([
      ["t1", "t1"],
      ["t2"],
      ["t1"],
    ]);
  });

  it("keeps one file for a post with tool change", () => {
    const files = normalise(tools(["t1", "t2", "t1"]), full, {
      units: "mm",
    }).files;
    expect(files.map((file) => file.map((s) => s.toolId))).toEqual([
      ["t1", "t2", "t1"],
    ]);
  });

  it("rejects raw moves meant for another post", () => {
    const p = program([
      { kind: "raw", post: "full", text: "M7" },
      { kind: "raw", post: "grbl", text: "M0" },
    ]);
    expect(() => normalise(p, full, { units: "mm" })).toThrow(
      "sections[0].moves[1] raw is for post grbl, not full",
    );
    expect(normalised(program([p.sections[0]!.moves[0]!]), full)).toEqual([
      { kind: "raw", post: "full", text: "M7" },
    ]);
  });

  it("rejects an invalid program", () => {
    const p = program([
      { kind: "rapid", to: [0, 0, 5] },
      { kind: "feed", to: [0, 0, 0], feed: 0, role: "plunge" },
    ]);
    expect(() => normalise(p, full, { units: "mm" })).toThrow(
      "sections[0].moves[1].feed must be greater than 0",
    );
  });
});
