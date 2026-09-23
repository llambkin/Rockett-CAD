import { beforeAll, expect, it } from "vitest";
import {
  createEmptyDocument,
  detectProfiles,
  type SketchFeature,
} from "@rockett/shared";
import { dropEngine, engineFor } from "../src/geometry/engine.js";
import { faces, getKernel, initKernel } from "../src/geometry/kernel.js";
import { finalizeNames } from "../src/geometry/naming.js";
import { ShapeMap } from "../src/geometry/shapeMap.js";

beforeAll(initKernel, 120_000);

function withCollidingHash<T>(run: () => T): T {
  const proto = getKernel().TopoDS_Shape.prototype;
  const hashCode = proto.HashCode;
  proto.HashCode = () => 1;
  try {
    return run();
  } finally {
    proto.HashCode = hashCode;
  }
}

it("faces() of a box keeps all six faces when their hashes collide", () => {
  const box = new (getKernel().BRepPrimAPI_MakeBox_2)(20, 30, 10);

  expect(faces(box.Shape())).toHaveLength(6);
  expect(withCollidingHash(() => faces(box.Shape()))).toHaveLength(6);
  box.delete();
});

it("finalizeNames keeps six names for six faces when their hashes collide", () => {
  const box = new (getKernel().BRepPrimAPI_MakeBox_2)(20, 30, 10);
  const six = faces(box.Shape());

  const names = withCollidingHash(() => {
    const provisional = new ShapeMap<string>();
    six.forEach((f, i) => provisional.set(f, `f:box:${i + 1}`));
    return finalizeNames(box.Shape(), provisional, "box");
  });

  expect(six).toHaveLength(6);
  expect(names.size).toBe(6);
  box.delete();
});

it("evaluate meshes a rewound body again when its shape hash collides with the tip", () => {
  const sketch: SketchFeature = {
    id: "s0",
    name: "s0",
    type: "sketch",
    suppressed: false,
    plane: { kind: "origin", plane: "XY" },
    constraints: [],
    entities: [
      { id: "a", kind: "point", x: 0, y: 0 },
      { id: "b", kind: "point", x: 2, y: 0 },
      { id: "c", kind: "point", x: 2, y: 2 },
      { id: "d", kind: "point", x: 0, y: 2 },
      { id: "ab", kind: "line", p1: "a", p2: "b" },
      { id: "bc", kind: "line", p1: "b", p2: "c" },
      { id: "cd", kind: "line", p1: "c", p2: "d" },
      { id: "da", kind: "line", p1: "d", p2: "a" },
    ],
  };
  const doc = createEmptyDocument("identity-rewind", "identity-rewind");
  doc.features = [
    sketch,
    {
      id: "box",
      name: "box",
      type: "extrude",
      suppressed: false,
      profiles: [
        { sketchId: "s0", profileId: detectProfiles(sketch.entities)[0]!.id },
      ],
      distance: 1,
      direction: "normal",
      operation: "newBody",
    },
    {
      id: "up",
      name: "up",
      type: "move",
      suppressed: false,
      bodies: ["b:box"],
      translation: [0, 0, 5],
    },
  ];
  doc.timelinePosition = doc.features.length;
  const engine = engineFor(doc.id);
  const lowestZ = (position?: number) =>
    engine.evaluate(doc, position).bodies[0]!.bbox.min[2];

  const [tip, rewound] = withCollidingHash(() => [lowestZ(), lowestZ(2)]);

  expect(tip).toBeCloseTo(5);
  expect(rewound).toBeCloseTo(0);
  dropEngine(doc.id);
});
