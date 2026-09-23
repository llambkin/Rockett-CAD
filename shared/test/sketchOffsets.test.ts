import { expect, it } from "vitest";
import {
  createSketchOffset,
  editSketchOffset,
  detectProfiles,
  solveSketch,
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
  const offset = created.offsets![0];
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
  expect(saved.offsets![0].distance).toBe(2);
  expect(changed.offsets![0].distance).toBe(4);
});

it("updates a dependent offset and retains its references", () => {
  const first = createSketchOffset(sketch, ["c"], 2);
  const second = createSketchOffset(
    first,
    [first.offsets![0].entityIds.at(-1)!],
    3,
  );
  const changed = editSketchOffset(second, first.offsets![0].id, 4);
  expect(
    changed.entities.filter((e) => e.kind === "circle").map((e) => e.radius),
  ).toEqual([10, 14, 17]);
  expect(changed.entities.map((e) => e.id)).toEqual(
    second.entities.map((e) => e.id),
  );
});

it("keeps offset geometry driven when a user attempts to drag its point", () => {
  const created = createSketchOffset(sketch, ["c"], 2);
  const pointId = created.offsets![0].entityIds[0];
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
  expect(() => editSketchOffset(created, created.offsets![0].id, -12)).toThrow(
    /collapse/,
  );
  expect(created.offsets![0].distance).toBe(2);
  const broken = { ...created, entities: created.entities.slice(0, -1) };
  expect(() => editSketchOffset(broken, created.offsets![0].id, 3)).toThrow(
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
  expect(created.offsets![0].sourceIds[0]).toBe("cd");
  const changed = editSketchOffset(created, created.offsets![0].id, 3);
  const points = changed.entities.slice(8).filter((e) => e.kind === "point");
  expect(Math.min(...points.map((p) => p.x))).toBeCloseTo(3);
  expect(Math.max(...points.map((p) => p.x))).toBeCloseTo(17);
  expect(changed.entities.map((e) => e.id)).toEqual(
    created.entities.map((e) => e.id),
  );
});
