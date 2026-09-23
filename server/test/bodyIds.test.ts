import { beforeAll, expect, it } from "vitest";
import {
  detectProfiles,
  type Feature,
  type ProfileRef,
  type SketchFeature,
} from "@rockett/shared";
import { initKernel } from "../src/geometry/kernel.js";
import {
  box,
  evaluateTimeline,
  meta,
  rect,
  xSpans,
} from "./helpers/dumpNames.js";

beforeAll(initKernel, 120_000);

function evaluate(features: Feature[]) {
  const result = evaluateTimeline("body-ids", features);
  return {
    status: result.featureStatuses.at(-1),
    xSpans: xSpans(result),
    filletFaces: result.bodies.map((b) => [
      b.bodyId,
      b.faces.map((f) => f.name).filter((n) => n.startsWith("f:fil:")),
    ]),
  };
}

const splitPlate = (slotX: number): Feature[] => [
  ...box("plate", 0, 0, 40, 20, 5),
  ...box("slot", slotX, -5, 2, 30, 5, "cut"),
  {
    ...meta("fil"),
    type: "fillet",
    edges: [
      {
        kind: "edge",
        bodyId: "b:plate",
        edgeName: "e[f:plate:s:plateSk-l1~2|f:plate:s:plateSk-l2]",
      },
    ],
    radius: 1,
  },
];

it("the larger split piece takes b:plate, so moving the slot breaks a fillet on it", () => {
  const before = evaluate(splitPlate(10));
  const after = evaluate(splitPlate(28));

  expect(before.status?.status).toBe("ok");
  expect(before.xSpans).toEqual({ "b:plate": [12, 40], "b:plate:2": [0, 10] });
  expect(before.filletFaces).toEqual([
    ["b:plate", ["f:fil:fe:1"]],
    ["b:plate:2", []],
  ]);
  expect(after.status?.status).toBe("error");
  expect(after.status?.error).toMatch(/referenced edge no longer exists/);
  expect(after.xSpans).toEqual({ "b:plate": [0, 28], "b:plate:2": [30, 40] });
});

const pair: SketchFeature = {
  ...rect("pair", 5, 0, 5, 5),
  entities: [
    ...rect("pair", 5, 0, 5, 5).entities,
    ...rect("far", 15, 0, 10, 5).entities,
  ],
};
const [near, far] = detectProfiles(pair.entities).map((p): ProfileRef => ({
  sketchId: pair.id,
  profileId: p.id,
}));

it.each([
  [
    "extrude",
    (profiles: ProfileRef[]): Feature => ({
      ...meta("tool"),
      type: "extrude",
      profiles,
      distance: 5,
      direction: "normal",
      operation: "newBody",
    }),
    [5, 10],
    [15, 25],
  ],
  [
    "revolve",
    (profiles: ProfileRef[]): Feature => ({
      ...meta("tool"),
      type: "revolve",
      profiles,
      axis: { kind: "originAxis", axis: "Y" },
      angle: 360,
      operation: "newBody",
    }),
    [-10, 10],
    [-25, 25],
  ],
])(
  "a two-profile %s names its new bodies in profile order",
  (_, tool, nearSpan, farSpan) => {
    expect(evaluate([pair, tool([near!, far!])]).xSpans).toEqual({
      "b:tool": nearSpan,
      "b:tool:2": farSpan,
    });
    expect(evaluate([pair, tool([far!, near!])]).xSpans).toEqual({
      "b:tool": farSpan,
      "b:tool:2": nearSpan,
    });
  },
);
