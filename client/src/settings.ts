import { create } from "zustand";
import {
  SETTINGS,
  SettingsError,
  resolveSettings,
  validateSettingValue,
  type LayerValues,
  type ResolvedSettings,
  type SettingScope,
  type SettingValue,
} from "@rockett/shared";
import { ApiError } from "./api";
import { settingsApi } from "./settingsApi";
import { useSession } from "./session";
import { useStore } from "./store";

type Edit = {
  key: string;
  value: unknown;
  reset: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
};
type Layer = {
  base: LayerValues;
  version: string;
  pending: Edit[];
  busy: boolean;
};

const fresh = (): Layer => ({
  base: {},
  version: "",
  pending: [],
  busy: false,
});
function discard(layer: Layer): void {
  for (const edit of layer.pending)
    edit.reject(new Error("Settings context changed."));
  layer.pending = [];
}
let app = fresh();
let project = fresh();
let projectId: string | null = null;

function values(layer: Layer): LayerValues {
  const result = { ...layer.base };
  for (const edit of layer.pending) {
    if (edit.reset) delete result[edit.key];
    else result[edit.key] = edit.value;
  }
  return result;
}

const initial = () => resolveSettings({}).values;
export const useSettings = create<{
  resolved: ResolvedSettings["values"];
  layers: { app: LayerValues; project: LayerValues };
  loaded: { app: boolean; project: boolean };
  projectOpen: boolean;
  errors: ResolvedSettings["errors"];
  loadError: { app: string | null; project: string | null };
}>(() => ({
  resolved: initial(),
  layers: { app: {}, project: {} },
  loaded: { app: false, project: false },
  projectOpen: false,
  errors: [],
  loadError: { app: null, project: null },
}));

let loadError = { app: null as string | null, project: null as string | null };

function publish(): void {
  const layers = { app: values(app), project: values(project) };
  const next = resolveSettings({
    app: layers.app,
    ...(projectId && { project: layers.project }),
  });
  useSettings.setState({
    resolved: next.values,
    layers,
    loaded: { app: Boolean(app.version), project: Boolean(project.version) },
    projectOpen: Boolean(projectId),
    errors: next.errors,
    loadError,
  });
}

export function getSetting<K extends string>(key: K): SettingValue<K> {
  return useSettings.getState().resolved[key]?.value as SettingValue<K>;
}

export function useSetting<K extends string>(key: K): SettingValue<K> {
  return useSettings((state) => state.resolved[key]?.value) as SettingValue<K>;
}

export function subscribe<K extends string>(
  key: K,
  fn: (value: SettingValue<K>) => void,
): () => void {
  let previous = getSetting(key);
  return useSettings.subscribe(() => {
    const next = getSetting(key);
    if (Object.is(next, previous)) return;
    previous = next;
    fn(next);
  });
}

export async function loadAppSettings(): Promise<void> {
  const current = app;
  try {
    const snapshot = await settingsApi.getAppSettings();
    if (current !== app) return;
    app.base = snapshot.values;
    app.version = snapshot.version;
    loadError = { ...loadError, app: null };
    publish();
  } catch (error) {
    if (current === app) {
      loadError = {
        ...loadError,
        app: String(error instanceof Error ? error.message : error),
      };
      publish();
    }
    throw error;
  }
}

export async function openProjectSettings(id: string): Promise<void> {
  closeProjectSettings();
  projectId = id;
  const current = project;
  publish();
  try {
    const snapshot = await settingsApi.getProjectSettings(id);
    if (current !== project || projectId !== id) return;
    project.base = snapshot.values;
    project.version = snapshot.version;
    loadError = { ...loadError, project: null };
    publish();
  } catch (error) {
    if (current === project && projectId === id) {
      loadError = {
        ...loadError,
        project: String(error instanceof Error ? error.message : error),
      };
      publish();
    }
    throw error;
  }
}

export function closeProjectSettings(): void {
  discard(project);
  projectId = null;
  project = fresh();
  loadError = { ...loadError, project: null };
  publish();
}

export function clearSettings(): void {
  discard(app);
  app = fresh();
  loadError = { app: null, project: null };
  closeProjectSettings();
  publish();
}

export function retrySettingsLoad(scope: "app" | "project"): Promise<void> {
  if (scope === "app") return loadAppSettings();
  return projectId
    ? openProjectSettings(projectId)
    : Promise.reject(new Error("Open a project to load its settings."));
}

function report(error: Error): void {
  useStore.getState().setError(error.message);
}

async function drain(
  scope: "app" | "project",
  layer: Layer,
  id: string | null,
): Promise<void> {
  if (layer.busy || !layer.version) return;
  layer.busy = true;
  try {
    while (layer.pending.length) {
      if ((scope === "app" ? app : project) !== layer) break;
      const edit = layer.pending[0]!;
      try {
        const patch = edit.reset
          ? { reset: [edit.key] }
          : { set: { [edit.key]: edit.value } };
        const response =
          scope === "app"
            ? await settingsApi.patchAppSettings(patch, layer.version)
            : await settingsApi.patchProjectSettings(id!, patch, layer.version);
        if ((scope === "app" ? app : project) !== layer) return;
        layer.base = response.values;
        layer.version = response.version;
        layer.pending.shift();
        edit.resolve();
        publish();
      } catch (cause) {
        if ((scope === "app" ? app : project) !== layer) return;
        const error = cause instanceof Error ? cause : new Error(String(cause));
        if (error instanceof ApiError && error.status === 409) {
          try {
            const current =
              scope === "app"
                ? await settingsApi.getAppSettings()
                : await settingsApi.getProjectSettings(id!);
            if ((scope === "app" ? app : project) !== layer) return;
            layer.base = current.values;
            layer.version = current.version;
          } catch {
            report(error);
            edit.reject(error);
            break;
          }
          report(error);
          edit.reject(error);
          publish();
          break;
        }
        if (
          error instanceof ApiError &&
          (error.status === 400 || error.status === 403)
        ) {
          layer.pending.shift();
          report(error);
          edit.reject(error);
          publish();
          continue;
        }
        report(error);
        edit.reject(error);
        break;
      }
    }
  } finally {
    layer.busy = false;
  }
}

export function setSetting<K extends string>(
  key: K,
  value: SettingValue<K>,
  scope?: SettingScope,
): Promise<void> {
  const definition = SETTINGS.get(key);
  if (!definition) return Promise.reject(new Error(`${key} is not a setting.`));
  const role = useSession.getState();
  const target =
    scope ??
    (projectId && definition.scopes.includes("project")
      ? "project"
      : role.kind === "signed-in" &&
          role.user.role === "admin" &&
          definition.scopes.includes("app")
        ? "app"
        : "user");
  if (
    target === "user" ||
    (target === "project" && !projectId) ||
    (target === "app" &&
      (role.kind !== "signed-in" || role.user.role !== "admin"))
  )
    return Promise.reject(
      new Error(`The ${target} settings layer is not writable here.`),
    );
  const invalid = validateSettingValue(key, target, value);
  if (invalid) return Promise.reject(new SettingsError([invalid]));
  const layer = target === "app" ? app : project;
  if (!layer.version)
    return Promise.reject(
      new Error(`The ${target} settings layer is not loaded.`),
    );
  return queueEdit(target, layer, key, value, false);
}

function queueEdit(
  scope: "app" | "project",
  layer: Layer,
  key: string,
  value: unknown,
  reset: boolean,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    layer.pending.push({ key, value, reset, resolve, reject });
    publish();
    void drain(scope, layer, projectId);
  });
}

export function resetSetting(key: string, scope: SettingScope): Promise<void> {
  const definition = SETTINGS.get(key);
  if (!definition?.scopes.includes(scope))
    return Promise.reject(
      new Error(`${key} cannot be reset at the ${scope} layer.`),
    );
  const role = useSession.getState();
  if (
    scope === "user" ||
    (scope === "app" &&
      (role.kind !== "signed-in" || role.user.role !== "admin")) ||
    (scope === "project" && !projectId)
  )
    return Promise.reject(
      new Error(`The ${scope} settings layer is not writable here.`),
    );
  const layer = scope === "app" ? app : project;
  if (!layer.version)
    return Promise.reject(
      new Error(`The ${scope} settings layer is not loaded.`),
    );
  return queueEdit(scope, layer, key, undefined, true);
}

export function retryPendingSettings(): void {
  void drain("app", app, null);
  if (projectId) void drain("project", project, projectId);
}
