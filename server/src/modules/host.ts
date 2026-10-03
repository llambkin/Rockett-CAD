import { PLUGIN_API_VERSION } from "@rockett/plugin-api";
import {
  parseManifest,
  registerExtensionSpec,
  type ModuleInfo,
} from "@rockett/shared";
import { registerImporter } from "../api/importers.js";
import { registerRouteModule } from "../api/routeModules.js";
import { registerExporter } from "../geometry/exporters.js";
import { registerFeatureKind } from "../geometry/featureKinds.js";

type Dispose = () => void;

function registrars(own: Dispose[]) {
  const track =
    <A extends unknown[]>(register: (...args: A) => Dispose) =>
    (...args: A) => {
      const dispose = register(...args);
      own.push(dispose);
      return dispose;
    };
  return {
    routeModule: track(registerRouteModule),
    exporter: track(registerExporter),
    importer: track(registerImporter),
    featureKind: track(registerFeatureKind),
    extensionSpec: track(registerExtensionSpec),
  };
}

export interface ModuleContext {
  register: ReturnType<typeof registrars>;
}

export interface HostModule {
  manifest: unknown;
  server: { activate(context: ModuleContext): void | Promise<void> };
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

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const disposeAll = (disposers: readonly Dispose[]) => {
  for (const dispose of disposers.toReversed()) dispose();
};

async function load(module: HostModule, own: Dispose[]): Promise<ModuleInfo> {
  let check;
  try {
    check = parseManifest(module.manifest, PLUGIN_API_VERSION);
  } catch (error) {
    return {
      ...about(module.manifest),
      status: "failed",
      error: message(error),
    };
  }
  const info = about(check.manifest);
  if (check.status === "incompatible")
    return { ...info, status: "incompatible", error: check.reason };
  try {
    await module.server.activate({ register: registrars(own) });
  } catch (error) {
    disposeAll(own.splice(0));
    return { ...info, status: "failed", error: message(error) };
  }
  return { ...info, status: "loaded", error: null };
}

let loaded: readonly ModuleInfo[] = [];

export const listModules = () => loaded;

export async function loadModules(
  modules: readonly HostModule[],
): Promise<Dispose> {
  const disposers: Dispose[] = [];
  const reports: ModuleInfo[] = [];
  for (const module of modules) {
    const own: Dispose[] = [];
    reports.push(await load(module, own));
    disposers.push(() => disposeAll(own));
  }
  loaded = reports;
  return () => {
    disposeAll(disposers);
    loaded = [];
  };
}
