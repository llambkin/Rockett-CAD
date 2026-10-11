import { Type } from "typebox";
import type { ModuleSettings, SettingDefinition } from "@rockett/plugin-api";
import { GOUGE_TOLERANCE, MIN_TOLERANCE } from "./params.js";

const setting = (
  name: string,
  label: string,
  rest: Pick<SettingDefinition, "default" | "schema">,
): SettingDefinition => ({
  key: `plugin.rockett.cam.${name}`,
  label,
  scopes: ["user"],
  section: "plugin:rockett.cam",
  ...rest,
});

export const DEFAULT_MACHINE = setting("defaultMachine", "Default machine", {
  default: null,
  schema: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
});

export const SAFE_HEIGHT = setting("safeHeight", "Default safe height (mm)", {
  default: 15,
  schema: Type.Number(),
});

export const CLEARANCE = setting("clearance", "Default clearance (mm)", {
  default: 3,
  schema: Type.Number(),
});

export const TOLERANCE = setting("tolerance", "Default tolerance (mm)", {
  default: GOUGE_TOLERANCE,
  schema: Type.Number({ minimum: MIN_TOLERANCE }),
});

export const CAM_SETTINGS = [
  DEFAULT_MACHINE,
  SAFE_HEIGHT,
  CLEARANCE,
  TOLERANCE,
];

export const setupDefaults = (settings: ModuleSettings) => ({
  safeHeight: settings.get<number>(SAFE_HEIGHT.key),
  clearance: settings.get<number>(CLEARANCE.key),
  tolerance: settings.get<number>(TOLERANCE.key),
});

export const defaultMachine = <T extends { id: string }>(
  settings: ModuleSettings,
  machines: readonly T[],
) =>
  machines.find(({ id }) => id === settings.get(DEFAULT_MACHINE.key)) ??
  machines[0];
