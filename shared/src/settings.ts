import { Type, type Static, type TSchema } from "typebox";
import { parse, ValidationError } from "./schema/index.js";
import { UNIT_TO_MM, type Units } from "./units.js";

export type SettingScope = "app" | "user" | "project";
export type SettingSection = SettingScope | `plugin:${string}`;
export type LayerValues = Record<string, unknown>;
export interface SettingsPatch {
  set?: LayerValues;
  reset?: string[];
}

export const SETTING_KEY = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/;
const PLUGIN_KEY = /^plugin\.([a-z][A-Za-z0-9]*)\.[a-z]/;

export interface SettingDefinition<
  S extends TSchema = TSchema,
  K extends string = string,
> {
  readonly key: K;
  readonly label: string;
  readonly scopes: readonly [SettingScope, ...SettingScope[]];
  readonly section: SettingSection;
  readonly default: Static<S>;
  readonly schema: S;
}

export interface SettingTypes {
  "units.length": Units;
  "viewport.pickTolerancePx": number;
}

export type SettingOf<D extends SettingDefinition> = Static<D["schema"]>;

export type SettingValue<K extends string> = K extends keyof SettingTypes
  ? SettingTypes[K]
  : unknown;

export type SettingErrorCode =
  | "unknownKey"
  | "scope"
  | "value"
  | "duplicateKey"
  | "badKey"
  | "section"
  | "badDefault";

export interface SettingError {
  code: SettingErrorCode;
  key: string;
  message: string;
  path?: string;
}

export class SettingsError extends Error {
  constructor(readonly errors: SettingError[]) {
    super(errors.map((e) => e.message).join("; "));
  }
}

const registry = new Map<string, SettingDefinition>();

export const SETTINGS: ReadonlyMap<string, SettingDefinition> = registry;

export function defineSetting<S extends TSchema, const K extends string>(
  definition: SettingDefinition<S, K>,
): SettingDefinition<S, K> {
  return definition;
}

function valueError(
  { key, schema }: SettingDefinition,
  value: unknown,
): SettingError | undefined {
  try {
    parse(schema, value, key);
    return undefined;
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    return {
      code: "value",
      key,
      message: err.message,
      ...(err.detail !== undefined && { path: err.detail }),
    };
  }
}

function sectionError({ key, section }: SettingDefinition): string | undefined {
  const plugin = PLUGIN_KEY.exec(key)?.[1];
  if (key.startsWith("plugin.") && plugin === undefined)
    return `${key} must be named plugin.<id>.<name>.`;
  if (plugin !== undefined && section !== `plugin:${plugin}`)
    return `${key} belongs in section plugin:${plugin}, not ${section}.`;
  if (plugin === undefined && section.startsWith("plugin:"))
    return `${key} is in section ${section}, so it must be named plugin.<id>.<name>.`;
  return undefined;
}

export function registerSettings(
  definitions: readonly SettingDefinition[],
): void {
  const errors: SettingError[] = [];
  const batch = new Set<string>();
  for (const definition of definitions) {
    const { key } = definition;
    const fail = (code: SettingErrorCode, message: string) =>
      errors.push({ code, key, message });
    if (registry.has(key) || batch.has(key))
      fail("duplicateKey", `${key} is already registered.`);
    batch.add(key);
    if (!SETTING_KEY.test(key)) {
      fail("badKey", `${JSON.stringify(key)} is not a setting key.`);
      continue;
    }
    const section = sectionError(definition);
    if (section) fail("section", section);
    const invalid = valueError(definition, definition.default);
    if (invalid) errors.push({ ...invalid, code: "badDefault" });
  }
  if (errors.length) throw new SettingsError(errors);
  for (const definition of definitions)
    registry.set(definition.key, definition);
}

export function validateSettingValue(
  key: string,
  scope: SettingScope,
  value: unknown,
): SettingError | undefined {
  const definition = registry.get(key);
  if (!definition)
    return { code: "unknownKey", key, message: `${key} is not a setting.` };
  if (!definition.scopes.includes(scope))
    return {
      code: "scope",
      key,
      message: `${key} cannot be set at the ${scope} layer.`,
    };
  return valueError(definition, value);
}

export type SettingLayers = Partial<
  Record<SettingScope, Readonly<Record<string, unknown>>>
>;

export interface ResolvedSetting {
  value: unknown;
  source: SettingScope | "default";
}

export interface ResolvedSettings {
  values: Record<string, ResolvedSetting>;
  errors: (SettingError & { scope: SettingScope })[];
}

const PRECEDENCE: readonly SettingScope[] = ["app", "user", "project"];

export function resolveSettings(layers: SettingLayers): ResolvedSettings {
  const resolved: ResolvedSettings = { values: {}, errors: [] };
  for (const definition of registry.values()) {
    const { key } = definition;
    let setting: ResolvedSetting = {
      value: definition.default,
      source: "default",
    };
    for (const scope of PRECEDENCE) {
      const layer = layers[scope];
      if (!layer || !definition.scopes.includes(scope)) continue;
      if (!Object.hasOwn(layer, key)) continue;
      const invalid = valueError(definition, layer[key]);
      if (invalid) resolved.errors.push({ ...invalid, scope });
      else setting = { value: layer[key], source: scope };
    }
    resolved.values[key] = setting;
  }
  return resolved;
}

export const UNITS_LENGTH = defineSetting({
  key: "units.length",
  label: "Length units",
  scopes: ["app", "user", "project"],
  section: "user",
  default: "mm",
  schema: Type.Enum(Object.keys(UNIT_TO_MM) as Units[]),
});

export const VIEWPORT_PICK_TOLERANCE = defineSetting({
  key: "viewport.pickTolerancePx",
  label: "Pick tolerance (px)",
  scopes: ["app", "user"],
  section: "user",
  default: 7,
  schema: Type.Integer({ minimum: 2, maximum: 20 }),
});

registerSettings([UNITS_LENGTH, VIEWPORT_PICK_TOLERANCE]);
