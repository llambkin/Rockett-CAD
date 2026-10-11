import type { CadDocument, Feature } from "./model.js";
import { featureModule, featureSpec, newerFeature } from "./featureSpec.js";
import { MODULE_DATA_MAX_BYTES } from "./units.js";
import { ValidationError } from "./schema/validation.js";
import { resolveDocumentParameters } from "./parameters.js";

export type JsonInput =
  | null
  | boolean
  | number
  | string
  | readonly JsonInput[]
  | { readonly [key: string]: JsonInput };

type ImmutableInput<T> = T extends object
  ? { readonly [K in keyof T]: ImmutableInput<T[K]> }
  : T;

export interface FeatureInputContext<P = Record<string, unknown>> {
  readonly params: ImmutableInput<P>;
  readonly extensions: ImmutableInput<CadDocument["extensions"]>;
}

export interface ResolvedFeatureInputs {
  readonly identity: JsonInput;
  readonly assets: readonly string[];
}

export type FeatureInputResolver<P = Record<string, unknown>> = (
  input: FeatureInputContext<P>,
) => ResolvedFeatureInputs;

export const FEATURE_INPUT_MAX_DEPTH = 64;

function immutableJson(value: unknown): JsonInput {
  let bytes = 0;
  const ancestors = new Set<object>();
  const visit = (node: unknown, depth: number): JsonInput => {
    if (depth > FEATURE_INPUT_MAX_DEPTH)
      throw new ValidationError("module feature input nesting is too deep");
    if (
      node === null ||
      typeof node === "boolean" ||
      typeof node === "string" ||
      (typeof node === "number" && Number.isFinite(node))
    ) {
      bytes += new TextEncoder().encode(JSON.stringify(node)).byteLength + 1;
      if (bytes > MODULE_DATA_MAX_BYTES)
        throw new ValidationError("module feature inputs are too large");
      return node;
    }
    if (typeof node !== "object" || !node || ancestors.has(node))
      throw new ValidationError("module feature inputs must be JSON");
    if (
      !Array.isArray(node) &&
      ![Object.prototype, null].includes(Object.getPrototypeOf(node))
    )
      throw new ValidationError("module feature inputs must be plain JSON");
    ancestors.add(node);
    bytes += 2;
    let result: JsonInput;
    if (Array.isArray(node)) {
      if (
        node.length > MODULE_DATA_MAX_BYTES ||
        Object.keys(node).length !== node.length ||
        Reflect.ownKeys(node).length !== node.length + 1
      )
        throw new ValidationError("module feature inputs must be JSON arrays");
      result = Array.from({ length: node.length }, (_, i) => {
        const descriptor = Object.getOwnPropertyDescriptor(node, String(i));
        if (!descriptor || !("value" in descriptor))
          throw new ValidationError(
            "module feature inputs must be JSON arrays",
          );
        return visit(descriptor.value, depth + 1);
      });
    } else {
      const keys = Reflect.ownKeys(node);
      if (keys.some((key) => typeof key !== "string"))
        throw new ValidationError("module feature inputs must be plain JSON");
      result = Object.fromEntries(
        keys.toSorted().map((key) => {
          const descriptor = Object.getOwnPropertyDescriptor(node, key)!;
          if (
            typeof key !== "string" ||
            !descriptor.enumerable ||
            !("value" in descriptor)
          )
            throw new ValidationError(
              "module feature inputs must be plain JSON",
            );
          bytes += new TextEncoder().encode(JSON.stringify(key)).byteLength + 1;
          return [key, visit(descriptor.value, depth + 1)];
        }),
      );
    }
    ancestors.delete(node);
    if (bytes > MODULE_DATA_MAX_BYTES)
      throw new ValidationError("module feature inputs are too large");
    return Object.freeze(result);
  };
  return visit(value, 0);
}

export function resolvedFeatureInputs(
  feature: Feature,
  doc: Pick<CadDocument, "extensions">,
): ResolvedFeatureInputs | undefined {
  const resolve = featureSpec(feature.type)?.resolveInputs;
  if (!resolve || newerFeature(feature)) return;
  if (!("params" in feature))
    throw new ValidationError("only module features resolve extension inputs");
  const moduleId = featureModule(feature.type);
  if (!moduleId)
    throw new ValidationError("only module features resolve extension inputs");
  const own = doc.extensions[moduleId];
  const input = immutableJson({
    params: feature.params,
    extensions: own ? { [moduleId]: own } : {},
  }) as unknown as FeatureInputContext;
  const result = immutableJson(
    resolve(input),
  ) as unknown as ResolvedFeatureInputs;
  if (
    !result ||
    typeof result !== "object" ||
    !("identity" in result) ||
    !Array.isArray(result.assets) ||
    Object.keys(result).some((key) => key !== "identity" && key !== "assets") ||
    result.assets.some(
      (hash) => typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash),
    )
  )
    throw new ValidationError(
      "module feature inputs need JSON identity and content-hash assets",
    );
  return Object.freeze({
    identity: result.identity,
    assets: Object.freeze([...new Set(result.assets)].toSorted()),
  });
}

export function resolvedModuleInputFeatures(
  doc: Pick<CadDocument, "features" | "parameters" | "parameterBindings">,
): Feature[] {
  if (!doc.features.some((feature) => featureSpec(feature.type)?.resolveInputs))
    return doc.features;
  const resolved = resolveDocumentParameters(doc).features;
  return doc.features.map((feature, index) =>
    featureSpec(feature.type)?.resolveInputs ? resolved[index]! : feature,
  );
}
