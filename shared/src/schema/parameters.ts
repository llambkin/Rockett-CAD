import { Type } from "typebox";
import { NAME_LENGTH } from "./coreFeatures.js";
import { featureIdSchema } from "./refs.js";
import { EXPRESSION_MAX_BYTES } from "../expressions.js";
import type { ParameterUnit } from "../parameters.js";
import { resolveDocumentParameters } from "../parameters.js";
import type { CadDocument } from "../model.js";
import { ANGLE_TO_DEGREES, UNIT_TO_MM } from "../units.js";

const expression = Type.String({
  minLength: 1,
  maxLength: EXPRESSION_MAX_BYTES,
});
export const parameterStateSchema = {
  parameters: Type.Array(
    Type.Object({
      name: Type.String({
        minLength: 1,
        maxLength: NAME_LENGTH,
      }),
      unit: Type.Enum([
        ...Object.keys(UNIT_TO_MM),
        ...Object.keys(ANGLE_TO_DEGREES),
        "unitless",
      ] as ParameterUnit[]),
      expression,
      comment: Type.String({ maxLength: 65536 }),
    }),
    { maxItems: 100000 },
  ),
  parameterBindings: Type.Array(
    Type.Object({
      featureId: featureIdSchema,
      path: Type.String({ minLength: 1, maxLength: 4096 }),
      expression,
    }),
    { maxItems: 100000 },
  ),
};

export function validParameterState(doc: unknown): boolean {
  try {
    resolveDocumentParameters(doc as CadDocument);
    return true;
  } catch {
    return false;
  }
}
