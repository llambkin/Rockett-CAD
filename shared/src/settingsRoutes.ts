import { Type } from "typebox";
import type { route as defineRoute } from "./routes.js";
import type { LayerValues, SettingsPatch } from "./settings.js";

export const settingsPatchBody = Type.Object(
  {
    set: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    reset: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

export function settingsRoutes(route: typeof defineRoute) {
  return {
    userSettings: route<never, LayerValues>()("GET", "/me/settings"),
    patchUserSettings: route<SettingsPatch, LayerValues>()(
      "PATCH",
      "/me/settings",
      settingsPatchBody,
    ),
    importUserSettings: route<
      LayerValues,
      { applied: string[]; rejected: { key: string; reason: string }[] }
    >()(
      "POST",
      "/me/settings/import",
      Type.Record(Type.String(), Type.Unknown()),
    ),
    appSettings: route<never, LayerValues>()("GET", "/settings"),
    patchAppSettings: route<SettingsPatch, LayerValues>()(
      "PATCH",
      "/settings",
      settingsPatchBody,
    ),
    projectSettings: route<never, LayerValues>()(
      "GET",
      "/projects/:id/settings",
    ),
    patchProjectSettings: route<SettingsPatch, LayerValues>()(
      "PATCH",
      "/projects/:id/settings",
      settingsPatchBody,
    ),
  };
}
