import type {
  CadDocument,
  MeasureRequest,
  MeasureResult,
} from "@rockett/shared";

export type {
  CadDocument,
  Feature,
  FeatureRef,
  FeatureSpec,
  MeasureRequest,
  MeasureResult,
  ModuleManifest,
  Registry,
} from "@rockett/shared";

export const PLUGIN_API_VERSION = "0.1.0";

export type Service = (...args: never[]) => unknown;

export interface Services {
  provide(id: string, fn: Service): () => void;
  get<F extends Service = Service>(id: string): F | undefined;
}

export interface MeasureService {
  measure(doc: CadDocument, request: MeasureRequest): Promise<MeasureResult>;
}

export interface CamService {
  readProgram(fingerprint: string): Promise<string | undefined>;
  writeProgram(fingerprint: string, program: string): Promise<void>;
}

export interface KicadRun {
  stdout: string;
  files: Record<string, Uint8Array>;
}

export interface KicadService {
  cli(
    args: readonly string[],
    files: Readonly<Record<string, Uint8Array>>,
  ): Promise<KicadRun>;
}

export interface ClientContext {
  readonly services: Services;
}

export interface ServerContext extends ClientContext {
  readonly measure: MeasureService;
  readonly cam: CamService;
  readonly kicad: KicadService;
}

export interface ServerModule {
  activate(context: ServerContext): void | Promise<void>;
}

export interface ClientModule {
  activate(context: ClientContext): void | Promise<void>;
}

export const defineServerModule = (module: ServerModule) => module;
export const defineClientModule = (module: ClientModule) => module;
