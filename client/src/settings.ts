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
  type SettingsPatch,
} from "@rockett/shared";
import { ApiError } from "./api";
import { settingsApi } from "./settingsApi";
import { useSession } from "./session";
import { useStore } from "./store";

type Edit = {
  patch: SettingsPatch;
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
const layers: Record<SettingScope, Layer> = {
  app: fresh(),
  user: fresh(),
  project: fresh(),
};
let projectId: string | null = null;
const noErrors = () => ({ app: null, user: null, project: null });

function fetchLayer(scope: SettingScope, id: string | null) {
  if (scope === "app") return settingsApi.getAppSettings();
  if (scope === "user") return settingsApi.getUserSettings();
  return settingsApi.getProjectSettings(id!);
}

function patchLayer(
  scope: SettingScope,
  id: string | null,
  patch: SettingsPatch,
  version: string,
) {
  if (scope === "app") return settingsApi.patchAppSettings(patch, version);
  if (scope === "user") return settingsApi.patchUserSettings(patch, version);
  return settingsApi.patchProjectSettings(id!, patch, version);
}

function values(layer: Layer): LayerValues {
  const result = { ...layer.base };
  for (const { patch } of layer.pending) {
    for (const key of patch.reset ?? []) delete result[key];
    Object.assign(result, patch.set);
  }
  return result;
}

const initial = () => resolveSettings({}).values;
export const useSettings = create<{
  resolved: ResolvedSettings["values"];
  layers: Record<SettingScope, LayerValues>;
  loaded: Record<SettingScope, boolean>;
  projectOpen: boolean;
  errors: ResolvedSettings["errors"];
  loadError: Record<SettingScope, string | null>;
}>(() => ({
  resolved: initial(),
  layers: { app: {}, user: {}, project: {} },
  loaded: { app: false, user: false, project: false },
  projectOpen: false,
  errors: [],
  loadError: noErrors(),
}));

let loadError: Record<SettingScope, string | null> = noErrors();

export function publish(): void {
  const shown = {
    app: values(layers.app),
    user: values(layers.user),
    project: values(layers.project),
  };
  const next = resolveSettings({
    app: shown.app,
    user: shown.user,
    ...(projectId && { project: shown.project }),
  });
  useSettings.setState({
    resolved: next.values,
    layers: shown,
    loaded: {
      app: Boolean(layers.app.version),
      user: Boolean(layers.user.version),
      project: Boolean(layers.project.version),
    },
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

async function loadLayer(scope: "app" | "user"): Promise<void> {
  const current = layers[scope];
  try {
    const snapshot = await fetchLayer(scope, null);
    if (current !== layers[scope]) return;
    current.base = snapshot.values;
    current.version = snapshot.version;
    loadError = { ...loadError, [scope]: null };
    publish();
  } catch (error) {
    if (current === layers[scope]) {
      loadError = {
        ...loadError,
        [scope]: String(error instanceof Error ? error.message : error),
      };
      publish();
    }
    throw error;
  }
}

export const loadAppSettings = () => loadLayer("app");
export const loadUserSettings = () => loadLayer("user");

export async function openProjectSettings(id: string): Promise<void> {
  closeProjectSettings();
  projectId = id;
  const current = layers.project;
  publish();
  try {
    const snapshot = await fetchLayer("project", id);
    if (current !== layers.project || projectId !== id) return;
    current.base = snapshot.values;
    current.version = snapshot.version;
    loadError = { ...loadError, project: null };
    publish();
  } catch (error) {
    if (current === layers.project && projectId === id) {
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
  discard(layers.project);
  projectId = null;
  layers.project = fresh();
  loadError = { ...loadError, project: null };
  publish();
}

export function clearSettings(): void {
  discard(layers.app);
  discard(layers.user);
  layers.app = fresh();
  layers.user = fresh();
  loadError = noErrors();
  closeProjectSettings();
  publish();
}

export function retrySettingsLoad(scope: SettingScope): Promise<void> {
  if (scope !== "project") return loadLayer(scope);
  return projectId
    ? openProjectSettings(projectId)
    : Promise.reject(new Error("Open a project to load its settings."));
}

function report(error: Error): void {
  useStore.getState().setError(error.message);
}

async function drain(
  scope: SettingScope,
  layer: Layer,
  id: string | null,
): Promise<void> {
  if (layer.busy || !layer.version) return;
  layer.busy = true;
  try {
    while (layer.pending.length) {
      if (layers[scope] !== layer) break;
      const edit = layer.pending[0]!;
      try {
        const response = await patchLayer(scope, id, edit.patch, layer.version);
        if (layers[scope] !== layer) return;
        layer.base = response.values;
        layer.version = response.version;
        layer.pending.shift();
        edit.resolve();
        publish();
      } catch (cause) {
        if (layers[scope] !== layer) return;
        const error = cause instanceof Error ? cause : new Error(String(cause));
        if (error instanceof ApiError && error.status === 409) {
          try {
            const current = await fetchLayer(scope, id);
            if (layers[scope] !== layer) return;
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

function writable(scope: SettingScope): boolean {
  const role = useSession.getState();
  if (scope === "project") return Boolean(projectId);
  if (role.kind !== "signed-in") return false;
  return scope === "user" || role.user.role === "admin";
}

function queueEdit(scope: SettingScope, patch: SettingsPatch): Promise<void> {
  if (!writable(scope))
    return Promise.reject(
      new Error(`The ${scope} settings layer is not writable here.`),
    );
  const layer = layers[scope];
  if (!layer.version)
    return Promise.reject(
      new Error(`The ${scope} settings layer is not loaded.`),
    );
  return new Promise<void>((resolve, reject) => {
    layer.pending.push({ patch, resolve, reject });
    publish();
    void drain(scope, layer, projectId);
  });
}

export function setSetting<K extends string>(
  key: K,
  value: SettingValue<K>,
  scope?: SettingScope,
): Promise<void> {
  const definition = SETTINGS.get(key);
  if (!definition) return Promise.reject(new Error(`${key} is not a setting.`));
  const target =
    scope ??
    (["project", "user", "app"] as const).find(
      (candidate) =>
        definition.scopes.includes(candidate) && writable(candidate),
    ) ??
    "user";
  const invalid = validateSettingValue(key, target, value);
  if (invalid) return Promise.reject(new SettingsError([invalid]));
  return queueEdit(target, { set: { [key]: value } });
}

export function resetSettings(
  keys: string[],
  scope: SettingScope,
): Promise<void> {
  const refused = keys.find(
    (key) => !SETTINGS.get(key)?.scopes.includes(scope),
  );
  if (refused)
    return Promise.reject(
      new Error(`${refused} cannot be reset at the ${scope} layer.`),
    );
  return queueEdit(scope, { reset: keys });
}

export function retryPendingSettings(): void {
  void drain("app", layers.app, null);
  void drain("user", layers.user, null);
  if (projectId) void drain("project", layers.project, projectId);
}
