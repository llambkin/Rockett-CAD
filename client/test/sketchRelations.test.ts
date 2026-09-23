import { expect, it } from "vitest";
import type { SketchConstraint } from "@rockett/shared";
import { constraintFor, relationsFor } from "../src/sketchRelations";
import { entities, TYPES, toolbarCases } from "./helpers/sketchRelationCases";

const draft = (constraints: SketchConstraint[] = []) => ({
  entities,
  constraints,
});

const offered = (ids: string[], constraints: SketchConstraint[] = []) =>
  relationsFor(draft(constraints), ids).map((r) => [
    r.label,
    r.constraints.map((c) => ({ ...c, id: undefined })),
  ]);

it("builds the toolbar constraint for each selection and type", () => {
  for (const { ids, made } of toolbarCases)
    for (const type of TYPES) {
      const c = constraintFor(draft(), ids, type);
      if (made[type]) expect(c, `${ids} ${type}`).toMatchObject(made[type]);
      else expect(c, `${ids} ${type}`).toBeNull();
    }
});

it("offers the relations that take the whole selection", () => {
  expect(offered(["q", "o1"])).toEqual([
    ["Coincident", [{ type: "pointOnCircle", point: "q", circle: "o1" }]],
  ]);
  expect(offered(["q", "l1"])).toEqual([
    ["Coincident", [{ type: "pointOnLine", point: "q", line: "l1" }]],
    ["Midpoint", [{ type: "midpoint", point: "q", line: "l1" }]],
  ]);
  expect(offered(["l1", "l2"])).toEqual([
    [
      "Horizontal",
      [
        { type: "horizontal", line: "l1" },
        { type: "horizontal", line: "l2" },
      ],
    ],
    [
      "Vertical",
      [
        { type: "vertical", line: "l1" },
        { type: "vertical", line: "l2" },
      ],
    ],
    ["Parallel", [{ type: "parallel", a: "l1", b: "l2" }]],
    ["Perpendicular", [{ type: "perpendicular", a: "l1", b: "l2" }]],
    ["Equal", [{ type: "equal", a: "l1", b: "l2" }]],
    ["Collinear", [{ type: "collinear", a: "l1", b: "l2" }]],
  ]);
  expect(offered(["l1", "o1"])).toEqual([
    ["Coincident", [{ type: "pointOnCircle", point: "b", circle: "o1" }]],
    ["Tangent", [{ type: "tangent", a: "l1", b: "o1" }]],
  ]);
  expect(offered(["r1", "l2"]).map(([label]) => label)).toEqual([
    "Coincident",
    "Tangent",
  ]);
  expect(offered(["o1", "r1"])).toEqual([
    ["Tangent", [{ type: "tangent", a: "o1", b: "r1" }]],
    ["Equal", [{ type: "equal", a: "o1", b: "r1" }]],
    ["Concentric", [{ type: "concentric", a: "o1", b: "r1" }]],
  ]);
  expect(offered(["l1"])).toEqual([
    ["Horizontal", [{ type: "horizontal", line: "l1" }]],
    ["Vertical", [{ type: "vertical", line: "l1" }]],
  ]);
  expect(offered(["q"])).toEqual([["Fix", [{ type: "fix", point: "q" }]]]);
  expect(offered(["q", "b"])).toEqual([
    ["Coincident", [{ type: "coincident", a: "q", b: "b" }]],
  ]);
});

it("offers nothing that leaves part of the selection out", () => {
  expect(offered([])).toEqual([]);
  expect(offered(["a", "l1"])).toEqual([]);
  expect(offered(["q", "l1", "o1"])).toEqual([]);
  expect(offered(["q", "b", "d"])).toEqual([]);
  expect(offered(["q", "missing"])).toEqual([]);
});

it("skips a relation that already holds on those entities", () => {
  expect(
    offered(["l1"], [{ id: "h", type: "horizontal", line: "l1" }]),
  ).toEqual([["Vertical", [{ type: "vertical", line: "l1" }]]]);
  expect(
    offered(
      ["q", "o1"],
      [{ id: "p", type: "pointOnCircle", point: "q", circle: "o1" }],
    ),
  ).toEqual([]);
  expect(
    offered(
      ["l1", "l2"],
      [{ id: "p", type: "parallel", a: "l2", b: "l1" }],
    ).map(([label]) => label),
  ).not.toContain("Parallel");
  expect(
    offered(["l1", "l2"], [{ id: "h", type: "horizontal", line: "l1" }])[0],
  ).toEqual(["Horizontal", [{ type: "horizontal", line: "l2" }]]);
});
