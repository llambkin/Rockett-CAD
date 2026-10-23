import { expect, it } from "vitest";
import {
  createSketchOffset,
  editSketchOffset,
  detectProfiles,
  solveSketch,
  solveWithOffsets,
  type SketchConstraint,
  type SketchEntity,
  type SketchFeature,
} from "../src/index.js";

const sketch: SketchFeature = {
  id: "sk",
  name: "Sketch",
  type: "sketch",
  suppressed: false,
  plane: { kind: "origin", plane: "XY" },
  constraints: [],
  entities: [
    { id: "p", kind: "point", x: 0, y: 0 },
    { id: "c", kind: "circle", center: "p", radius: 10 },
  ],
};

it("saves and re-edits an offset without breaking profile or entity references", () => {
  const created = createSketchOffset(sketch, ["c"], 2);
  const offset = created.offsets![0]!;
  const saved = JSON.parse(JSON.stringify(created));
  const changed = editSketchOffset(saved, offset.id, 4);
  expect(changed.entities.map((e) => e.id)).toEqual(
    created.entities.map((e) => e.id),
  );
  expect(detectProfiles(changed.entities).map((p) => p.id)).toEqual(
    detectProfiles(created.entities).map((p) => p.id),
  );
  expect(
    changed.entities.find((e) => e.id === offset.entityIds.at(-1)),
  ).toMatchObject({ radius: 14 });
  expect(changed.entities.slice(0, 2)).toEqual(sketch.entities);
  expect(saved.offsets![0]!.distance).toBe(2);
  expect(changed.offsets![0]!.distance).toBe(4);
});

it("updates a dependent offset and retains its references", () => {
  const first = createSketchOffset(sketch, ["c"], 2);
  const second = createSketchOffset(
    first,
    [first.offsets![0]!.entityIds.at(-1)!],
    3,
  );
  const changed = editSketchOffset(second, first.offsets![0]!.id, 4);
  expect(
    changed.entities.filter((e) => e.kind === "circle").map((e) => e.radius),
  ).toEqual([10, 14, 17]);
  expect(changed.entities.map((e) => e.id)).toEqual(
    second.entities.map((e) => e.id),
  );
});

it("keeps offset geometry driven when a user attempts to drag its point", () => {
  const created = createSketchOffset(sketch, ["c"], 2);
  const pointId = created.offsets![0]!.entityIds[0]!;
  const solved = solveSketch({
    entities: created.entities,
    constraints: [],
    drag: { pointId, x: 50, y: 50 },
  });
  expect(solved.entities.find((e) => e.id === pointId)).toMatchObject({
    x: 0,
    y: 0,
  });
});

it("rejects collapsed or deleted offsets without mutating the sketch", () => {
  const created = createSketchOffset(sketch, ["c"], 2);
  expect(() => editSketchOffset(created, created.offsets![0]!.id, -12)).toThrow(
    /collapse/,
  );
  expect(created.offsets![0]!.distance).toBe(2);
  const broken = { ...created, entities: created.entities.slice(0, -1) };
  expect(() => editSketchOffset(broken, created.offsets![0]!.id, 3)).toThrow(
    /deleted or trimmed/,
  );
});

it("retains the selected direction when editing a chained rectangle", () => {
  const rectangle: SketchFeature = {
    ...sketch,
    entities: [
      { id: "a", kind: "point", x: 0, y: 0 },
      { id: "b", kind: "point", x: 20, y: 0 },
      { id: "c", kind: "point", x: 20, y: 20 },
      { id: "d", kind: "point", x: 0, y: 20 },
      { id: "ab", kind: "line", p1: "a", p2: "b" },
      { id: "bc", kind: "line", p1: "b", p2: "c" },
      { id: "cd", kind: "line", p1: "c", p2: "d" },
      { id: "da", kind: "line", p1: "d", p2: "a" },
    ],
  };
  const created = createSketchOffset(rectangle, ["cd"], 2);
  expect(created.offsets![0]!.sourceIds[0]).toBe("cd");
  const changed = editSketchOffset(created, created.offsets![0]!.id, 3);
  const points = changed.entities.slice(8).filter((e) => e.kind === "point");
  expect(Math.min(...points.map((p) => p.x))).toBeCloseTo(3);
  expect(Math.max(...points.map((p) => p.x))).toBeCloseTo(17);
  expect(changed.entities.map((e) => e.id)).toEqual(
    created.entities.map((e) => e.id),
  );
});

const square = (): SketchFeature => ({
  ...sketch,
  entities: [
    { id: "a", kind: "point", x: 0, y: 0 },
    { id: "b", kind: "point", x: 20, y: 0 },
    { id: "c", kind: "point", x: 20, y: 20 },
    { id: "d", kind: "point", x: 0, y: 20 },
    { id: "ab", kind: "line", p1: "a", p2: "b" },
    { id: "bc", kind: "line", p1: "b", p2: "c" },
    { id: "cd", kind: "line", p1: "c", p2: "d" },
    { id: "da", kind: "line", p1: "d", p2: "a" },
  ],
  constraints: [
    { id: "fa", type: "fix", point: "a" },
    { id: "h1", type: "horizontal", line: "ab" },
    { id: "v1", type: "vertical", line: "bc" },
    { id: "h2", type: "horizontal", line: "cd" },
    { id: "v2", type: "vertical", line: "da" },
    { id: "w", type: "length", line: "ab", value: 20 },
    { id: "h", type: "length", line: "bc", value: 20 },
  ],
});

const offsetSpan = (entities: SketchEntity[], ids: string[]) => {
  const points = entities.filter(
    (e): e is Extract<SketchEntity, { kind: "point" }> =>
      e.kind === "point" && ids.includes(e.id),
  );
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
};

const resize = (constraints: SketchConstraint[], value: number) =>
  constraints.map((c) => (c.id === "w" ? { ...c, value } : c));

it("follows its source when the source rectangle is resized", () => {
  const created = createSketchOffset(square(), ["cd"], 2);
  const offset = created.offsets![0]!;
  const result = solveWithOffsets(
    {
      entities: created.entities,
      constraints: resize(created.constraints, 30),
      offsets: created.offsets,
    },
    created.entities,
  );
  expect(result.solved.converged).toBe(true);
  offsetSpan(result.solved.entities, offset.entityIds).forEach((v, i) =>
    expect(v).toBeCloseTo([2, 28, 2, 18][i]!, 6),
  );
  expect(result.removedConstraints).toBe(0);
});

it("keeps an offset on its side when its first source line has reversed", () => {
  const created = createSketchOffset(square(), ["cd"], 2);
  const id = created.offsets![0]!.id;
  const reversed = {
    ...created,
    entities: created.entities.map((e) =>
      e.id === "cd" ? { ...e, p1: "d", p2: "c" } : e,
    ),
  };
  const ids = created.offsets![0]!.entityIds;
  offsetSpan(editSketchOffset(reversed, id, 3).entities, ids).forEach((v, i) =>
    expect(v).toBeCloseTo([3, 17, 3, 17][i]!, 6),
  );
  offsetSpan(editSketchOffset(reversed, id, -3).entities, ids).forEach((v, i) =>
    expect(v).toBeCloseTo([-3, 23, -3, 23][i]!, 6),
  );
});

it("removes only offset-curve dimensions that following breaks", () => {
  const created = createSketchOffset(square(), ["cd"], 2);
  const ids = new Set(created.offsets![0]!.entityIds);
  const at = new Map(created.entities.map((e) => [e.id, e]));
  const top = created.entities.find(
    (e) =>
      e.kind === "line" &&
      ids.has(e.id) &&
      [e.p1, e.p2].every((p) => Math.abs((at.get(p) as any).y - 18) < 1e-6),
  )!;
  const constraints: SketchConstraint[] = [
    ...created.constraints,
    { id: "inner", type: "length", line: top.id, value: 16 },
  ];
  const input = { entities: created.entities, offsets: created.offsets };
  const still = solveWithOffsets({ ...input, constraints }, created.entities);
  expect(still.removedConstraints).toBe(0);
  expect(still.constraints.map((c) => c.id)).toContain("inner");
  const moved = solveWithOffsets(
    { ...input, constraints: resize(constraints, 30) },
    created.entities,
  );
  expect(moved.removedConstraints).toBe(1);
  expect(moved.constraints.map((c) => c.id)).not.toContain("inner");
  expect(moved.solved.converged).toBe(true);
});
