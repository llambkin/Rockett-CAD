import type {
  BodyPayload,
  CadDocument,
  ExtensionSpec,
  FaceRef as CoreFaceRef,
  FeatureStatus,
  registerExtensionSpec,
  Health,
  PathParams,
  ResolvedFeatureInputs,
  Route,
  SettingDefinition,
  User,
} from "@rockett/shared";

export type FaceRef = Pick<CoreFaceRef, "kind" | "bodyId" | "faceName">;

export type SignedFaceRef = FaceRef & Required<Pick<CoreFaceRef, "sig">>;

export type DxfSource = (
  { sketchId: string; face?: never } | { face: FaceRef; sketchId?: never }
) & { layer?: string };

export type Dispose = () => void;

export type RouteBody<R extends Route> = R extends { readonly body: object }
  ? R extends Route<string, infer Req>
    ? Req
    : unknown
  : unknown;

export type RouteResponse<R extends Route> =
  R extends Route<string, unknown, infer Res> ? Res : unknown;

export interface RouteRequest<R extends Route> {
  params: PathParams<R["path"]>;
  body: RouteBody<R>;
}

export type ProjectMutation = (
  { label: string; cursor?: never } | { cursor: number; label?: never }
) & {
  document?: CadDocument;
  position?: number | undefined;
  [extra: string]: unknown;
};

export interface RouteContext {
  user: User;
}

export interface ProjectBlobs {
  get(hash: string): Promise<Uint8Array>;
  put(bytes: Uint8Array): Promise<string>;
}

export interface ProjectServiceContext extends RouteContext {
  readonly blobs: Pick<ProjectBlobs, "get">;
}

export type ProjectServiceHandler = (
  doc: CadDocument,
  input: unknown,
  ctx: ProjectServiceContext,
) => Promise<unknown>;

export type ProjectService = (input: unknown) => Promise<unknown>;

export interface ServiceProvider {
  provide(id: string, handler: ProjectServiceHandler): Dispose;
}

export interface ProjectServices {
  get(id: string): ProjectService | undefined;
}

export interface ProjectRouteContext extends ProjectServiceContext {
  readonly services: ProjectServices;
  unzstd(bytes: Uint8Array, maxBytes: number): Uint8Array;
}

export interface ProjectMutationContext extends ProjectRouteContext {
  readonly blobs: ProjectBlobs;
  readonly assets: { set(hashes: readonly string[]): void };
}

export interface RouteModuleApi {
  projectRoute<R extends Route>(
    route: R,
    read: (
      doc: CadDocument,
      req: RouteRequest<R>,
      ctx: ProjectRouteContext,
    ) => Promise<unknown>,
  ): void;
  projectMutation<R extends Route>(
    route: R,
    edit: (
      doc: CadDocument,
      req: RouteRequest<R>,
      ctx: ProjectMutationContext,
    ) => Promise<ProjectMutation>,
  ): void;
  userRoute<R extends Route>(
    route: R,
    handle: (req: RouteRequest<R>, ctx: RouteContext) => Promise<unknown>,
  ): void;
}

export interface RouteModule<Api extends RouteModuleApi = RouteModuleApi> {
  id: string;
  mount(api: Api): void;
}

export interface KernelJobScope {
  readonly oc: any;
  own<H extends { delete(): void }>(handle: H): H;
  progress(done: number, total: number, label: string): void;
}

export type KernelJobResult =
  | void
  | null
  | boolean
  | number
  | bigint
  | string
  | (object & { then?: never });

export type KernelJob = (
  input: never,
  scope: KernelJobScope,
) => KernelJobResult;

export const defineKernelJobs = (jobs: Readonly<Record<string, KernelJob>>) =>
  jobs;

export interface KernelJobRun {
  onProgress?(done: number, total: number, label: string): void;
  signal?: AbortSignal;
}

export type StartKernelJob = (
  id: string,
  input: unknown,
  run?: KernelJobRun,
) => Promise<unknown>;

type ParamsSchema = Parameters<typeof registerExtensionSpec>[0]["params"];

export interface TimelineFeatureScope<
  S extends ParamsSchema,
> extends KernelJobScope {
  readonly params: Parameters<
    NonNullable<ExtensionSpec<S>["resolveInputs"]>
  >[0]["params"];
  readonly inputs?: {
    readonly identity: ResolvedFeatureInputs["identity"];
    readonly assets: readonly Uint8Array[];
  };
  readStep(bytes: Uint8Array): any[];
}

export interface TimelineFeature<S extends ParamsSchema = ParamsSchema> {
  readonly spec: ExtensionSpec<S>;
  evaluate(scope: TimelineFeatureScope<S>): unknown;
}

export const defineTimelineFeature = <S extends ParamsSchema>(
  feature: TimelineFeature<S>,
) => feature;

export interface ServerRegister {
  extensionSpec: typeof registerExtensionSpec;
  timelineFeature<S extends ParamsSchema>(
    feature: TimelineFeature<S>,
    entry: URL,
  ): Promise<Dispose>;
  routeModule(module: RouteModule): Dispose;
  kernelJob(id: string, entry: URL): Dispose;
  setting(definition: SettingDefinition): Dispose;
}

export interface UserDataEntry {
  version: number;
  data: unknown;
  etag: string;
  readOnly: boolean;
}

export interface UserData {
  read(user: User): Promise<UserDataEntry | null>;
  write(user: User, data: unknown, etag: string | null): Promise<UserDataEntry>;
}

export interface ModuleFiles {
  read(name: string): Promise<Uint8Array | null>;
  write(name: string, data: string | Uint8Array): Promise<void>;
  remove(name: string): Promise<void>;
  list(): Promise<string[]>;
}

export interface ServerBody extends ProjectBody {
  readonly brep: string;
  readonly faceNames: readonly string[];
  readonly fingerprint: string;
  readonly problems?: readonly FeatureStatus[];
}

export interface ServerContext {
  readonly register: ServerRegister;
  readonly services: ServiceProvider;
  readonly startKernelJob: StartKernelJob;
  userData(name: string, version: number): UserData;
  readonly files: ModuleFiles;
  readonly kernelVersion: Health["kernelVersion"];
  bodies(projectId: string, user: User): Promise<ServerBody[]>;
  signFaces(
    projectId: string,
    user: User,
    refs: readonly FaceRef[],
  ): Promise<SignedFaceRef[]>;
  dxf(projectId: string, user: User, source: DxfSource): Promise<Uint8Array>;
}

export interface ProjectBody {
  readonly id: string;
  readonly name: string;
  readonly bbox: BodyPayload["bbox"];
  readonly reference?: true;
}
