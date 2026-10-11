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
  readonly labels?: Readonly<Record<string, string>>;
}

export interface SettingTypes {
  "units.length": Units;
  "viewport.pickTolerancePx": number;
  "view.projection": "orthographic" | "perspective";
  "view.orbit": "trackball" | "turntable";
  "view.zoomStep": number;
  "view.invertZoom": boolean;
  "sketch.angleStep": number;
  "sketch.angles": number[];
  "appearance.theme": "grey" | "black";
  "appearance.accent": string;
  "appearance.previewTintStrength": number;
  "appearance.previewGhostOpacity": number;
  "auth.sessionDays": number;
  "auth.sessionMaxDays": number;
  "ui.treeWidth": number;
  "keys.overrides": Record<string, string[]>;
  "toolbar.layout": ToolbarLayout;
  "layout.panels": PanelLayouts;
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
  if (section.startsWith("plugin:")) {
    const prefix = `plugin.${section.slice("plugin:".length)}.`;
    return key.startsWith(prefix) && key.length > prefix.length
      ? undefined
      : `${key} is in section ${section}, so it must be named ${prefix}<name>.`;
  }
  return key.startsWith("plugin.")
    ? `${key} belongs in section plugin:<id>, not ${section}.`
    : undefined;
}

export function registerSettings(
  definitions: readonly SettingDefinition[],
): () => void {
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
  return () => {
    for (const definition of definitions)
      if (registry.get(definition.key) === definition)
        registry.delete(definition.key);
  };
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

export const VIEW_PROJECTION = defineSetting({
  key: "view.projection",
  label: "Default projection",
  scopes: ["app", "user"],
  section: "user",
  default: "orthographic",
  schema: Type.Enum(["orthographic", "perspective"]),
  labels: { orthographic: "Orthographic", perspective: "Perspective" },
});

export const VIEW_ORBIT = defineSetting({
  key: "view.orbit",
  label: "Orbit style",
  scopes: ["app", "user"],
  section: "user",
  default: "trackball",
  schema: Type.Enum(["trackball", "turntable"]),
  labels: { trackball: "Trackball", turntable: "Turntable" },
});

export const VIEW_ZOOM_STEP = defineSetting({
  key: "view.zoomStep",
  label: "Mouse wheel zoom step",
  scopes: ["app", "user"],
  section: "user",
  default: 1.12,
  schema: Type.Number({ minimum: 1.02, maximum: 1.5 }),
});

export const VIEW_INVERT_ZOOM = defineSetting({
  key: "view.invertZoom",
  label: "Invert zoom direction",
  scopes: ["app", "user"],
  section: "user",
  default: false,
  schema: Type.Boolean(),
});

export const SKETCH_ANGLE_STEP = defineSetting({
  key: "sketch.angleStep",
  label: "Shift snap angle step (degrees)",
  scopes: ["app", "user"],
  section: "user",
  default: 15,
  schema: Type.Number({ minimum: 1, maximum: 90 }),
});

export const SKETCH_ANGLES = defineSetting({
  key: "sketch.angles",
  label: "Shift snap angles (degrees)",
  scopes: ["app", "user"],
  section: "user",
  default: [],
  schema: Type.Array(Type.Number({ minimum: 0, exclusiveMaximum: 360 })),
});

export const APPEARANCE_THEME = defineSetting({
  key: "appearance.theme",
  label: "Theme",
  scopes: ["app", "user"],
  section: "user",
  default: "grey",
  schema: Type.Enum(["grey", "black"]),
  labels: { grey: "Grey", black: "Black" },
});

export const APPEARANCE_ACCENT = defineSetting({
  key: "appearance.accent",
  label: "Accent",
  scopes: ["app", "user"],
  section: "user",
  default: "",
  schema: Type.String({ pattern: "^(#[0-9a-fA-F]{6})?$" }),
});

export const PREVIEW_TINT_STRENGTH = defineSetting({
  key: "appearance.previewTintStrength",
  label: "Preview tint strength",
  scopes: ["app", "user"],
  section: "user",
  default: 0.4,
  schema: Type.Number({ minimum: 0, maximum: 1 }),
});

export const PREVIEW_GHOST_OPACITY = defineSetting({
  key: "appearance.previewGhostOpacity",
  label: "Preview ghost opacity",
  scopes: ["app", "user"],
  section: "user",
  default: 0.45,
  schema: Type.Number({ minimum: 0, maximum: 1 }),
});

export const SESSION_DAY_RANGE = { minimum: 1, maximum: 365 };

export const SESSION_DAYS = defineSetting({
  key: "auth.sessionDays",
  label: "Stay signed in for (days)",
  scopes: ["user"],
  section: "user",
  default: 30,
  schema: Type.Integer(SESSION_DAY_RANGE),
});

export const SESSION_MAX_DAYS = defineSetting({
  key: "auth.sessionMaxDays",
  label: "Longest stay signed in (days)",
  scopes: ["app"],
  section: "app",
  default: 365,
  schema: Type.Integer(SESSION_DAY_RANGE),
});

export const moduleEnabledSetting = (moduleId: string) =>
  defineSetting({
    key: `plugin.${moduleId}.enabled`,
    label: "Enabled",
    scopes: ["app"],
    section: `plugin:${moduleId}`,
    default: true,
    schema: Type.Boolean(),
  });

export const moduleHiddenSetting = (moduleId: string) =>
  defineSetting({
    key: `plugin.${moduleId}.hidden`,
    label: "Hidden",
    scopes: ["user"],
    section: `plugin:${moduleId}`,
    default: false,
    schema: Type.Boolean(),
  });

export const moduleHostSettings = (moduleId: string) => [
  moduleEnabledSetting(moduleId),
  moduleHiddenSetting(moduleId),
];

const sectionNames = new Map<string, string>();

export function nameSection(section: SettingSection, name: string) {
  sectionNames.set(section, name);
  return () => void sectionNames.delete(section);
}

export const sectionName = (section: string) => sectionNames.get(section);

export const PANEL_MIN_PX = 160;

export const UI_TREE_WIDTH = defineSetting({
  key: "ui.treeWidth",
  label: "Model tree width (px)",
  scopes: ["user"],
  section: "user",
  default: 220,
  schema: Type.Integer({ minimum: PANEL_MIN_PX }),
});

const KEYS_OVERRIDES = defineSetting({
  key: "keys.overrides",
  label: "Keyboard shortcuts",
  scopes: ["app", "user"],
  section: "user",
  default: {},
  schema: Type.Record(Type.String(), Type.Array(Type.String({ minLength: 1 }))),
});

const COMMAND_IDS = Type.Array(Type.String({ minLength: 1 }), {
  uniqueItems: true,
});

const TOOLBAR_LAYOUT = defineSetting({
  key: "toolbar.layout",
  label: "Toolbar layout",
  scopes: ["app", "user"],
  section: "user",
  default: {},
  schema: Type.Record(
    Type.String(),
    Type.Object(
      {
        order: Type.Optional(Type.Record(Type.String(), COMMAND_IDS)),
        hidden: Type.Optional(COMMAND_IDS),
        pinned: Type.Optional(COMMAND_IDS),
      },
      { additionalProperties: false },
    ),
  ),
});

export type ToolbarLayout = SettingOf<typeof TOOLBAR_LAYOUT>;

const PANEL_SIZE = Type.Number({ minimum: 0 });

const LAYOUT_PANELS = defineSetting({
  key: "layout.panels",
  label: "Panel layout",
  scopes: ["app", "user"],
  section: "user",
  default: {},
  schema: Type.Record(
    Type.String(),
    Type.Record(
      Type.String(),
      Type.Union([
        Type.Object(
          {
            kind: Type.Literal("floating"),
            x: Type.Number(),
            y: Type.Number(),
            width: PANEL_SIZE,
            height: PANEL_SIZE,
          },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            kind: Type.Literal("docked"),
            edge: Type.Enum(["left", "right", "bottom"]),
            order: Type.Integer({ minimum: 0 }),
            size: PANEL_SIZE,
          },
          { additionalProperties: false },
        ),
        Type.Object(
          { kind: Type.Literal("closed") },
          { additionalProperties: false },
        ),
      ]),
    ),
  ),
});

export type PanelLayouts = SettingOf<typeof LAYOUT_PANELS>;

registerSettings([
  UNITS_LENGTH,
  VIEWPORT_PICK_TOLERANCE,
  VIEW_PROJECTION,
  VIEW_ORBIT,
  VIEW_ZOOM_STEP,
  VIEW_INVERT_ZOOM,
  SKETCH_ANGLE_STEP,
  SKETCH_ANGLES,
  APPEARANCE_THEME,
  APPEARANCE_ACCENT,
  PREVIEW_TINT_STRENGTH,
  PREVIEW_GHOST_OPACITY,
  SESSION_DAYS,
  SESSION_MAX_DAYS,
  UI_TREE_WIDTH,
  KEYS_OVERRIDES,
  TOOLBAR_LAYOUT,
  LAYOUT_PANELS,
]);
