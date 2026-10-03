import { documentSchema, FEATURE_SCHEMAS } from "./features.js";
import { schemaValidator } from "./validation.js";
export { parse, ValidationError } from "./validation.js";

export function compileSchemas(): void {
  for (const schema of [documentSchema, ...Object.values(FEATURE_SCHEMAS)])
    schemaValidator(schema);
}
