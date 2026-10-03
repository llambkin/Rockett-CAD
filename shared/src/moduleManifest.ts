import { Type, type Static } from "typebox";
import { REGISTRY_ID } from "./registry.js";
import { NAME_LENGTH } from "./schema/coreFeatures.js";
import { parse, ValidationError } from "./schema/validation.js";
import { SETTING_KEY } from "./settings.js";

const CORE_NAMESPACES = ["design", "sketch", "inspect", "asm"];
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
  contributes: contributions,
});

export type ModuleManifest = Static<typeof moduleManifestSchema>;

export type ManifestCheck =
  | { status: "compatible"; manifest: ModuleManifest }
  | { status: "incompatible"; manifest: ModuleManifest; reason: string };

function contributionError(
  { id, contributes }: ModuleManifest,
  point: ContributionPoint,
): string | undefined {
  const prefix = point === "settings" ? `plugin.${id}.` : `${id}.`;
  const valid = point === "settings" ? SETTING_KEY : REGISTRY_ID;
  const entries = contributes[point] ?? [];
  const index = entries.findIndex(
    (entry) => !entry.startsWith(prefix) || !valid.test(entry),
  );
  if (index < 0) return undefined;
  return `contributes.${point}.${index} ${entries[index]} must start with ${prefix} and name a valid id`;
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
