import { describe, expect, it } from "vitest";
import type { EdgeInfo, PlaneFrame, Vec3 } from "../src/api.js";
import { importDxf } from "../src/importDxf.js";
import type { SketchEntity, SketchPoint } from "../src/model.js";
import { crossingEllipses } from "../src/curveLimits.js";
import { detectProfiles } from "../src/profiles.js";
import { projectEdge } from "../src/projection.js";
import { curveSamples, sketchCurves } from "../src/sketchCurves.js";
import { solveSketch } from "../src/solver.js";
import { trimSketch } from "../src/sketchTrim.js";

const TAU = 2 * Math.PI;
type XY = [number, number];

const dxf = (...records: (string | number)[][]) =>
  ["0", "SECTION", "2", "ENTITIES", ...records.flat(), "0", "ENDSEC"]
    .map(String)
    .join("\n");

const ellipseRecord = (
  [cx, cy]: XY,
  [mx, my]: XY,
  ratio: number,
  start: number,
  end: number,
  nz = 1,
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
  nz,
  40,
  ratio,
  41,
  start,
  42,
  end,
];

function onEllipse(c: XY, major: XY, ratio: number, t: number, nz = 1): XY {
  const minor: XY = [-major[1] * ratio * nz, major[0] * ratio * nz];
  return [
    c[0] + Math.cos(t) * major[0] + Math.sin(t) * minor[0],
    c[1] + Math.cos(t) * major[1] + Math.sin(t) * minor[1],
  ];
}

const pointOf = (entities: SketchEntity[], id: string | undefined) => {
  const p = entities.find((e) => e.id === id);
  if (p?.kind !== "point") throw new Error(`no point ${id}`);
  return p;
};

function arcOf(entities: SketchEntity[]) {
  const e = entities.find((x) => x.kind === "ellipse");
  if (e?.kind !== "ellipse") throw new Error("no ellipse");
  const at = (id: string | undefined) => pointOf(entities, id);
  return { e, c: at(e.center), s: at(e.start), end: at(e.end) };
}

function shapeOf(entities: SketchEntity[]) {
  const curve = sketchCurves(entities, true)[0]!;
  if (curve.kind !== "ellipse") throw new Error(`got ${curve.kind}`);
  return curve;
}

const near = ([x, y]: XY, p: { x: number; y: number }, tol = 1e-12) =>
  expect(Math.hypot(p.x - x, p.y - y)).toBeLessThan(tol);

function level(c: XY, a: number, b: number, angle: number, [x, y]: XY) {
  const [dx, dy] = [x - c[0], y - c[1]];
  const u = (dx * Math.cos(angle) + dy * Math.sin(angle)) / a;
  const v = (dy * Math.cos(angle) - dx * Math.sin(angle)) / b;
  return Math.hypot(u, v) - 1;
}

describe("DXF elliptical arcs", () => {
  const c: XY = [4, -2];
  const major: XY = [6, 8];

  it("imports a partial ELLIPSE as one entity with its exact bounded interval", () => {
    const [t0, t1] = [0.3, 2.5];
    const imported = importDxf(dxf(ellipseRecord(c, major, 0.5, t0, t1)));
    expect(imported.skipped).toBe(0);
    expect(imported.entities.filter((e) => e.kind !== "point")).toHaveLength(1);
    const { s, end } = arcOf(imported.entities);
    near(onEllipse(c, major, 0.5, t0), s);
    near(onEllipse(c, major, 0.5, t1), end);
    const curve = sketchCurves(imported.entities)[0]!;
    expect(curve.kind).toBe("ellipse");
    if (curve.kind !== "ellipse") return;
    expect(curve.span?.t0).toBeCloseTo(t0, 12);
    expect(curve.span?.t1).toBeCloseTo(t1, 12);
  });

  it("keeps an interval that wraps past the major axis", () => {
    const imported = importDxf(dxf(ellipseRecord(c, major, 0.5, 5, 1)));
    const curve = sketchCurves(imported.entities)[0]!;
    if (curve.kind !== "ellipse") throw new Error("no ellipse");
    expect(curve.span!.t1 - curve.span!.t0).toBeCloseTo(1 + TAU - 5, 12);
    const samples = curveSamples(curve, 8);
    const mid: XY = [samples[8]!, samples[9]!];
    near(
      onEllipse(c, major, 0.5, (5 + 1 + TAU) / 2),
      { x: mid[0], y: mid[1] },
      1e-9,
    );
  });

  it("runs counter-clockwise from start to end under a mirrored extrusion", () => {
    const [t0, t1] = [0.3, 2.5];
    const imported = importDxf(dxf(ellipseRecord(c, major, 0.5, t0, t1, -1)));
    const { s, end } = arcOf(imported.entities);
    near(onEllipse(c, major, 0.5, t1, -1), s);
    near(onEllipse(c, major, 0.5, t0, -1), end);
    const curve = sketchCurves(imported.entities)[0]!;
    const samples = curveSamples(curve, 8);
    near(
      onEllipse(c, major, 0.5, (t0 + t1) / 2, -1),
      {
        x: samples[8]!,
        y: samples[9]!,
      },
      1e-9,
    );
  });

  it("samples arc positions that match an independent parametrisation", () => {
    const [t0, t1] = [-1.2, 1.9];
    const imported = importDxf(dxf(ellipseRecord(c, major, 0.4, t0, t1)));
    const samples = curveSamples(sketchCurves(imported.entities)[0]!, 10);
    expect(samples).toHaveLength(22);
    for (let i = 0; i <= 10; i++)
      near(
        onEllipse(c, major, 0.4, t0 + ((t1 - t0) * i) / 10),
        {
          x: samples[2 * i]!,
          y: samples[2 * i + 1]!,
        },
        1e-9,
      );
  });
});

const P = (id: string, x: number, y: number): SketchPoint => ({
  id,
  kind: "point",
  x,
  y,
});

function ellipseArc(
  id: string,
  [cx, cy]: XY,
  a: number,
  b: number,
  t0: number,
  t1: number,
): SketchEntity[] {
  return [
    P(`${id}c`, cx, cy),
    P(`${id}m`, cx + a, cy),
    P(`${id}n`, cx, cy + b),
    P(`${id}s`, cx + a * Math.cos(t0), cy + b * Math.sin(t0)),
    P(`${id}e`, cx + a * Math.cos(t1), cy + b * Math.sin(t1)),
    {
      id,
      kind: "ellipse",
      center: `${id}c`,
      major: `${id}m`,
      minor: `${id}n`,
      start: `${id}s`,
      end: `${id}e`,
    },
  ];
}

const line = (id: string, p1: string, p2: string): SketchEntity => ({
  id,
  kind: "line",
  p1,
  p2,
});

function segmentArea(a: number, b: number, d: number): number {
  const k = d / a;
  return a * b * (Math.acos(k) - k * Math.sqrt(1 - k * k));
}

describe("elliptical arc solving", () => {
  const base = ellipseArc("e", [0, 0], 10, 5, 0.4, 2.6);

  it("moves a dragged end to its target and keeps it on the ellipse", () => {
    const solved = solveSketch({
      entities: base,
      constraints: [],
      drag: { pointId: "es", x: 9, y: 4 },
    });
    expect(solved.converged).toBe(true);
    const at = (id: string) => pointOf(solved.entities, id);
    const [c, m, n, s, e] = ["ec", "em", "en", "es", "ee"].map(at);
    near([9, 4], s!, 1e-3);
    const [a, b] = [m!, n!].map((p) => Math.hypot(p.x - c!.x, p.y - c!.y));
    const angle = Math.atan2(m!.y - c!.y, m!.x - c!.x);
    for (const p of [s!, e!])
      expect(
        Math.abs(level([c!.x, c!.y], a!, b!, angle, [p.x, p.y])),
      ).toBeLessThan(1e-8);
    const cosine =
      ((m!.x - c!.x) * (n!.x - c!.x) + (m!.y - c!.y) * (n!.y - c!.y)) / a! / b!;
    expect(Math.abs(cosine)).toBeLessThan(1e-8);
  });

  it("keeps both ends on the ellipse while its major axis is dragged", () => {
    const solved = solveSketch({
      entities: base,
      constraints: [],
      drag: { pointId: "em", x: 12, y: 3 },
    });
    expect(solved.converged).toBe(true);
    const at = (id: string) => pointOf(solved.entities, id);
    const [c, m, n] = [at("ec"), at("em"), at("en")];
    const a = Math.hypot(m.x - c.x, m.y - c.y);
    const b = Math.hypot(n.x - c.x, n.y - c.y);
    const angle = Math.atan2(m.y - c.y, m.x - c.x);
    for (const id of ["es", "ee"]) {
      const p = at(id);
      expect(Math.abs(level([c.x, c.y], a, b, angle, [p.x, p.y]))).toBeLessThan(
        1e-8,
      );
    }
  });
});

describe("bounded elliptical profiles", () => {
  it("closes a half ellipse with its chord", () => {
    const entities = [...ellipseArc("e", [0, 0], 10, 5, 0, Math.PI)];
    entities.push(line("chord", "ee", "es"));
    const profiles = detectProfiles(entities);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.outer.map((c) => c.entityId).toSorted()).toEqual([
      "chord",
      "e",
    ]);
    expect(profiles[0]!.area).toBeCloseTo((Math.PI * 50) / 2, 0);
    expect(crossingEllipses(entities)).toEqual([]);
  });

  it("joins an elliptical arc to a circular arc at shared ends", () => {
    const entities = ellipseArc("e", [0, 0], 10, 5, 0, Math.PI);
    entities.push(P("ac", 0, 0), {
      id: "arc",
      kind: "arc",
      center: "ac",
      start: "ee",
      end: "es",
    });
    expect(crossingEllipses(entities)).toEqual([]);
    const profiles = detectProfiles(entities);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.area / ((Math.PI * 150) / 2)).toBeCloseTo(1, 2);
  });

  it("refuses an elliptical arc whose interior meets a circle", () => {
    const entities = ellipseArc("e", [0, 0], 10, 5, 0, Math.PI);
    entities.push(P("oc", 0, 5), {
      id: "o",
      kind: "circle",
      center: "oc",
      radius: 2,
    });
    expect(crossingEllipses(entities)).toEqual(["e"]);
  });

  it("ignores a circle that meets only the missing part of the ellipse", () => {
    const entities = ellipseArc("e", [0, 0], 10, 5, 0, Math.PI);
    entities.push(P("oc", 0, -5), {
      id: "o",
      kind: "circle",
      center: "oc",
      radius: 2,
    });
    expect(crossingEllipses(entities)).toEqual([]);
  });
});

describe("line and ellipse intersections", () => {
  const full = (a: number, b: number): SketchEntity[] =>
    ellipseArc("e", [0, 0], a, b, 0, 1).flatMap((x) =>
      x.kind === "ellipse"
        ? [
            {
              id: "e",
              kind: "ellipse",
              center: "ec",
              major: "em",
              minor: "en",
            } as SketchEntity,
          ]
        : x.id === "es" || x.id === "ee"
          ? []
          : [x],
    );

  it("splits a whole ellipse by a crossing line into two exact regions", () => {
    const entities = [
      ...full(10, 5),
      P("a", 4, -8),
      P("b", 4, 8),
      line("l", "a", "b"),
    ];
    expect(crossingEllipses(entities)).toEqual([]);
    const areas = detectProfiles(entities)
      .map((p) => p.area)
      .toSorted((x, y) => x - y);
    expect(areas).toHaveLength(2);
    expect(areas[0]!).toBeCloseTo(segmentArea(10, 5, 4), 0);
    expect(areas[1]!).toBeCloseTo(Math.PI * 50 - segmentArea(10, 5, 4), 0);
  });

  it("finds the exact crossing points of a slanted line", () => {
    const entities = [
      ...full(10, 5),
      P("a", -12, -3),
      P("b", 12, 4),
      line("l", "a", "b"),
    ];
    const lens = detectProfiles(entities);
    expect(lens).toHaveLength(2);
    const cuts = trimSketch(entities, [], "l", {
      x: 0,
      y: 0.5,
    }).entities.filter(
      (e): e is SketchPoint =>
        e.kind === "point" && !["a", "b", "ec", "em", "en"].includes(e.id),
    );
    expect(cuts).toHaveLength(2);
    for (const p of cuts)
      expect(Math.abs(level([0, 0], 10, 5, 0, [p.x, p.y]))).toBeLessThan(1e-12);
  });

  it("keeps a tangent line from splitting the ellipse", () => {
    const entities = [
      ...full(10, 5),
      P("a", -12, 5),
      P("b", 12, 5),
      line("l", "a", "b"),
    ];
    expect(crossingEllipses(entities)).toEqual([]);
    const profiles = detectProfiles(entities);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.outer).toEqual([{ entityId: "e", reversed: false }]);
  });

  it("splits an elliptical arc where a line crosses its interior only", () => {
    const entities = [
      ...ellipseArc("e", [0, 0], 10, 5, 0, Math.PI),
      line("chord", "ee", "es"),
      P("a", 0, -1),
      P("b", 0, 9),
      line("l", "a", "b"),
      P("q", 5, -6),
      P("r", 5, -1),
      line("miss", "q", "r"),
    ];
    const areas = detectProfiles(entities)
      .map((p) => p.area)
      .toSorted((x, y) => x - y);
    expect(areas).toHaveLength(2);
    expect(areas[0]!).toBeCloseTo((Math.PI * 50) / 4, 0);
    expect(areas[1]!).toBeCloseTo((Math.PI * 50) / 4, 0);
  });
});

describe("projecting conics", () => {
  const theta = Math.PI / 6;
  const frame: PlaneFrame = {
    origin: [0, 0, 0],
    xAxis: [1, 0, 0],
    yAxis: [0, Math.cos(theta), Math.sin(theta)],
    normal: [0, -Math.sin(theta), Math.cos(theta)],
  };
  const ref = { kind: "edge", bodyId: "b", edgeName: "e" } as const;

  it("projects a tilted circle to an exact ellipse", () => {
    const circle: EdgeInfo["curve"] = {
      type: "circle",
      center: [1, 2, 3],
      axis: [0, 0, 1],
      radius: 5,
      start: [6, 2, 3],
      end: [6, 2, 3],
      sweep: TAU,
    };
    const projected = projectEdge(circle, frame, "p", ref);
    expect(projected.at(-1)).toMatchObject({
      kind: "ellipse",
      projection: ref,
    });
    const e = shapeOf(projected);
    expect(e.a).toBeCloseTo(5, 12);
    expect(e.b).toBeCloseTo(5 * Math.cos(theta), 12);
    expect(e.cx).toBeCloseTo(1, 12);
    expect(e.cy).toBeCloseTo(2 * Math.cos(theta) + 3 * Math.sin(theta), 12);
    expect(e.span).toBeUndefined();
  });

  for (const sign of [1, -1])
    it(`projects a tilted circular arc counter-clockwise (axis ${sign})`, () => {
      const at = (t: number): Vec3 => [
        5 * Math.cos(t),
        sign * 5 * Math.sin(t),
        0,
      ];
      const arc: EdgeInfo["curve"] = {
        type: "circle",
        center: [0, 0, 0],
        axis: [0, 0, sign],
        radius: 5,
        start: at(0.2),
        end: at(1.7),
        sweep: 1.5,
      };
      const projected = projectEdge(arc, frame, "p", ref);
      const uv = (p: Vec3): XY => [
        p[0],
        p[1] * Math.cos(theta) + p[2] * Math.sin(theta),
      ];
      const { s, end } = arcOf(projected);
      const [first, last] = sign > 0 ? [at(0.2), at(1.7)] : [at(1.7), at(0.2)];
      near(uv(first), s);
      near(uv(last), end);
      const samples = curveSamples(shapeOf(projected), 2);
      near(uv(at(0.95)), { x: samples[2]!, y: samples[3]! }, 1e-9);
    });

  it("projects an elliptical edge with its axes and bounds", () => {
    const edge: EdgeInfo["curve"] = {
      type: "ellipse",
      center: [0, 0, 0],
      axis: [0, 0, 1],
      majorAxis: [0, 1, 0],
      majorRadius: 8,
      minorRadius: 3,
      start: [-3, 0, 0],
      end: [3, 0, 0],
      sweep: Math.PI,
    };
    const projected = projectEdge(edge, frame, "p", ref);
    const e = shapeOf(projected);
    expect(e.a).toBeCloseTo(8 * Math.cos(theta), 12);
    expect(e.b).toBeCloseTo(3, 12);
    const { s, end } = arcOf(projected);
    near([-3, 0], s);
    near([3, 0], end);
    expect(e.span!.t1 - e.span!.t0).toBeCloseTo(Math.PI, 12);
  });

  it("refuses a circle seen edge-on", () => {
    const circle: EdgeInfo["curve"] = {
      type: "circle",
      center: [0, 0, 0],
      axis: [1, 0, 0],
      radius: 5,
      sweep: TAU,
    };
    expect(() => projectEdge(circle, frame, "p", ref)).toThrow(/edge-on/);
  });
});
