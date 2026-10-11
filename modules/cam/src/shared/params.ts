import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

const vector = Type.Tuple([Type.Number(), Type.Number(), Type.Number()]);

const faceRef = (title: string) =>
  Type.Object(
    {
      kind: Type.Literal("face"),
      bodyId: Type.String({ minLength: 1 }),
      faceName: Type.String(),
      sig: Type.Object({
        type: Type.String(),
        point: vector,
        direction: vector,
      }),
    },
    { title },
  );

export type FaceRef = Static<ReturnType<typeof faceRef>>;

const outside = Type.Literal("outside", { title: "Outside" });
const inside = Type.Literal("inside", { title: "Inside" });

export const contourParams = Type.Object({
  face: faceRef("Face"),
  side: Type.Union([outside, inside], { title: "Side" }),
  bottomOffset: Type.Number({ title: "Bottom offset", parameterUnit: "mm" }),
  opening: Type.Optional(Type.Integer({ minimum: 0 })),
});

export const pocketParams = Type.Object({
  floor: faceRef("Floor"),
  rampAngle: Type.Number({ title: "Ramp angle", parameterUnit: "deg" }),
});

export const adaptiveParams = Type.Object({
  ...pocketParams.properties,
  engagement: Type.Number({
    title: "Maximum engagement",
    parameterUnit: "deg",
    exclusiveMinimum: 0,
    maximum: 180,
  }),
});

export const drillParams = Type.Object({
  diameter: Type.Number({
    title: "Hole diameter",
    parameterUnit: "mm",
    exclusiveMinimum: 0,
  }),
  points: Type.Optional(Type.Array(Type.Tuple([Type.Number(), Type.Number()]))),
});

export const MIN_TOLERANCE = 0.001;
export const GOUGE_TOLERANCE = 0.01;

const tolerance = Type.Number({
  title: "Tolerance",
  parameterUnit: "mm",
  minimum: MIN_TOLERANCE,
});

export const parallelParams = Type.Object({
  angle: Type.Number({ title: "Pass angle", parameterUnit: "deg" }),
  tolerance,
});

export const waterlineParams = Type.Object({
  angle: Type.Number({ title: "Wall angle", parameterUnit: "deg" }),
  tolerance,
});

export const laserParams = Type.Object({
  face: faceRef("Face"),
  side: Type.Union(
    [outside, inside, Type.Literal("on", { title: "On the line" })],
    { title: "Side" },
  ),
  power: Type.Number({ title: "Power", parameterUnit: "%" }),
  feed: Type.Number({
    title: "Feed",
    parameterUnit: "mm/min",
    exclusiveMinimum: 0,
  }),
  passes: Type.Integer({ title: "Passes", minimum: 1 }),
  zStep: Type.Optional(
    Type.Number({ title: "Z step", parameterUnit: "mm", minimum: 0 }),
  ),
});

export function paramsOf<S extends TSchema>(
  schema: S,
  type: string,
  params: unknown,
): Static<S> {
  if (Value.Check(schema, params)) return params;
  const [error] = Value.Errors(schema, params);
  const field = error?.instancePath.slice(1).replaceAll("/", ".");
  throw new RangeError(
    `${type} params: ${field ? `${field} ` : ""}${error?.message ?? "are invalid"}`,
  );
}
