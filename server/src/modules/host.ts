import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLUGIN_API_VERSION,
  type DataMigrations,
  type Dispose,
  type ProjectServiceHandler,
  type ServerRegister,
  type ServerContext,
  type StartKernelJob,
  type TimelineFeature,
} from "@rockett/plugin-api";
import {
  createRegistry,
  moduleEnabledSetting,
  moduleHostSettings,
  parseManifest,
  REGISTRY_ID,
  registerExtensionSpec,
  registerModuleSetting,
  registerSettings,
  resolveSettings,
  SETTINGS,
  ValidationError,
  type FaceRef,
  type LayerValues,
  type ModuleInfo,
  type ModuleManifest,
  type SettingDefinition,
} from "@rockett/shared";
import { signAt } from "../api/featureRoutes.js";
import { registerImporter } from "../api/importers.js";
import { registerRouteModule } from "../api/routeModules.js";
import { registerExporter } from "../geometry/exporters.js";
import { registerFeatureKind } from "../geometry/featureKinds.js";
import type { ExportJob, KernelClient } from "../kernel/client.js";
import type { FolderStore } from "../store/folderStore.js";
import { registerDataMigrations } from "../store/migrations.js";
import { moduleUserData } from "../store/moduleData.js";
import { StoreError, type ProjectStore } from "../store/projectStore.js";
import { isMissing } from "../store/storage.js";
import { finalModel, moduleBodies, type BodyKernel } from "./bodies.js";
import { checkModuleType } from "./features.js";
import { moduleFiles } from "./files.js";
import { provideService } from "./services.js";
import {
  discoverPlugins,
  errorMessage,
  stagedClient,
  type PluginDirs,
} from "./thirdParty.js";

type Kernel = Pick<KernelClient, "moduleJob" | "installFeatures" | "export"> &
  BodyKernel;

declare const KERNEL_BUNDLES: Readonly<Record<string, string>>;

const kernelJobs = createRegistry<{ id: string; entry: string }>(
  "kernel job",
  (job) => job.id,
);

function jobEntry(moduleId: string, entry: URL) {
  if (typeof KERNEL_BUNDLES !== "object") return entry.href;
  const bundle = Object.hasOwn(KERNEL_BUNDLES, moduleId)
    ? KERNEL_BUNDLES[moduleId]
    : undefined;
  if (bundle === undefined || !entry.pathname.endsWith("/kernel.ts"))
    throw new Error(
      `kernel job entry ${entry.href} is not the kernel.ts that ${moduleId} ships`,
    );
  return bundle;
}

function registerKernelJob(moduleId: string, id: string, entry: URL) {
  if (!id.startsWith(`${moduleId}.`) || !REGISTRY_ID.test(id))
    throw new Error(
      `kernel job ${id} must start with ${moduleId}. and name a valid id`,
    );
  return kernelJobs.register({ id, entry: jobEntry(moduleId, entry) });
}

const starter =
  (moduleId: string, kernel: Kernel): StartKernelJob =>
  async (id, input, run = {}) => {
    const job = id.startsWith(`${moduleId}.`) ? kernelJobs.get(id) : undefined;
    if (!job)
      throw new Error(`kernel job ${id} is not registered by ${moduleId}`);
    return kernel.moduleJob(job.entry, id, input, {
      onProgress: (...args) => run.onProgress?.(...args),
      shouldStop: () => run.signal?.aborted === true,
    });
  };

function registerExtensionSpecOwned(
  own: Dispose[],
  moduleId: string,
): ServerRegister["extensionSpec"] {
  return (spec) => {
    checkModuleType(moduleId, spec.type, "extension spec");
    const dispose = registerExtensionSpec(spec);
    own.push(dispose);
    return dispose;
  };
}

function registrars(own: Dispose[], manifest: ModuleManifest, kernel: Kernel) {
  const moduleId = manifest.id;
  const track =
    <A extends unknown[]>(register: (...args: A) => Dispose) =>
    (...args: A) => {
      const dispose = register(...args);
      own.push(dispose);
      return dispose;
    };
  return {
    register: {
      routeModule: track((module: Parameters<typeof registerRouteModule>[0]) =>
        registerRouteModule(module, moduleId),
      ),
      exporter: track(registerExporter),
      importer: track(registerImporter),
      featureKind: track(registerFeatureKind),
      extensionSpec: registerExtensionSpecOwned(own, moduleId),
      kernelJob: track((id: string, entry: URL) =>
        registerKernelJob(moduleId, id, entry),
      ),
      async timelineFeature(feature: TimelineFeature, entry: URL) {
        const { type } = feature.spec;
        checkModuleType(moduleId, type, "timeline feature");
        const spec = registerExtensionSpec(feature.spec);
        const kind = await kernel
          .installFeatures({ moduleId, entry: jobEntry(moduleId, entry), type })
          .catch((error: unknown) => {
            spec();
            throw error;
          });
        const dispose = () => {
          kind();
          spec();
        };
        own.push(dispose);
        return dispose;
      },
      setting: track((definition: SettingDefinition) =>
        registerModuleSetting(manifest, definition),
      ),
    },
    services: {
      provide: track((id: string, handler: ProjectServiceHandler) =>
        provideService(moduleId, id, handler),
      ),
    },
  };
}

export interface ModuleContext extends ServerContext {
  register: ReturnType<typeof registrars>["register"];
}

export interface HostModule {
  manifest: unknown;
  server: {
    activate(context: ModuleContext): void | Promise<void>;
    migrations?: DataMigrations;
  };
  folder?: URL;
  client?: boolean;
}

const ABOUT = ["id", "name", "version", "licence", "author"] as const;
type About = Pick<ModuleInfo, (typeof ABOUT)[number]>;

function about(manifest: unknown): About {
  const raw: Record<string, unknown> =
    typeof manifest === "object" && manifest !== null ? { ...manifest } : {};
  return Object.fromEntries(
    ABOUT.map((key) => [key, typeof raw[key] === "string" ? raw[key] : ""]),
  ) as About;
}

const disposeAll = (disposers: readonly Dispose[]) => {
  for (const dispose of disposers.toReversed()) dispose();
};

function enabled(moduleId: string, app: LayerValues) {
  registerSettings(
    moduleHostSettings(moduleId).filter(({ key }) => !SETTINGS.has(key)),
  );
  const { key } = moduleEnabledSetting(moduleId);
  return resolveSettings({ app }).values[key]?.value !== false;
}

const signFaces =
  (
    kernel: Kernel,
    store: ProjectStore,
    folders: FolderStore,
  ): ServerContext["signFaces"] =>
  async (projectId, user, refs) => {
    const doc = await finalModel(store, folders, user, projectId);
    const faces = refs.map(({ bodyId, faceName }): FaceRef => ({
      kind: "face",
      bodyId,
      faceName,
    }));
    await signAt(kernel, doc, doc.timelinePosition, faces);
    return faces.map(({ kind, bodyId, faceName, sig }) => {
      if (!sig)
        throw new ValidationError(
          `face ${faceName} of body ${bodyId} is not in the model`,
        );
      return { kind, bodyId, faceName, sig };
    });
  };

const DXF_SOURCE =
  "dxf takes { sketchId } or { face }, and an optional layer name";

const named = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

function dxfSource(
  source: unknown,
): Pick<ExportJob, "sketchId" | "face" | "layer"> {
  const { sketchId, face, layer } = Object(source) as Record<string, unknown>;
  const { kind, bodyId, faceName } = Object(face) as Record<string, unknown>;
  if (layer !== undefined && typeof layer !== "string")
    throw new ValidationError(DXF_SOURCE);
  const onLayer = layer === undefined ? {} : { layer };
  if (face === undefined && named(sketchId)) return { sketchId, ...onLayer };
  if (
    sketchId === undefined &&
    kind === "face" &&
    named(bodyId) &&
    named(faceName)
  )
    return { face: { kind, bodyId, faceName }, ...onLayer };
  throw new ValidationError(DXF_SOURCE);
}

const drawDxf =
  (
    kernel: Kernel,
    store: ProjectStore,
    folders: FolderStore,
  ): ServerContext["dxf"] =>
  async (projectId, user, source) => {
    const job = dxfSource(source);
    const doc = await finalModel(store, folders, user, projectId);
    const { data } = await kernel.export(doc, {
      format: "dxf",
      bodyIds: [],
      hidden: [],
      ...job,
    });
    return data;
  };

async function load(
  module: HostModule,
  own: Dispose[],
  kernel: Kernel,
  store: ProjectStore,
  folders: FolderStore,
  app: LayerValues,
): Promise<ModuleInfo> {
  let check;
  try {
    check = parseManifest(module.manifest, PLUGIN_API_VERSION);
  } catch (error) {
    return {
      ...about(module.manifest),
      status: "failed",
      error: errorMessage(error),
    };
  }
  const info = about(check.manifest);
  if (!enabled(check.manifest.id, app))
    return { ...info, status: "disabled", error: null };
  if (check.status === "incompatible")
    return { ...info, status: "incompatible", error: check.reason };
  try {
    const { id, dataVersion } = check.manifest;
    const { migrations } = module.server;
    if (dataVersion === undefined && migrations !== undefined)
      throw new Error(`${id} exports migrations but declares no dataVersion`);
    if (dataVersion !== undefined)
      own.push(registerDataMigrations(id, dataVersion, migrations ?? {}));
    const { storage } = store.documents.options;
    await module.server.activate({
      ...registrars(own, check.manifest, kernel),
      startKernelJob: starter(id, kernel),
      userData: moduleUserData(storage, id),
      files: moduleFiles(storage, id),
      get kernelVersion() {
        return kernel.version();
      },
      bodies: moduleBodies(kernel, store, folders),
      signFaces: signFaces(kernel, store, folders),
      dxf: drawDxf(kernel, store, folders),
    });
  } catch (error) {
    disposeAll(own.splice(0));
    return { ...info, status: "failed", error: errorMessage(error) };
  }
  return { ...info, status: "loaded", error: null };
}

let loaded: readonly ModuleInfo[] = [];
let homes = new Map<string, URL>();

export const listModules = () => loaded;

export async function moduleLicence(id: string): Promise<string> {
  if (!loaded.some((module) => module.id === id))
    throw new StoreError(`module ${id} is not installed`, "not_found");
  const folder = homes.get(id);
  const missing = new StoreError(
    `module ${id} has no LICENSE file`,
    "not_found",
  );
  if (!folder) throw missing;
  try {
    return await readFile(path.join(fileURLToPath(folder), "LICENSE"), "utf8");
  } catch (error) {
    if (isMissing(error)) throw missing;
    throw error;
  }
}

export async function moduleClient(id: string): Promise<Buffer> {
  const code = loaded.some((module) => module.id === id && module.client)
    ? await stagedClient(id)
    : undefined;
  if (!code)
    throw new StoreError(`module ${id} has no client to serve`, "not_found");
  return code;
}

export async function loadModules(
  modules: readonly HostModule[],
  kernel: Kernel,
  store: ProjectStore,
  folders: FolderStore,
  plugins?: PluginDirs,
): Promise<Dispose> {
  const disposers: Dispose[] = [];
  const reports: ModuleInfo[] = [];
  const found = new Map<string, URL>();
  const app = await store.settings.read({ scope: "app" });
  const thirdParty = plugins ? await discoverPlugins(plugins, app) : [];
  for (const module of [...modules, ...thirdParty]) {
    if ("status" in module) {
      const { manifest, status, error } = module;
      reports.push({ ...about(manifest), status, error });
      continue;
    }
    const own: Dispose[] = [];
    const report = await load(module, own, kernel, store, folders, app);
    reports.push(
      report.status === "loaded" && module.client
        ? { ...report, client: true }
        : report,
    );
    if (module.folder) found.set(report.id, module.folder);
    disposers.push(() => disposeAll(own));
  }
  loaded = reports;
  homes = found;
  return () => {
    disposeAll(disposers);
    loaded = [];
    homes = new Map();
  };
}
