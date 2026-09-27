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
  for (const edit of layer.pending) result[edit.key] = edit.value;
  return result;
}

const initial = () => resolveSettings({}).values;
export const useSettings = create<{ resolved: ResolvedSettings["values"] }>(
  () => ({ resolved: initial() }),
);

function publish(): void {
  const next = resolveSettings({
    app: values(app),
    ...(projectId && { project: values(project) }),
  }).values;
  const previous = useSettings.getState().resolved;
  if (
    Object.keys(next).every(
      (key) =>
        Object.is(next[key]?.value, previous[key]?.value) &&
        next[key]?.source === previous[key]?.source,
    )
  )
    return;
  useSettings.setState({ resolved: next });
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
  const snapshot = await settingsApi.getAppSettings();
  if (current !== app) return;
  app.base = snapshot.values;
  app.version = snapshot.version;
  publish();
}

export async function openProjectSettings(id: string): Promise<void> {
  closeProjectSettings();
  projectId = id;
  const current = project;
  publish();
  const snapshot = await settingsApi.getProjectSettings(id);
  if (current !== project || projectId !== id) return;
  project.base = snapshot.values;
  project.version = snapshot.version;
  publish();
}

export function closeProjectSettings(): void {
  discard(project);
  projectId = null;
  project = fresh();
  publish();
}

export function clearSettings(): void {
  discard(app);
  app = fresh();
  closeProjectSettings();
  publish();
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
        const response =
          scope === "app"
            ? await settingsApi.patchAppSettings(
                { set: { [edit.key]: edit.value } },
                layer.version,
              )
            : await settingsApi.patchProjectSettings(
                id!,
                { set: { [edit.key]: edit.value } },
                layer.version,
              );
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
  return new Promise<void>((resolve, reject) => {
    layer.pending.push({ key, value, resolve, reject });
    publish();
    void drain(target, layer, projectId);
  });
}

export function retryPendingSettings(): void {
  void drain("app", app, null);
  if (projectId) void drain("project", project, projectId);
}
