import { Type, type TProperties, type TSchema } from "typebox";

export const splineEntities = <P extends TProperties, I extends TSchema>(
  base: P,
  id: I,
) =>
  [
    Type.Object({
      ...base,
      kind: Type.Literal("spline"),
      degree: Type.Integer(),
      poles: Type.Array(id),
      weights: Type.Optional(Type.Array(Type.Number())),
      knots: Type.Array(Type.Number()),
      multiplicities: Type.Array(Type.Integer()),
      periodic: Type.Optional(Type.Boolean()),
      rho: Type.Optional(Type.Number()),
    }),
    Type.Object({
      ...base,
      kind: Type.Literal("fitSpline"),
      points: Type.Array(id),
      handles: Type.Tuple([id, id]),
    }),
  ] as const;
