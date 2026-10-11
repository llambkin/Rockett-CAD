import type { ClientContext } from "./client.js";
import type { ServerContext } from "./server.js";

export type {
  CadDocument,
  Feature,
  FeatureRef,
  FeatureSpec,
  ExtensionSpec,
  FeatureInputContext,
  FeatureInputResolver,
  JsonInput,
  ResolvedFeatureInputs,
  FeatureStatus,
  MeasureRequest,
  MeasureResult,
  ModuleManifest,
  PathParams,
  Registry,
  Route,
  SettingDefinition,
  SettingScope,
  SettingSection,
  User,
} from "@rockett/shared";

export {
  moduleBodyId,
  Placement,
  placementSchema,
  StoreError,
} from "@rockett/shared";

export const PLUGIN_API_VERSION = "0.23.0";

export * from "./server.js";
export * from "./client.js";

export type DataMigrations = Readonly<
  Record<number, (data: unknown) => unknown>
>;

export interface ServerModule {
  activate(context: ServerContext): void | Promise<void>;
  migrations?: DataMigrations;
}

export interface ClientModule {
  activate(context: ClientContext): void | Promise<void>;
}

export const defineServerModule = (module: ServerModule) => module;
export const defineClientModule = (module: ClientModule) => module;
