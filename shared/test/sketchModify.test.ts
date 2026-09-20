import { describe, expect, it } from "vitest";
import { detectProfiles, modifySketch, offsetSketch, projectEdge, solveSketch,
  type SketchEntity, type SketchPoint } from "../src/index.js";
const line = (id: string, a: [number, number], b: [number, number]): SketchEntity[] => [
  { id: id + "a", kind: "point", x: a[0], y: a[1] },
  { id: id + "b", kind: "point", x: b[0], y: b[1] },
  { id, kind: "line", p1: id + "a", p2: id + "b" },
];
const points = (es: SketchEntity[]) => new Map(es.filter((e): e is SketchPoint => e.kind === "point").map(e => [e.id, e]));
describe("sketch modifications", () => {
  it("trims the clicked middle section and retains two disconnected pieces", () => {
    const es = [...line("base", [0, 0], [20, 0]), ...line("a", [5, -5], [5, 5]), ...line("b", [15, -5], [15, 5])];
    const result = modifySketch(es, [{ id: "len", type: "length", line: "base", value: 20 },
      { id: "vertical", type: "vertical", line: "a" }], "base", { x: 10, y: 0 }, "trim");
    const p = points(result.entities);
    const intervals = result.entities.filter(e => e.kind === "line" && !["a", "b"].includes(e.id))
      .map(e => e.kind === "line" && [p.get(e.p1)!.x, p.get(e.p2)!.x]);
    expect(intervals).toEqual([[0, 5], [15, 20]]);
    expect(result.removedConstraints).toBe(1);
    expect(result.constraints.map(c => c.id)).toEqual(["vertical"]);
    expect(points(es).get("baseb")!.x).toBe(20);
  });
  it("extends the nearest endpoint to the first bounded intersection", () => {
    const es = [...line("base", [0, 0], [10, 0]), ...line("near", [15, -5], [15, 5]), ...line("far", [20, -5], [20, 5])];
    const result = modifySketch(es, [], "base", { x: 9, y: 0 }, "extend");
    const p = points(result.entities), e = result.entities.find(e => e.id === "base")!;
    expect(e.kind === "line" && p.get(e.p2)!.x).toBe(15);
    expect(() => modifySketch(es, [], "base", { x: 1, y: 0 }, "extend")).toThrow(/No boundary/);
  });
  it("trims a circle to an arc across the angle wrap", () => {
    const es: SketchEntity[] = [{ id: "c", kind: "point", x: 0, y: 0 },
      { id: "circle", kind: "circle", center: "c", radius: 5 }, ...line("axis", [0, -10], [0, 10])];
    const result = modifySketch(es, [], "circle", { x: 5, y: 0 }, "trim");
    const arc = result.entities.find(e => e.id === "circle")!;
    expect(arc.kind).toBe("arc");
    if (arc.kind !== "arc") return;
    const p = points(result.entities);
    expect(p.get(arc.start)!.y).toBeCloseTo(5);
    expect(p.get(arc.end)!.y).toBeCloseTo(-5);
    expect(solveSketch({ entities: result.entities, constraints: [] }).converged).toBe(true);
  });
  it("offsets a closed rectangle with connected mitered corners and rejects collapse", () => {
    const es = [...line("a", [0, 0], [20, 0]), ...line("b", [20, 0], [20, 10]),
      ...line("c", [20, 10], [0, 10]), ...line("d", [0, 10], [0, 0])];
    const result = offsetSketch(es, [], "a", 2);
    const p = [...points(result.entities.slice(es.length)).values()];
    expect(p.map(e => [e.x, e.y])).toEqual([[2, 2], [18, 2], [18, 8], [2, 8]]);
    expect(detectProfiles(result.entities.slice(es.length))).toHaveLength(1);
    expect(() => offsetSketch(es, [], "a", 6)).toThrow(/collapses/);
  });
  it("offsets circles and protects external references from trimming", () => {
    const es: SketchEntity[] = [{ id: "p", kind: "point", x: 0, y: 0 },
      { id: "c", kind: "circle", center: "p", radius: 5, external: true }];
    const offset = offsetSketch(es, [], "c", 2).entities;
    expect(offset.at(-1)).toMatchObject({ kind: "circle", radius: 7 });
    expect(new Set(offset.map(e => e.id)).size).toBe(offset.length);
    expect(detectProfiles(offset.slice(es.length))).toHaveLength(1);
    expect(solveSketch({ entities: offset, constraints: [] }).converged).toBe(true);
    expect(() => offsetSketch(es, [], "c", -6)).toThrow(/collapse/);
    expect(() => modifySketch(es, [], "c", { x: 5, y: 0 }, "trim")).toThrow(/Projected/);
  });
});
describe("projected geometry", () => {
  const frame = { origin: [0, 0, 20], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] } as const;
  const f = JSON.parse(JSON.stringify(frame));
  const ref = { kind: "edge", bodyId: "body", edgeName: "edge" } as const;
  it("keeps stable IDs and drives constrained geometry after a source edit", () => {
    const build = (width: number) => projectEdge({ type: "line", a: [0, 0, 20], b: [width, 0, 20] }, f, "proj", ref);
    const first = build(100), next = build(120);
    expect(first.map(e => e.id)).toEqual(next.map(e => e.id));
    const solved = solveSketch({ entities: [...next, { id: "mid", kind: "point", x: 50, y: 0 }],
      constraints: [{ id: "midpoint", type: "midpoint", point: "mid", line: "proj" }] });
    expect(points(solved.entities).get("mid")!.x).toBeCloseTo(60, 4);
    expect(detectProfiles(next)).toHaveLength(0);
  });
  it("rejects edge-on lines and tilted circles instead of approximating them", () => {
    expect(() => projectEdge({ type: "line", a: [0, 0, 0], b: [0, 0, 20] }, f, "p", ref)).toThrow(/point/);
    expect(() => projectEdge({ type: "circle", center: [0, 0, 0], axis: [1, 0, 0], radius: 5 }, f, "p", ref)).toThrow(/ellipses/);
  });
});
