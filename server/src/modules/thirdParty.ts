import { createHash } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PLUGIN_API_VERSION } from "@rockett/plugin-api";
import {
  defineSetting,
  HOST_IMPORTS,
  moduleEnabledSetting,
  moduleHostSettings,
  parseManifest,
  registerSettings,
  SETTINGS,
  type LayerValues,
  type ModuleStatus,
} from "@rockett/shared";
import { isMissing } from "../store/storage.js";
import { PLUGIN_LIMITS } from "../tunables.js";
import type { HostModule } from "./host.js";

export interface PluginDirs {
  root: string;
  stage: string;
}

export interface Refusal {
  manifest: unknown;
  status: Exclude<ModuleStatus, "loaded">;
  error: string;
}

type Tree = ReadonlyMap<string, Buffer>;

const CODE = /\.(?:mjs|cjs|js)$/;
const SPECIFIER = /\b(?:import|from|require)\s*\(?\s*(["'`])([^"'`\r\n]+)\1/g;

let closures: readonly (readonly [string, string])[] = [];
let stageRoot = "";

const stagedFolder = (id: string, closure: string) =>
  path.join(stageRoot, id, closure);

export const enabledPluginClosures = () => closures;

const closureSetting = (id: string) =>
  defineSetting({
    key: `plugin.${id}.sha256`,
    label: "Enabled closure sha256",
    scopes: ["app"],
    section: `plugin:${id}`,
    default: "",
    schema: { type: "string", pattern: "^([0-9a-f]{64})?$" },
  });

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const reason = (error: unknown) => {
  const { code } = error as NodeJS.ErrnoException;
  return typeof code === "string" ? `failed with ${code}` : errorMessage(error);
};

async function readBounded(file: string, room: number) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const { size } = await handle.stat();
    const data = size > room ? undefined : await handle.readFile();
    if (!data || data.length > room)
      throw new Error(`holds more than ${PLUGIN_LIMITS.bytes} bytes`);
    return data;
  } finally {
    await handle.close();
  }
}

async function readTree(dir: string): Promise<Tree> {
  const files = new Map<string, Buffer>();
  let entries = 0;
  let bytes = 0;
  const visit = async (rel: string): Promise<void> => {
    const found = await fs.readdir(path.join(dir, rel), {
      withFileTypes: true,
    });
    for (const entry of found) {
      const name = rel ? `${rel}/${entry.name}` : entry.name;
      if (++entries > PLUGIN_LIMITS.entries)
        throw new Error(
          `holds more than ${PLUGIN_LIMITS.entries} files and folders`,
        );
      if (entry.isSymbolicLink()) throw new Error(`${name} is a symlink`);
      if (entry.isDirectory()) await visit(name);
      else if (!entry.isFile())
        throw new Error(`${name} is not a file or folder`);
      else {
        const data = await readBounded(
          path.join(dir, name),
          PLUGIN_LIMITS.bytes - bytes,
        );
        bytes += data.length;
        files.set(name, data);
      }
    }
  };
  await visit("");
  return new Map(
    [...files.keys()].toSorted().map((name) => [name, files.get(name)!]),
  );
}

function closureSha256(tree: Tree) {
  const hash = createHash("sha256");
  for (const [name, data] of tree)
    hash.update(`${name}\0${data.length}\0`).update(data);
  return hash.digest("hex");
}

const HOST_IMPORT: ReadonlySet<string> = new Set(HOST_IMPORTS);

function inside(from: string, specifier: string) {
  if (isBuiltin(specifier)) return true;
  if (from === "client.mjs" && HOST_IMPORT.has(specifier)) return true;
  if (!/^\.\.?\//.test(specifier)) return false;
  const target = path.posix.join(path.posix.dirname(from), specifier);
  return target !== ".." && !target.startsWith("../");
}

function escape(tree: Tree) {
  for (const [name, data] of tree) {
    if (!CODE.test(name)) continue;
    for (const [, , specifier] of data.toString("utf8").matchAll(SPECIFIER))
      if (!inside(name, specifier!))
        return `${name} imports ${specifier}, which is outside the plugin folder`;
  }
  return undefined;
}

function refusal(id: string, closure: string, app: LayerValues) {
  if (app[moduleEnabledSetting(id).key] !== true)
    return `disabled until an admin enables it and records its closure sha256 ${closure}`;
  const recorded = app[closureSetting(id).key];
  if (!recorded)
    return `enabled, but no closure sha256 is recorded; record ${closure}`;
  if (recorded !== closure)
    return `its files changed since an admin enabled it; its closure sha256 is now ${closure}`;
  return undefined;
}

async function stage(dir: string, tree: Tree) {
  const folders = new Set([dir]);
  for (const [name, data] of tree) {
    const parts = name.split("/");
    for (let i = 1; i < parts.length; i++)
      folders.add(path.join(dir, ...parts.slice(0, i)));
    const file = path.join(dir, ...parts);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data, { mode: 0o444, flag: "wx" });
  }
  for (const folder of folders) await fs.chmod(folder, 0o555);
}

async function wipe(dir: string) {
  let entries;
  try {
    entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  await fs.chmod(dir, 0o755);
  for (const entry of entries)
    if (entry.isDirectory())
      await fs.chmod(path.join(entry.parentPath, entry.name), 0o755);
  await fs.rm(dir, { recursive: true });
}

const failed = (
  name: string,
  error: string,
  manifest: unknown = { id: name },
): Refusal => ({ manifest, status: "failed", error });

async function plugin(
  dirs: PluginDirs,
  name: string,
  app: LayerValues,
): Promise<HostModule | Refusal> {
  const refuse = (error: string, manifest?: unknown) =>
    failed(name, error, manifest);
  let tree;
  try {
    tree = await readTree(path.join(dirs.root, name));
  } catch (error) {
    return refuse(reason(error));
  }
  const text = tree.get("manifest.json");
  if (!text) return refuse("has no manifest.json");
  let manifest: unknown;
  try {
    manifest = JSON.parse(text.toString("utf8"));
  } catch {
    return refuse("manifest.json is not JSON");
  }
  let check;
  try {
    check = parseManifest(manifest, PLUGIN_API_VERSION);
  } catch (error) {
    return refuse(errorMessage(error), manifest);
  }
  const { id } = check.manifest;
  if (id !== name) return refuse(`folder ${name} holds manifest id ${id}`);
  if (!tree.has("server.mjs")) return refuse("has no server.mjs", manifest);
  const escaped = escape(tree);
  if (escaped) return refuse(escaped, manifest);
  if (check.status === "incompatible")
    return { manifest, status: "incompatible", error: check.reason };
  registerSettings(
    [...moduleHostSettings(id), closureSetting(id)].filter(
      ({ key }) => !SETTINGS.has(key),
    ),
  );
  const closure = closureSha256(tree);
  const disabled = refusal(id, closure, app);
  if (disabled) return { manifest, status: "disabled", error: disabled };
  const folder = stagedFolder(id, closure);
  closures = [...closures, [id, closure]];
  let server: HostModule["server"] | undefined;
  try {
    await stage(folder, tree);
    const entry = pathToFileURL(path.join(folder, "server.mjs")).href;
    ({ default: server } = (await import(entry)) as {
      default?: HostModule["server"];
    });
  } catch (error) {
    return refuse(reason(error), manifest);
  }
  if (typeof server?.activate !== "function")
    return refuse("server.mjs has no default export with activate", manifest);
  return {
    manifest,
    server,
    folder: pathToFileURL(`${folder}${path.sep}`),
    client: tree.has("client.mjs"),
  };
}

export async function stagedClient(id: string) {
  const closure = closures.find(([owner]) => owner === id)?.[1];
  if (!closure) return undefined;
  const tree = await readTree(stagedFolder(id, closure)).catch(() => undefined);
  if (!tree || closureSha256(tree) !== closure) return undefined;
  return tree.get("client.mjs");
}

export async function discoverPlugins(
  dirs: PluginDirs,
  app: LayerValues,
): Promise<(HostModule | Refusal)[]> {
  closures = [];
  stageRoot = dirs.stage;
  await wipe(dirs.stage);
  let entries;
  try {
    entries = await fs.readdir(dirs.root, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const folders = entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .toSorted((a, b) => (a.name < b.name ? -1 : 1));
  const found: (HostModule | Refusal)[] = [];
  for (const [i, entry] of folders.entries()) {
    const { name } = entry;
    if (entry.isSymbolicLink())
      found.push(failed(name, `${name} is a symlink`));
    else if (i >= PLUGIN_LIMITS.plugins)
      found.push(
        failed(
          name,
          `is past the first ${PLUGIN_LIMITS.plugins} plugin folders`,
        ),
      );
    else found.push(await plugin(dirs, name, app));
  }
  return found;
}
