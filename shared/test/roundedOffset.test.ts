import { expect, it } from "vitest";
import { detectProfiles } from "../src/profiles.js";
import { offsetSketch, offsetSketchSelection } from "../src/sketchModify.js";
import type { SketchEntity } from "../src/model.js";

export function roundedRectangle(): SketchEntity[] {
  const points: [number, number][] = [
    [2, 0],
    [18, 0],
    [20, 2],
    [20, 8],
    [18, 10],
    [2, 10],
    [0, 8],
    [0, 2],
    [18, 2],
    [18, 8],
    [2, 8],
    [2, 2],
  ];
  return [
    ...points.map(([x, y], i) => ({
      id: `p${i}`,
      kind: "point" as const,
      x,
      y,
    })),
    ...[0, 2, 4, 6].map((i) => ({
      id: `l${i}`,
      kind: "line" as const,
      p1: `p${i}`,
      p2: `p${i + 1}`,
    })),
    ...[1, 3, 5, 7].map((i, j) => ({
      id: `a${i}`,
      kind: "arc" as const,
      start: `p${i}`,
      end: `p${(i + 1) % 8}`,
      center: `p${8 + j}`,
    })),
  ];
}

it.each([
  [-1, 3, -1, 21],
  [1, 1, 1, 19],
])(
  "offsets lines and rounded corners together by %s",
  (amount, radius, minX, maxX) => {
    const source = roundedRectangle();
    const result = offsetSketch(source, [], "l0", amount).entities.slice(
      source.length,
    );
    expect(result.filter((e) => e.kind === "line")).toHaveLength(4);
    expect(result.filter((e) => e.kind === "arc")).toHaveLength(4);
    const profiles = detectProfiles(result);
    expect(profiles).toHaveLength(1);
    const xs = profiles[0]!.polygon.filter((_, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBeCloseTo(minX, 5);
    expect(Math.max(...xs)).toBeCloseTo(maxX, 5);
    const points = new Map(
      result.filter((e) => e.kind === "point").map((e) => [e.id, e]),
    );
    for (const arc of result.filter((e) => e.kind === "arc")) {
      const c = points.get(arc.center)!,
        a = points.get(arc.start)!;
      expect(Math.hypot(c.x - a.x, c.y - a.y)).toBeCloseTo(radius, 7);
      expect(
        result.some(
          (e) => e.kind === "line" && [e.p1, e.p2].includes(arc.start),
        ),
      ).toBe(true);
      expect(
        result.some((e) => e.kind === "line" && [e.p1, e.p2].includes(arc.end)),
      ).toBe(true);
    }
  },
);

it("can start chaining on an arc, and respects reversed line orientation", () => {
  const source = roundedRectangle();
  const line = source.find((e) => e.id === "l2")!;
  if (line.kind === "line") [line.p1, line.p2] = [line.p2, line.p1];
  const result = offsetSketch(source, [], "a3", 1).entities.slice(
    source.length,
  );
  const profile = detectProfiles(result)[0]!;
  expect(
    Math.min(...profile.polygon.filter((_, i) => i % 2 === 0)),
  ).toBeCloseTo(-1, 5);
  expect(
    offsetSketch(source, [], "a3", 1, false)
      .entities.slice(source.length)
      .filter((e) => e.kind === "arc"),
  ).toHaveLength(1);
});

it("follows an open rounded chain in both directions", () => {
  const source = roundedRectangle().filter(
    (e) => e.kind === "point" || ["l0", "a1", "l2"].includes(e.id),
  );
  const added = offsetSketch(source, [], "a1", 1).entities.slice(source.length);
  expect(added.filter((e) => e.kind === "line")).toHaveLength(2);
  expect(added.filter((e) => e.kind === "arc")).toHaveLength(1);
});

it("rejects offsets that consume a rounded corner", () => {
  expect(() => offsetSketch(roundedRectangle(), [], "l0", 2)).toThrow(
    /collapse/,
  );
});

it("orders a manually selected rounded outline into one closed offset", () => {
  const source = roundedRectangle();
  const added = offsetSketchSelection(
    source,
    [],
    ["l0", "a5", "l4", "a1", "l6", "a7", "l2", "a3"],
    -1,
  ).entities.slice(source.length);
  expect(added.filter((e) => e.kind === "arc")).toHaveLength(4);
  expect(added.filter((e) => e.kind === "line")).toHaveLength(4);
  expect(detectProfiles(added)).toHaveLength(1);
});

it("joins a small line-to-arc gap without changing the rounded corner radius", () => {
  const source = roundedRectangle();
  source.push({ id: "nearArc", kind: "point", x: 17.999, y: 0 });
  const line = source.find((e) => e.id === "l0")!;
  if (line.kind === "line") line.p2 = "nearArc";
  const before = JSON.stringify(source);
  const ids = source.filter((e) => e.kind !== "point").map((e) => e.id);
  const result = offsetSketchSelection(source, [], ids, -1);
  expect(result.joinedGaps?.count).toBe(1);
  expect(result.offsetChain?.closed).toBe(true);
  const added = result.entities.slice(source.length);
  expect(detectProfiles(added)).toHaveLength(1);
  const points = new Map(
    added.filter((e) => e.kind === "point").map((e) => [e.id, e]),
  );
  for (const arc of added.filter((e) => e.kind === "arc")) {
    const c = points.get(arc.center)!;
    for (const id of [arc.start, arc.end]) {
      const p = points.get(id)!;
      expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeCloseTo(3, 7);
    }
  }
  expect(JSON.stringify(source)).toBe(before);
});
