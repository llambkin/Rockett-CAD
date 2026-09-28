import path from "node:path";
import {
  SETTINGS,
  SETTING_KEY,
  SETTINGS_IMPORT_MAX_BYTES,
  SettingsError,
  validateSettingValue,
  ValidationError,
  type SettingError,
  type SettingScope,
  type LayerValues,
  type SettingsPatch,
} from "@rockett/shared";
import { etag, JsonStore, StoreError } from "./jsonStore.js";
import { ID_RE } from "./manifestStore.js";
import { ProjectQueue } from "./projectQueue.js";
import type { Storage } from "./storage.js";

const SETTINGS_VERSION = 1;
const APP_KEY = "settings";
const IMPORT_MAX_NODES = 10_000;
const IMPORT_MAX_DEPTH = 64;

function checkImportBounds(entries: LayerValues): void {
  const stack: { value: unknown; depth: number }[] = [
    { value: entries, depth: 0 },
  ];
  let nodes = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++nodes > IMPORT_MAX_NODES || depth > IMPORT_MAX_DEPTH)
      throw new ValidationError("settings import is too deep or complex");
    if (value && typeof value === "object") {
      const children = Object.values(value);
      if (nodes + stack.length + children.length > IMPORT_MAX_NODES)
        throw new ValidationError("settings import is too deep or complex");
      for (const child of children)
        stack.push({ value: child, depth: depth + 1 });
    }
  }
  if (Buffer.byteLength(JSON.stringify(entries)) > SETTINGS_IMPORT_MAX_BYTES)
    throw new ValidationError("settings import is too large");
}

export type SettingsLayer =
  { scope: "app" } | { scope: "user" | "project"; id: string };

export class SettingsConflict extends Error {}

interface SettingsFile {
  version: number;
  values: LayerValues;
}

function validate(file: SettingsFile): void {
  const { values } = file;
  if (typeof values !== "object" || values === null || Array.isArray(values))
    throw new ValidationError("values must be an object", "/values");
}

export class SettingsStore {
  private layers: Record<
    SettingScope,
    { store: JsonStore<SettingsFile>; file: string }
  >;
  private queue = new ProjectQueue();

  constructor(storage: Storage) {
    const layer = (
      root: string,
      key: RegExp,
      file: string,
      unbacked?: () => Promise<boolean>,
    ) => ({
      file,
      store: new JsonStore<SettingsFile>({
        storage,
        root,
        name: "settings",
        key,
        file: () => file,
        migrations: {
          namespace: "settings",
          current: SETTINGS_VERSION,
          field: "version",
          steps: {},
        },
        validate,
        ...(unbacked && { unbacked }),
      }),
    });
    this.layers = {
      app: layer("", /^settings$/, "app.json"),
      user: layer("users", ID_RE, "settings.json"),
      project: layer("projects", ID_RE, "settings.json", async () => true),
    };
  }

  private locate(layer: SettingsLayer) {
    const { store, file } = this.layers[layer.scope];
    const key = layer.scope === "app" ? APP_KEY : layer.id;
    return { store, key, path: path.posix.join(store.dir(key), file) };
  }

  async read(layer: SettingsLayer): Promise<LayerValues> {
    const { store, key } = this.locate(layer);
    try {
      return (await store.read(key)).values;
    } catch (err) {
      if (err instanceof StoreError && err.code === "not_found") return {};
      throw err;
    }
  }

  async readVersioned(layer: SettingsLayer) {
    const values = await this.read(layer);
    return { values, version: this.version(values) };
  }

  version(values: LayerValues): string {
    return etag(values);
  }

  patch(
    layer: SettingsLayer,
    { set = {}, reset = [] }: SettingsPatch,
    expected?: string,
  ) {
    const errors = Object.entries(set).flatMap(
      ([key, value]): SettingError[] => {
        const error = validateSettingValue(key, layer.scope, value);
        return error ? [error] : [];
      },
    );
    if (errors.length) return Promise.reject(new SettingsError(errors));
    return this.write(layer, set, reset, expected);
  }

  async importUser(id: string, entries: LayerValues) {
    checkImportBounds(entries);
    const set: LayerValues = {};
    const applied: string[] = [];
    const rejected: { key: string; reason: string }[] = [];
    for (const [key, value] of Object.entries(entries)) {
      const reason = !SETTING_KEY.test(key)
        ? `${JSON.stringify(key)} is not a setting key.`
        : SETTINGS.has(key)
          ? validateSettingValue(key, "user", value)?.message
          : undefined;
      if (reason) rejected.push({ key, reason });
      else {
        set[key] = value;
        applied.push(key);
      }
    }
    const layer: SettingsLayer = { scope: "user", id };
    const values = applied.length
      ? await this.write(layer, set, [])
      : await this.read(layer);
    return { values, applied, rejected };
  }

  private write(
    layer: SettingsLayer,
    set: LayerValues,
    reset: string[],
    expected?: string,
  ) {
    const { store, key, path: file } = this.locate(layer);
    return this.queue.run(file, async () => {
      const current = await this.read(layer);
      if (expected !== undefined && expected !== this.version(current))
        throw new SettingsConflict("Settings changed in another session.");
      const values = { ...current, ...set };
      for (const name of reset) delete values[name];
      await store.write(key, { version: SETTINGS_VERSION, values });
      return values;
    });
  }

  async staged(id: string, set: LayerValues): Promise<[string, string]> {
    const { store, key } = this.locate({ scope: "project", id });
    const values = { ...(await this.read({ scope: "project", id })), ...set };
    return store.encode(key, { version: SETTINGS_VERSION, values });
  }

  duplicateProject(from: string, to: string): Promise<void> {
    const source = this.locate({ scope: "project", id: from });
    const target = this.locate({ scope: "project", id: to });
    return this.queue.run(source.path, async () => {
      const values = await this.read({ scope: "project", id: from });
      if (!Object.keys(values).length) return;
      await this.queue.run(target.path, () =>
        target.store.write(to, { version: SETTINGS_VERSION, values }),
      );
    });
  }
}
