import { describe, expect, it } from "vitest";
import { importSvg } from "../src/importSvg.js";
import { detectProfiles } from "../src/profiles.js";
import type {
  SketchArc,
  SketchCircle,
  SketchEntity,
  SketchLine,
  SketchPoint,
} from "../src/model.js";

type XY = [number, number];

const MM100 = 'width="100mm" height="100mm" viewBox="0 0 100 100"';
const svg = (body: string, attrs = MM100) =>
  `<?xml version="1.0"?>\n<!-- drawing -->\n<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

function view(entities: SketchEntity[]) {
  const points = new Map(
    entities
      .filter((e): e is SketchPoint => e.kind === "point")
      .map((p) => [p.id, p]),
  );
  const xy = (id: string): XY => {
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

function expectXY(actual: XY, x: number, y: number) {
  expect(actual[0]).toBeCloseTo(x, 9);
  expect(actual[1]).toBeCloseTo(y, 9);
}

function bounds(entities: SketchEntity[]) {
  const points = [...view(entities).points.values()];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function toSegment(p: XY, a: XY, b: XY) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len = dx * dx + dy * dy;
  const t =
    len === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len),
        );
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function chainPoints(entities: SketchEntity[]): XY[][] {
  const v = view(entities);
  return v.lines.map((l) => [v.xy(l.p1), v.xy(l.p2)]);
}

function spread(curve: (t: number) => XY, segments: XY[][]) {
  const samples = Array.from({ length: 2001 }, (_, i) => curve(i / 2000));
  const toChain = (p: XY) =>
    Math.min(...segments.map(([a, b]) => toSegment(p, a!, b!)));
  const toCurve = (p: XY) =>
    Math.min(...samples.slice(1).map((q, i) => toSegment(p, samples[i]!, q)));
  return Math.max(
    ...samples.map(toChain),
    ...segments.flat().map((p) => toCurve(p)),
  );
}

describe("importSvg", () => {
  it("reads a 10 by 20 mm rect in a width=10mm document as 4 lines in millimetres", () => {
    const result = importSvg(
      svg(
        '<rect x="0" y="0" width="100" height="200"/>',
        'width="10mm" height="20mm" viewBox="0 0 100 200"',
      ),
    );
    const v = view(result.entities);
    expect(result.skipped).toBe(0);
    expect(v.lines).toHaveLength(4);
    expect(v.points.size).toBe(4);
    const lengths = v.lines.map((l) => {
      const [a, b] = [v.xy(l.p1), v.xy(l.p2)];
      return Math.hypot(b[0] - a[0], b[1] - a[1]);
    });
    for (const n of lengths)
      expect(Math.min(Math.abs(n - 10), Math.abs(n - 20))).toBeLessThan(1e-9);
    bounds(result.entities).forEach((n, i) =>
      expect(n).toBeCloseTo([0, 0, 10, 20][i]!, 9),
    );
    const profiles = detectProfiles(result.entities);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.area).toBeCloseTo(200, 6);
  });

  it("reads a circle as a circle with the y axis flipped up", () => {
    const result = importSvg(svg('<circle cx="10" cy="15" r="5"/>'));
    const v = view(result.entities);
    expect(v.circles).toHaveLength(1);
    expect(v.circles[0]!.radius).toBeCloseTo(5, 9);
    expectXY(v.xy(v.circles[0]!.center), 10, 85);
    expect(v.lines).toHaveLength(0);
  });

  it("flattens a cubic path into a line chain within 0.05 mm of the curve", () => {
    const result = importSvg(svg('<path d="M 10 90 C 10 10 90 10 90 90"/>'));
    const v = view(result.entities);
    expect(v.arcs).toHaveLength(0);
    expect(v.lines.length).toBeGreaterThan(8);
    const p: XY[] = [
      [10, 10],
      [10, 90],
      [90, 90],
      [90, 10],
    ];
    const cubic = (t: number): XY => {
      const k = [
        (1 - t) ** 3,
        3 * t * (1 - t) ** 2,
        3 * t * t * (1 - t),
        t ** 3,
      ];
      return [0, 1].map((i) =>
        k.reduce((sum, w, j) => sum + w * p[j]![i]!, 0),
      ) as XY;
    };
    expect(spread(cubic, chainPoints(result.entities))).toBeLessThanOrEqual(
      0.05,
    );
  });

  it("moves an element by its transform", () => {
    const plain = bounds(
      importSvg(svg('<rect width="10" height="20"/>')).entities,
    );
    const moved = bounds(
      importSvg(
        svg('<rect width="10" height="20" transform="translate(5,0)"/>'),
      ).entities,
    );
    moved.forEach((n, i) =>
      expect(n).toBeCloseTo(plain[i]! + (i % 2 === 0 ? 5 : 0), 9),
    );
  });

  it("composes group transforms from the outside in", () => {
    const v = view(
      importSvg(
        svg(
          '<g transform="translate(10 0)"><g transform="rotate(90)"><line x1="0" y1="0" x2="5" y2="0"/></g></g>',
        ),
      ).entities,
    );
    expect(v.lines).toHaveLength(1);
    expectXY(v.xy(v.lines[0]!.p1), 10, 100);
    expectXY(v.xy(v.lines[0]!.p2), 10, 95);
  });

  it("turns M L H V Z with relative forms into a closed square", () => {
    const result = importSvg(svg('<path d="m10,10 l10 0 v10 H10z"/>'));
    const v = view(result.entities);
    expect(v.lines).toHaveLength(4);
    expect(v.points.size).toBe(4);
    expect(detectProfiles(result.entities)[0]!.area).toBeCloseTo(100, 6);
  });

  it("keeps a circular A as an arc that runs counter-clockwise in the sketch", () => {
    const [up, down] = ["1", "0"].map((sweep) =>
      view(
        importSvg(svg(`<path d="M 0 50 A 5 5 0 0 ${sweep} 10 50"/>`)).entities,
      ),
    );
    for (const v of [up!, down!]) {
      expect(v.arcs).toHaveLength(1);
      expectXY(v.xy(v.arcs[0]!.center), 5, 50);
    }
    expectXY(up!.xy(up!.arcs[0]!.start), 10, 50);
    expectXY(up!.xy(up!.arcs[0]!.end), 0, 50);
    expectXY(down!.xy(down!.arcs[0]!.start), 0, 50);
    expectXY(down!.xy(down!.arcs[0]!.end), 10, 50);
  });

  it("flattens an elliptical arc within 0.05 mm", () => {
    const result = importSvg(svg('<path d="M 10 50 A 20 10 0 0 0 50 50"/>'));
    const v = view(result.entities);
    expect(v.arcs).toHaveLength(0);
    const spreadMm = spread(
      (t) => [30 - 20 * Math.cos(Math.PI * t), 50 - 10 * Math.sin(Math.PI * t)],
      chainPoints(result.entities),
    );
    expect(spreadMm).toBeLessThanOrEqual(0.05);
  });

  it("uses 96 px per inch without a width in physical units", () => {
    const v = view(
      importSvg(svg('<line x1="0" y1="0" x2="96" y2="0"/>', "")).entities,
    );
    const [a, b] = [v.xy(v.lines[0]!.p1), v.xy(v.lines[0]!.p2)];
    expect(b[0] - a[0]).toBeCloseTo(25.4, 9);
  });

  it("counts unsupported and empty shapes and ignores definitions", () => {
    const result = importSvg(
      svg(
        '<defs><rect width="5" height="5"/></defs><ellipse rx="3" ry="2"/><text>hi</text><rect width="0" height="5"/><polyline points="0,0 5,0"/>',
      ),
    );
    expect(result.skipped).toBe(3);
    expect(view(result.entities).lines).toHaveLength(1);
  });

  it("rejects text that is not SVG", () => {
    expect(() => importSvg("hello")).toThrow(/Not an SVG file/);
  });
});
