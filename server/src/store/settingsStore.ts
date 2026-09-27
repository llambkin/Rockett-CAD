import path from "node:path";
import {
  SettingsError,
  validateSettingValue,
  ValidationError,
  type SettingError,
  type SettingScope,
  type LayerValues,
  type SettingsPatch,
} from "@rockett/shared";
import { JsonStore, StoreError } from "./jsonStore.js";
import { ID_RE } from "./manifestStore.js";
import { ProjectQueue } from "./projectQueue.js";
import type { Storage } from "./storage.js";

const SETTINGS_VERSION = 1;
const APP_KEY = "settings";

export type SettingsLayer =
  { scope: "app" } | { scope: "user" | "project"; id: string };

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

  patch(layer: SettingsLayer, { set = {}, reset = [] }: SettingsPatch) {
    const errors = Object.entries(set).flatMap(
      ([key, value]): SettingError[] => {
        const error = validateSettingValue(key, layer.scope, value);
        return error ? [error] : [];
      },
    );
    if (errors.length) return Promise.reject(new SettingsError(errors));
    const { store, key, path: file } = this.locate(layer);
    return this.queue.run(file, async () => {
      const values = { ...(await this.read(layer)), ...set };
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
