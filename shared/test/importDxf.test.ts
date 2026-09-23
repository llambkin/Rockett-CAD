import { describe, expect, it } from "vitest";
import { importDxf } from "../src/importDxf.js";
import { detectProfiles } from "../src/profiles.js";
import type {
  SketchArc,
  SketchCircle,
  SketchEntity,
  SketchLine,
  SketchPoint,
} from "../src/model.js";

type Pair = [number, string | number];

function dxf(entities: Pair[][], header: Pair[] = []): string {
  const pairs: Pair[] = [
    [0, "SECTION"],
    [2, "HEADER"],
    ...header,
    [0, "ENDSEC"],
    [0, "SECTION"],
    [2, "ENTITIES"],
    ...entities.flat(),
    [0, "ENDSEC"],
    [0, "EOF"],
  ];
  return pairs.map(([code, value]) => `${code}\n${value}`).join("\n");
}

const line = (x1: number, y1: number, x2: number, y2: number): Pair[] => [
  [0, "LINE"],
  [8, "0"],
  [10, x1],
  [20, y1],
  [30, 0],
  [11, x2],
  [21, y2],
  [31, 0],
];

function view(entities: SketchEntity[]) {
  const points = new Map(
    entities
      .filter((e): e is SketchPoint => e.kind === "point")
      .map((p) => [p.id, p]),
  );
  const xy = (id: string) => {
    const p = points.get(id)!;
    return [p.x, p.y];
  };
  return {
    points,
    xy,
    lines: entities.filter((e): e is SketchLine => e.kind === "line"),
    arcs: entities.filter((e): e is SketchArc => e.kind === "arc"),
    circles: entities.filter((e): e is SketchCircle => e.kind === "circle"),
  };
}

function expectXY(actual: number[], x: number, y: number) {
  expect(actual[0]).toBeCloseTo(x, 9);
  expect(actual[1]).toBeCloseTo(y, 9);
}

describe("importDxf", () => {
  it("shares the corners of a rectangle drawn as 4 LINE and gives one closed profile", () => {
    const result = importDxf(
      dxf([
        line(0, 0, 40, 0),
        line(40, 0, 40, 20),
        line(40, 20, 0, 20),
        line(0, 20, 0, 1e-7),
      ]),
    );
    const v = view(result.entities);
    expect(result.skipped).toBe(0);
    expect(v.lines).toHaveLength(4);
    expect(v.points.size).toBe(4);
    const profiles = detectProfiles(result.entities);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.area).toBeCloseTo(800, 6);
  });

  it("turns a bulge of 1 into a half circle that runs counter-clockwise", () => {
    const result = importDxf(
      dxf([
        [
          [0, "LWPOLYLINE"],
          [90, 2],
          [70, 0],
          [10, 0],
          [20, 0],
          [42, 1],
          [10, 10],
          [20, 0],
        ],
      ]),
    );
    const v = view(result.entities);
    expect(v.arcs).toHaveLength(1);
    const arc = v.arcs[0]!;
    expectXY(v.xy(arc.center), 5, 0);
    expectXY(v.xy(arc.start), 0, 0);
    expectXY(v.xy(arc.end), 10, 0);
  });

  it("reverses a negative bulge so the arc still runs counter-clockwise", () => {
    const result = importDxf(
      dxf([
        [
          [0, "LWPOLYLINE"],
          [90, 2],
          [70, 0],
          [10, 0],
          [20, 0],
          [42, -1],
          [10, 10],
          [20, 0],
        ],
      ]),
    );
    const v = view(result.entities);
    const arc = v.arcs[0]!;
    expectXY(v.xy(arc.center), 5, 0);
    expectXY(v.xy(arc.start), 10, 0);
    expectXY(v.xy(arc.end), 0, 0);
  });

  it("gives a closed bulged LWPOLYLINE arcs of the right radius and a profile", () => {
    const quarter = Math.tan(Math.PI / 8);
    const result = importDxf(
      dxf([
        [
          [0, "LWPOLYLINE"],
          [90, 3],
          [70, 1],
          [10, 0],
          [20, 0],
          [10, 10],
          [20, 0],
          [42, quarter],
          [10, 0],
          [20, 10],
        ],
      ]),
    );
    const v = view(result.entities);
    expect(v.lines).toHaveLength(2);
    expect(v.arcs).toHaveLength(1);
    expect(v.points.size).toBe(4);
    const arc = v.arcs[0]!;
    expectXY(v.xy(arc.center), 0, 0);
    const [sx, sy] = v.xy(arc.start);
    expect(Math.hypot(sx!, sy!)).toBeCloseTo(10, 9);
    const profiles = detectProfiles(result.entities);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.area / (25 * Math.PI)).toBeCloseTo(1, 2);
  });

  it("maps ARC angles in degrees counter-clockwise onto start and end points", () => {
    const result = importDxf(
      dxf([
        [
          [0, "ARC"],
          [10, 1],
          [20, 2],
          [40, 10],
          [50, 90],
          [51, 180],
        ],
      ]),
    );
    const v = view(result.entities);
    const arc = v.arcs[0]!;
    expectXY(v.xy(arc.center), 1, 2);
    expectXY(v.xy(arc.start), 1, 12);
    expectXY(v.xy(arc.end), -9, 2);
  });

  it("mirrors an ARC whose extrusion points down and keeps it counter-clockwise", () => {
    const result = importDxf(
      dxf([
        [
          [0, "ARC"],
          [10, 1],
          [20, 2],
          [40, 10],
          [50, 0],
          [51, 90],
          [210, 0],
          [220, 0],
          [230, -1],
        ],
      ]),
    );
    const v = view(result.entities);
    const arc = v.arcs[0]!;
    expectXY(v.xy(arc.center), -1, 2);
    expectXY(v.xy(arc.start), -1, 12);
    expectXY(v.xy(arc.end), -11, 2);
  });

  it("rejects text that is not ASCII DXF", () => {
    expect(() => importDxf("hello\nworld")).toThrow(/Not an ASCII DXF file/);
  });

  it("reads R12 POLYLINE vertices with bulges and the closed flag", () => {
    const result = importDxf(
      dxf([
        [
          [0, "POLYLINE"],
          [66, 1],
          [70, 1],
          [0, "VERTEX"],
          [10, 0],
          [20, 0],
          [42, -1],
          [0, "VERTEX"],
          [10, 0],
          [20, 10],
          [0, "SEQEND"],
        ],
      ]),
    );
    const v = view(result.entities);
    expect(v.arcs).toHaveLength(1);
    expect(v.lines).toHaveLength(1);
    expect(v.points.size).toBe(3);
    expectXY(v.xy(v.arcs[0]!.start), 0, 10);
    expect(detectProfiles(result.entities)).toHaveLength(1);
  });

  it("scales by 25.4 when $INSUNITS is 1 (inches)", () => {
    const result = importDxf(
      dxf(
        [
          line(0, 0, 1, 2),
          [
            [0, "CIRCLE"],
            [10, 0],
            [20, 0],
            [40, 0.5],
          ],
        ],
        [
          [9, "$INSUNITS"],
          [70, 1],
        ],
      ),
    );
    const v = view(result.entities);
    expectXY(v.xy(v.lines[0]!.p2), 25.4, 50.8);
    expect(v.circles[0]!.radius).toBeCloseTo(12.7, 9);
  });

  it("skips a SPLINE and counts it", () => {
    const result = importDxf(
      dxf([
        line(0, 0, 5, 0),
        [
          [0, "SPLINE"],
          [70, 8],
          [71, 3],
          [10, 0],
          [20, 0],
          [10, 5],
          [20, 5],
        ],
      ]),
    );
    expect(result.skipped).toBe(1);
    expect(view(result.entities).lines).toHaveLength(1);
  });

  it("round-trips an R12 file shaped like the EXCH-009 writer output", () => {
    const r12 = [
      "  0",
      "SECTION",
      "  2",
      "HEADER",
      "  9",
      "$ACADVER",
      "  1",
      "AC1009",
      "  0",
      "ENDSEC",
      "  0",
      "SECTION",
      "  2",
      "TABLES",
      "  0",
      "TABLE",
      "  2",
      "LAYER",
      " 70",
      "     2",
      "  0",
      "LAYER",
      "  2",
      "0",
      " 70",
      "     0",
      " 62",
      "     7",
      "  6",
      "CONTINUOUS",
      "  0",
      "LAYER",
      "  2",
      "CONSTRUCTION",
      " 70",
      "     0",
      " 62",
      "     8",
      "  6",
      "CONTINUOUS",
      "  0",
      "ENDTAB",
      "  0",
      "ENDSEC",
      "  0",
      "SECTION",
      "  2",
      "ENTITIES",
      ...[
        [0, 0, 30, 0],
        [30, 0, 30, 20],
        [30, 20, 0, 20],
        [0, 20, 0, 0],
      ].flatMap(([x1, y1, x2, y2]) => [
        "  0",
        "LINE",
        "  8",
        "0",
        " 10",
        `${x1}.0`,
        " 20",
        `${y1}.0`,
        " 30",
        "0.0",
        " 11",
        `${x2}.0`,
        " 21",
        `${y2}.0`,
        " 31",
        "0.0",
      ]),
      "  0",
      "CIRCLE",
      "  8",
      "0",
      " 10",
      "15.0",
      " 20",
      "10.0",
      " 30",
      "0.0",
      " 40",
      "4.0",
      "  0",
      "LINE",
      "  8",
      "CONSTRUCTION",
      " 10",
      "0.0",
      " 20",
      "0.0",
      " 30",
      "0.0",
      " 11",
      "30.0",
      " 21",
      "20.0",
      " 31",
      "0.0",
      "  0",
      "POINT",
      "  8",
      "0",
      " 10",
      "5.0",
      " 20",
      "5.0",
      " 30",
      "0.0",
      "  0",
      "ENDSEC",
      "  0",
      "EOF",
      "",
    ].join("\r\n");
    const result = importDxf(r12);
    const v = view(result.entities);
    expect(result.skipped).toBe(0);
    expect(v.lines).toHaveLength(5);
    expect(v.circles).toHaveLength(1);
    expect(v.points.size).toBe(6);
    const construction = v.lines.filter((l) => l.construction);
    expect(construction).toHaveLength(1);
    expectXY(v.xy(construction[0]!.p2), 30, 20);
    expectXY(v.xy(v.circles[0]!.center), 15, 10);
    expect(v.circles[0]!.radius).toBe(4);
    expect(
      result.entities.some(
        (e) => e.kind === "point" && e.x === 5 && e.y === 5 && !e.construction,
      ),
    ).toBe(true);
    expect(detectProfiles(result.entities)).toHaveLength(2);
  });
});
