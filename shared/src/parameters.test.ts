import { Type } from "typebox";
import { expect, it } from "vitest";
import {
  createEmptyDocument,
  movedBindings,
  registerExtensionSpec,
  resolveDocumentParameters,
  type UserParameter,
} from "./index.js";
import { documentSchema } from "./schema/features.js";
import { parse } from "./schema/index.js";

const parameter = (
  name = "width",
  expression = "40 mm",
  unit: UserParameter["unit"] = "mm",
): UserParameter => ({ name, expression, unit, comment: "Stock width" });
const fixture = () => ({
  ...createEmptyDocument("parameters", "Parameters"),
  parameters: [parameter()],
  parameterBindings: [
    { featureId: "extrude", path: "/distance", expression: "width / 2" },
  ],
  features: [
    {
      id: "extrude",
      type: "extrude" as const,
      name: "Extrude",
      suppressed: false,
      profiles: [{ sketchId: "sketch", profileId: "profile" }],
      distance: 5,
      direction: "normal" as const,
      operation: "newBody" as const,
    },
  ],
  timelinePosition: 1,
});

it("resolves named units and numeric bindings without mutating stored numbers or expressions", () => {
  const doc = fixture();
  const before = structuredClone(doc);
  const resolved = resolveDocumentParameters(doc);
  expect(resolved.values.width).toEqual({ value: 40, dimension: "length" });
  expect(resolved.features[0]).toMatchObject({ distance: 20 });
  expect(doc).toEqual(before);
  expect(parse(documentSchema, doc)).toBe(doc);
});

it.each([
  ["invalid name", [parameter("a-b")]],
  ["duplicate name", [parameter(), parameter()]],
  ["unknown reference", [parameter("width", "missing")]],
  ["cycle", [parameter("a", "b"), parameter("b", "a")]],
  ["incompatible unit", [parameter("width", "40 deg")]],
])("refuses %s before accepting a document", (_, parameters) => {
  const doc = { ...fixture(), parameters };
  expect(() => resolveDocumentParameters(doc)).toThrow();
  expect(() => parse(documentSchema, doc)).toThrow();
});

it.each([
  "/name",
  "/profiles/0/sketchId",
  "/missing",
  "/__proto__/value",
  "/distance/toString",
  "/distance2",
])("refuses unauthorized binding %s", (path) => {
  const doc = fixture();
  doc.parameterBindings[0]!.path = path;
  expect(() => resolveDocumentParameters(doc)).toThrow();
  expect(() => parse(documentSchema, doc)).toThrow();
});

it.each(["200001 mm", "0 mm", "20 deg"])(
  "refuses a binding outside the numeric schema: %s",
  (expression) => {
    const doc = fixture();
    doc.parameterBindings[0]!.expression = expression;
    expect(() => resolveDocumentParameters(doc)).toThrow();
    expect(() => parse(documentSchema, doc)).toThrow();
  },
);

it("resolves forward references and declared-unit literals once, including long dependency chains", () => {
  const doc = {
    ...fixture(),
    parameterBindings: [],
    parameters: [parameter("width", "half * 2"), parameter("half", "2", "cm")],
  };
  expect(resolveDocumentParameters(doc).values.width).toEqual({
    value: 40,
    dimension: "length",
  });
  doc.parameters = Array.from({ length: 2000 }, (_, i) =>
    parameter(`p${i}`, i === 1999 ? "40 mm" : `p${i + 1}`),
  );
  expect(resolveDocumentParameters(doc).values.p0).toEqual({
    value: 40,
    dimension: "length",
  });
});

it("rejects unknown and duplicate binding targets and unknown names in binding expressions", () => {
  const doc = fixture();
  doc.parameterBindings[0]!.featureId = "missing";
  expect(() => parse(documentSchema, doc)).toThrow();
  doc.parameterBindings[0]!.featureId = "extrude";
  doc.parameterBindings.push({ ...doc.parameterBindings[0]! });
  expect(() => parse(documentSchema, doc)).toThrow();
  doc.parameterBindings.pop();
  doc.parameterBindings[0]!.expression = "unknown";
  expect(() => parse(documentSchema, doc)).toThrow();
});

it("resolves schema units through nested unions, arrays and tuples and excludes display and reference metadata", () => {
  const doc = createEmptyDocument("nested", "Nested");
  doc.parameters = [parameter()];
  doc.features = [
    {
      id: "sketch",
      type: "sketch",
      name: "Sketch",
      suppressed: false,
      plane: { kind: "origin", plane: "XY" },
      entities: [{ id: "point", kind: "point", x: 0, y: 0 }],
      constraints: [
        {
          id: "angle",
          type: "lineAngle",
          line: "line",
          value: 45,
          labelOffset: [1, 2],
        },
      ],
    },
    {
      id: "move",
      type: "move",
      name: "Move",
      suppressed: false,
      bodies: ["body"],
      translation: [0, 0, 0],
      axis: { kind: "originAxis", axis: "Z" },
      angle: 0,
      copy: false,
    },
  ];
  doc.timelinePosition = 2;
  doc.parameterBindings = [
    { featureId: "sketch", path: "/entities/0/x", expression: "width" },
    {
      featureId: "sketch",
      path: "/constraints/0/value",
      expression: "width",
    },
    { featureId: "move", path: "/translation/1", expression: "width / 2" },
  ];
  expect(() => parse(documentSchema, doc)).toThrow();
  doc.parameterBindings[1]!.expression = "90 deg";
  const result = resolveDocumentParameters(doc);
  expect(result.features[0]).toMatchObject({
    entities: [{ x: 40, y: 0 }],
    constraints: [{ value: 90 }],
  });
  expect(result.features[1]).toMatchObject({ translation: [0, 20, 0] });
  expect(parse(documentSchema, doc)).toBe(doc);
  doc.parameterBindings[0]!.path = "/constraints/0/labelOffset/0";
  expect(() => parse(documentSchema, doc)).toThrow();
  doc.parameterBindings[0]!.path = "/constraints/0/value";
  doc.parameterBindings[0]!.expression = "-180 deg";
  expect(() => parse(documentSchema, doc)).toThrow();
});

it("lets the registered feature schema authorize extension numeric inputs and retain opaque data", () => {
  const release = registerExtensionSpec({
    type: "synthetic.parameter",
    label: "Synthetic",
    version: 1,
    params: Type.Object({
      depth: Type.Number({ minimum: 1, maximum: 100, parameterUnit: "mm" }),
      opaque: Type.Unknown(),
    }),
  });
  try {
    const doc = createEmptyDocument("extension", "Extension");
    doc.parameters = [parameter()];
    doc.features = [
      {
        id: "extension",
        type: "synthetic.parameter",
        name: "Extension",
        suppressed: false,
        version: 1,
        params: { depth: 5, opaque: { nested: ["unchanged", 7] } },
      },
    ];
    doc.timelinePosition = 1;
    doc.parameterBindings = [
      {
        featureId: "extension",
        path: "/params/depth",
        expression: "width / 2",
      },
    ];
    expect(parse(documentSchema, doc)).toBe(doc);
    expect(resolveDocumentParameters(doc).features[0]).toMatchObject({
      params: { depth: 20, opaque: { nested: ["unchanged", 7] } },
    });
    doc.parameterBindings[0]!.path = "/params/opaque/nested/1";
    expect(() => parse(documentSchema, doc)).toThrow();
  } finally {
    release();
  }
});

it("leaves a binding on a missing module's feature unresolved with its stored value", () => {
  const release = registerExtensionSpec({
    type: "acme.gear",
    label: "Gear",
    version: 1,
    params: Type.Object({ teeth: Type.Number({ parameterUnit: "mm" }) }),
  });
  const doc = createEmptyDocument("missing", "Missing");
  doc.parameters = [parameter("n", "24 mm")];
  doc.features = [
    {
      id: "gear",
      type: "acme.gear",
      name: "Gear",
      suppressed: false,
      version: 1,
      params: { teeth: 12 },
    },
  ];
  doc.timelinePosition = 1;
  doc.parameterBindings = [
    { featureId: "gear", path: "/params/teeth", expression: "n" },
  ];
  try {
    expect(resolveDocumentParameters(doc).features[0]).toMatchObject({
      params: { teeth: 24 },
    });
  } finally {
    release();
  }
  expect(parse(documentSchema, doc)).toBe(doc);
  expect(resolveDocumentParameters(doc).features[0]).toMatchObject({
    params: { teeth: 12 },
  });
  doc.parameterBindings[0]!.expression = "unknown";
  expect(() => parse(documentSchema, doc)).toThrow();
});

it("moves bindings with the items they name and drops bindings of removed items", () => {
  const before = {
    id: "s",
    type: "sketch" as const,
    name: "Sketch",
    suppressed: false,
    plane: { kind: "origin" as const, plane: "XY" as const },
    entities: [
      { id: "a", kind: "point" as const, x: 0, y: 0 },
      { id: "b", kind: "point" as const, x: 5, y: 0 },
    ],
    constraints: [
      { id: "fix", type: "fix" as const, point: "a" },
      {
        id: "d",
        type: "distance" as const,
        a: "a",
        b: "b",
        axis: null,
        value: 5,
      },
    ],
  };
  const after = {
    ...before,
    entities: [before.entities[1]!],
    constraints: [
      { id: "h", type: "fix" as const, point: "b" },
      ...before.constraints,
    ],
  };
  const other = { featureId: "e", path: "/distance", expression: "w" };
  expect(
    movedBindings(
      [
        { featureId: "s", path: "/constraints/1/value", expression: "w" },
        { featureId: "s", path: "/entities/0/x", expression: "w" },
        { featureId: "s", path: "/entities/1/x", expression: "w" },
        other,
      ],
      before,
      after,
    ),
  ).toEqual([
    { featureId: "s", path: "/constraints/2/value", expression: "w" },
    { featureId: "s", path: "/entities/0/x", expression: "w" },
    other,
  ]);
});
