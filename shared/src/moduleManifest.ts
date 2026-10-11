import { Type, type Static } from "typebox";
import { CORE_NAMESPACES } from "./featureSpec.js";
import { REGISTRY_ID } from "./registry.js";
import { NAME_LENGTH } from "./schema/coreFeatures.js";
import { parse, ValidationError } from "./schema/validation.js";
import {
  moduleHostSettings,
  registerSettings,
  SETTING_KEY,
  type SettingDefinition,
} from "./settings.js";
import { moduleBody } from "./topoRefs.js";

const API_RANGE = /^\^(\d+)\.(\d+)$/;
const HOST_VERSION = /^(\d+)\.(\d+)\.\d+$/;
const SPDX_ID = "[A-Za-z0-9][A-Za-z0-9.+-]*";

const text = Type.String({ minLength: 1, maxLength: NAME_LENGTH });
const ids = Type.Optional(Type.Array(text));

const contributions = Type.Object({
  features: ids,
  commands: ids,
  workbenches: ids,
  panels: ids,
  settings: ids,
  importers: ids,
  exporters: ids,
  routes: ids,
  selectionKinds: ids,
  toolbarGroups: ids,
  postProcessors: ids,
  sceneLayers: ids,
  pickProviders: ids,
  menuItems: ids,
  kernelJobs: ids,
});
type ContributionPoint = keyof typeof contributions.properties;
const CONTRIBUTION_POINTS = Object.keys(
  contributions.properties,
) as ContributionPoint[];

const moduleManifestSchema = Type.Object({
  manifestVersion: Type.Literal(1),
  id: Type.String({
    pattern: "^[a-z][a-z0-9]*(\\.[a-z][a-z0-9]*)*$",
    maxLength: NAME_LENGTH,
  }),
  name: text,
  version: Type.String({ pattern: "^\\d+\\.\\d+\\.\\d+$" }),
  apiRange: Type.String({ pattern: API_RANGE.source }),
  licence: Type.String({
    pattern: `^${SPDX_ID}( (AND|OR|WITH) ${SPDX_ID})*$`,
    maxLength: NAME_LENGTH,
  }),
  author: text,
  dataVersion: Type.Optional(Type.Integer({ minimum: 1 })),
  contributes: contributions,
});

export type ModuleManifest = Static<typeof moduleManifestSchema>;

type ManifestCheck =
  | { status: "compatible"; manifest: ModuleManifest }
  | { status: "incompatible"; manifest: ModuleManifest; reason: string };

function contributionError(
  { id, contributes }: ModuleManifest,
  point: ContributionPoint,
): string | undefined {
  const prefix = point === "settings" ? `plugin.${id}.` : `${id}.`;
  const valid = point === "settings" ? SETTING_KEY : REGISTRY_ID;
  const entries = contributes[point] ?? [];
  if (point === "settings") {
    const reserved = entries.findIndex(isHostSetting);
    if (reserved >= 0)
      return `contributes.settings.${reserved} ${entries[reserved]} is a host setting, so a module cannot define it`;
  }
  const index = entries.findIndex(
    (entry) => !entry.startsWith(prefix) || !valid.test(entry),
  );
  if (index < 0) return undefined;
  return `contributes.${point}.${index} ${entries[index]} must start with ${prefix} and name a valid id`;
}

const HOST_NAMES = moduleHostSettings("host").map(({ key }) =>
  key.slice("plugin.host".length),
);

const isHostSetting = (key: string) =>
  HOST_NAMES.some((name) => key.endsWith(name));

export const HOST_IMPORTS = [
  "react",
  "react/jsx-runtime",
  "react-dom/client",
  "three",
] as const;

export interface SettingOwner {
  id: string;
  contributes?: Partial<Record<string, readonly string[]>>;
}

export function checkModuleSetting(
  { id, contributes }: SettingOwner,
  key: string,
) {
  const prefix = `plugin.${id}.`;
  if (!key.startsWith(prefix))
    throw new Error(`setting ${key} must start with ${prefix}`);
  if (isHostSetting(key))
    throw new Error(
      `setting ${key} is a host setting, so a module cannot use it`,
    );
  if (!contributes?.settings?.includes(key))
    throw new Error(`setting ${key} is not in ${id} contributes.settings`);
}

export function registerModuleSetting(
  owner: SettingOwner,
  definition: SettingDefinition,
) {
  checkModuleSetting(owner, definition.key);
  return registerSettings([definition]);
}

function majorMinor(pattern: RegExp, value: string) {
  const match = pattern.exec(value);
  return match && ([Number(match[1]), Number(match[2])] as const);
}

export function parseManifest(
  json: unknown,
  hostApiVersion: string,
): ManifestCheck {
  const host = majorMinor(HOST_VERSION, hostApiVersion);
  if (!host) throw new Error(`Invalid host API version ${hostApiVersion}`);
  const manifest = parse(moduleManifestSchema, json, "manifest");
  const core = CORE_NAMESPACES.find(
    (ns) => manifest.id === ns || manifest.id.startsWith(`${ns}.`),
  );
  if (core)
    throw new ValidationError(
      `manifest.id ${manifest.id} uses core namespace ${core}`,
    );
  if (!moduleBody(`${manifest.id}:`))
    throw new ValidationError(
      `manifest.id ${manifest.id} would read as a core body id`,
    );
  for (const point of CONTRIBUTION_POINTS) {
    const error = contributionError(manifest, point);
    if (error) throw new ValidationError(`manifest.${error}`);
  }
  const [major, minor] = majorMinor(API_RANGE, manifest.apiRange)!;
  const [hostMajor, hostMinor] = host;
  const covered =
    hostMajor === major &&
    (major === 0 ? hostMinor === minor : hostMinor >= minor);
  if (covered) return { status: "compatible", manifest };
  return {
    status: "incompatible",
    manifest,
    reason: `${manifest.id} needs plugin API ${manifest.apiRange}; this host has ${hostApiVersion}`,
  };
}
