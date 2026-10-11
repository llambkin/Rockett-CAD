import { Type, type TSchema } from "typebox";
import { Value } from "typebox/value";
import type {
  CadDocument,
  Feature,
  ParameterBinding,
  UserParameter,
} from "./model.js";
import { evaluateExpression, type Scalar } from "./expressions.js";
import { featureSpec, opaqueFeature } from "./featureSpec.js";
import { FEATURE_SCHEMAS } from "./schema/coreFeatures.js";
import { ANGLE_TO_DEGREES, UNIT_TO_MM } from "./units.js";

export type ParameterUnit =
  keyof typeof UNIT_TO_MM | keyof typeof ANGLE_TO_DEGREES | "unitless";

function inUnit(result: Scalar, unit: ParameterUnit): Scalar {
  if (
    unit !== "unitless" &&
    !Object.hasOwn(UNIT_TO_MM, unit) &&
    !Object.hasOwn(ANGLE_TO_DEGREES, unit)
  )
    throw new Error("Unknown parameter unit");
  const dimension =
    unit === "unitless"
      ? "unitless"
      : Object.hasOwn(UNIT_TO_MM, unit)
        ? "length"
        : "angle";
  if (result.dimension === dimension) return result;
  if (result.dimension !== "unitless" || dimension === "unitless")
    throw new Error("Parameter units do not match");
  const scale =
    dimension === "length"
      ? UNIT_TO_MM[unit as keyof typeof UNIT_TO_MM]
      : ANGLE_TO_DEGREES[unit as keyof typeof ANGLE_TO_DEGREES];
  const value = result.value * scale;
  if (!Number.isFinite(value))
    throw new Error("Parameter result must be finite");
  return { value, dimension };
}

class Dependency extends Error {
  constructor(readonly parameter: UserParameter) {
    super("Unresolved parameter");
  }
}

function resolveParameters(
  parameters: readonly UserParameter[],
): Record<string, Scalar> {
  const values: Record<string, Scalar> = Object.create(null);
  const inputs: Record<string, Scalar> = Object.create(null);
  for (const parameter of parameters) {
    if (
      !/^[A-Za-z_][A-Za-z_0-9]*$/.test(parameter.name) ||
      Object.hasOwn(inputs, parameter.name)
    )
      throw new Error("Parameter names must be valid and unique");
    Object.defineProperty(inputs, parameter.name, {
      get: () => {
        if (!Object.hasOwn(values, parameter.name))
          throw new Dependency(parameter);
        return values[parameter.name];
      },
    });
  }
  for (const parameter of parameters) {
    const stack = [parameter];
    const active = new Set([parameter.name]);
    while (stack.length) {
      const current = stack.at(-1)!;
      if (Object.hasOwn(values, current.name)) {
        stack.pop();
        active.delete(current.name);
        continue;
      }
      try {
        values[current.name] = inUnit(
          evaluateExpression(current.expression, inputs),
          current.unit,
        );
      } catch (error) {
        if (!(error instanceof Dependency)) throw error;
        if (active.has(error.parameter.name))
          throw new Error("Parameter dependency cycle", { cause: error });
        stack.push(error.parameter);
        active.add(error.parameter.name);
      }
    }
  }
  return values;
}

function numericSchema(
  schema: TSchema,
  value: unknown,
  parts: readonly string[],
): TSchema {
  if (Type.IsUnion(schema)) {
    const variant = schema.anyOf.find((candidate) =>
      Value.Check(candidate, value),
    );
    if (!variant) throw new Error("Binding does not match a numeric schema");
    return numericSchema(variant, value, parts);
  }
  if (!parts.length) {
    if (
      (!Type.IsNumber(schema) && !Type.IsInteger(schema)) ||
      !Object.hasOwn(schema, "parameterUnit") ||
      typeof value !== "number"
    )
      throw new Error("Binding must target an authorized numeric input");
    return schema;
  }
  const [part, ...rest] = parts;
  if (
    Type.IsObject(schema) &&
    typeof value === "object" &&
    value !== null &&
    Object.hasOwn(value, part!) &&
    Object.hasOwn(schema.properties ?? {}, part!)
  )
    return numericSchema(
      schema.properties[part!]!,
      (value as Record<string, unknown>)[part!],
      rest,
    );
  if (
    (Type.IsArray(schema) || Type.IsTuple(schema)) &&
    Array.isArray(value) &&
    /^(0|[1-9][0-9]*)$/.test(part!) &&
    Number(part) < value.length
  ) {
    const child = Type.IsTuple(schema)
      ? schema.items[Number(part)]
      : schema.items;
    if (child) return numericSchema(child, value[Number(part)], rest);
  }
  throw new Error("Binding path is not an authorized numeric input");
}

export function resolveDocumentParameters(
  doc: Pick<CadDocument, "parameters" | "parameterBindings" | "features">,
): { values: Record<string, Scalar>; features: Feature[] } {
  const values = resolveParameters(doc.parameters);
  if (!doc.parameterBindings.length) return { values, features: doc.features };
  const features = structuredClone(doc.features);
  const byId = new Map(features.map((feature) => [feature.id, feature]));
  if (byId.size !== features.length)
    throw new Error("Binding feature IDs must be unique");
  const seen = new Set<string>();
  for (const binding of doc.parameterBindings) {
    const key = JSON.stringify([binding.featureId, binding.path]);
    if (seen.has(key)) throw new Error("Duplicate numeric binding");
    seen.add(key);
    const feature = byId.get(binding.featureId);
    const schema =
      feature &&
      (featureSpec(feature.type)?.paramsSchema ??
        (Object.hasOwn(FEATURE_SCHEMAS, feature.type)
          ? FEATURE_SCHEMAS[feature.type as keyof typeof FEATURE_SCHEMAS]
          : undefined));
    if (feature && opaqueFeature(feature)) {
      evaluateExpression(binding.expression, values);
      continue;
    }
    if (
      !feature ||
      !schema ||
      !/^\/(?:[A-Za-z_][A-Za-z_0-9]*|0|[1-9][0-9]*)(?:\/(?:[A-Za-z_][A-Za-z_0-9]*|0|[1-9][0-9]*))*$/.test(
        binding.path,
      )
    )
      throw new Error("Unknown numeric binding target");
    const parts = binding.path.slice(1).split("/");
    const numeric = numericSchema(schema, feature, parts);
    const result = inUnit(
      evaluateExpression(binding.expression, values),
      ("parameterUnit" in numeric
        ? numeric.parameterUnit
        : undefined) as ParameterUnit,
    );
    if (!Value.Check(numeric, result.value))
      throw new Error("Binding result is outside its numeric schema");
    let target: Record<string, unknown> = feature as unknown as Record<
      string,
      unknown
    >;
    for (const part of parts.slice(0, -1))
      target = target[part] as Record<string, unknown>;
    target[parts.at(-1)!] = result.value;
  }
  return { values, features };
}

export function resolvedFeatureIn<F extends Feature>(
  doc: Pick<CadDocument, "parameters" | "parameterBindings" | "features">,
  feature: F,
): F {
  if (!doc.parameterBindings.some((b) => b.featureId === feature.id))
    return feature;
  try {
    const found = resolveDocumentParameters(doc).features.find(
      (x) => x.id === feature.id,
    );
    return found?.type === feature.type ? (found as F) : feature;
  } catch {
    return feature;
  }
}

const LISTED = /^\/([A-Za-z_][A-Za-z_0-9]*)\/(0|[1-9][0-9]*)(\/.+)$/;

const listOf = (feature: Feature, key: string): unknown[] => {
  const items = (feature as unknown as Record<string, unknown>)[key];
  return Array.isArray(items) ? items : [];
};

const idOf = (item: unknown): unknown =>
  typeof item === "object" && item !== null
    ? (item as { id?: unknown }).id
    : undefined;

export function bindingHolds(feature: object, path: string): boolean {
  let at: unknown = feature;
  for (const part of path.slice(1).split("/")) {
    if (typeof at !== "object" || at === null || !Object.hasOwn(at, part))
      return false;
    at = (at as Record<string, unknown>)[part];
  }
  return typeof at === "number";
}

export function movedBindings(
  bindings: readonly ParameterBinding[],
  before: Feature,
  after: Feature,
): ParameterBinding[] {
  return bindings.flatMap((binding) => {
    const found = binding.featureId === after.id && LISTED.exec(binding.path);
    if (!found) return [binding];
    const [, key, index, rest] = found;
    const id = idOf(listOf(before, key!)[Number(index)]);
    if (id === undefined) return [binding];
    const at = listOf(after, key!).findIndex((item) => idOf(item) === id);
    return at < 0 ? [] : [{ ...binding, path: `/${key}/${at}${rest}` }];
  });
}
