import type { ComponentType } from "react";
import type { CadDocument, PathParams, Route, User } from "@rockett/shared";

export type {
  CadDocument,
  Feature,
  FeatureRef,
  FeatureSpec,
  MeasureRequest,
  MeasureResult,
  ModuleManifest,
  PathParams,
  Registry,
  Route,
} from "@rockett/shared";

export const PLUGIN_API_VERSION = "0.2.0";

export type Dispose = () => void;

export type RouteBody<R extends Route> = R extends { readonly body: object }
  ? R extends Route<string, infer Req>
    ? Req
    : unknown
  : unknown;

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

export interface RouteModuleApi {
  projectRoute<R extends Route>(
    route: R,
    read: (
      doc: CadDocument,
      req: RouteRequest<R>,
      ctx: { user: User },
    ) => Promise<unknown>,
  ): void;
  projectMutation<R extends Route>(
    route: R,
    edit: (doc: CadDocument, req: RouteRequest<R>) => Promise<ProjectMutation>,
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

export interface ServerRegister {
  routeModule(module: RouteModule): Dispose;
  kernelJob(id: string, entry: URL): Dispose;
}

export interface ServerContext {
  readonly register: ServerRegister;
  readonly startKernelJob: StartKernelJob;
}

export interface Anchored {
  id: string;
  after?: string;
  before?: string;
}

export interface CommandBase<Ctx> extends Anchored {
  label: string;
  when?(ctx: Ctx): boolean;
  enabled?(ctx: Ctx): true | string;
}

export type Keyed =
  | { keys?: never; keyContext?: never }
  | { keys: readonly string[]; keyContext: string };

export interface CommandControl {
  group: string;
  Control: ComponentType;
  run?: never;
  icon?: never;
}

export interface CommandAction<Ctx> {
  group?: never;
  icon?: never;
  Control?: never;
  run(ctx: Ctx): unknown;
}

export type Command<Ctx = unknown> = CommandBase<Ctx> &
  Keyed &
  (CommandControl | CommandAction<Ctx>);

export const EVERY_WORKBENCH = "workbench";

export interface ToolbarGroup extends Anchored {
  label: string;
  context: string;
  end?: true;
}

export interface Panel<State = unknown> {
  id: string;
  title: string;
  when(state: State, open: readonly string[]): boolean;
  component: ComponentType;
}

export interface Workbench {
  id: string;
  label: string;
  panels: readonly string[];
  selectionKinds: readonly string[];
  tree?: ComponentType;
  bar?: ComponentType;
}

export interface ClientRegister {
  command(command: Command): Dispose;
  toolbarGroup(group: ToolbarGroup): Dispose;
  panel(panel: Panel): Dispose;
  workbench(workbench: Workbench): Dispose;
}

export interface OpenProject {
  readonly projectId: string | null;
  readonly document: CadDocument | null;
}

export interface ProjectView {
  get(): OpenProject;
  subscribe(listener: () => void): Dispose;
}

export interface ClientContext {
  readonly register: ClientRegister;
  readonly project: ProjectView;
}

export interface ServerModule {
  activate(context: ServerContext): void | Promise<void>;
}

export interface ClientModule {
  activate(context: ClientContext): void | Promise<void>;
}

export const defineServerModule = (module: ServerModule) => module;
export const defineClientModule = (module: ClientModule) => module;
