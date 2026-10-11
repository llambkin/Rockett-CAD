import {
  pathFor,
  ROUTES,
  type LayerValues,
  type PathParams,
  type Route,
  type SettingsPatch,
} from "@rockett/shared";
import { ApiError, request } from "./api";

async function settingsRequest<P extends string>(
  route: Route<P, never | SettingsPatch, LayerValues>,
  params: PathParams<P>,
  body?: SettingsPatch,
  version?: string,
): Promise<{ values: LayerValues; version: string }> {
  let current: string | null = null;
  const values = await request<LayerValues>(
    route.method,
    pathFor(route, params),
    {
      ...(body && { body }),
      ...(version && { headers: { "If-Match": version } }),
      onEtag: (etag) => {
        current = etag;
      },
    },
  );
  if (!current)
    throw new ApiError("Settings response had no ETag.", 0, "internal");
  return { values, version: current };
}

export const settingsApi = {
  getAppSettings: () => settingsRequest(ROUTES.appSettings, {}),
  patchAppSettings: (patch: SettingsPatch, version: string) =>
    settingsRequest(ROUTES.patchAppSettings, {}, patch, version),
  getUserSettings: () => settingsRequest(ROUTES.userSettings, {}),
  patchUserSettings: (patch: SettingsPatch, version: string) =>
    settingsRequest(ROUTES.patchUserSettings, {}, patch, version),
  getProjectSettings: (id: string) =>
    settingsRequest(ROUTES.projectSettings, { id }),
  patchProjectSettings: (id: string, patch: SettingsPatch, version: string) =>
    settingsRequest(ROUTES.patchProjectSettings, { id }, patch, version),
};
