import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import {
  presetSchema,
  toolSchema,
  validatePreset,
  validateTool,
  type Preset,
  type Tool,
} from "../shared/tools.js";

export const TOOLS_FILE = "rockett-tools.json";

const FORMAT = "rockett-tools";
const VERSION = 1;

export type Reject = { item: string; reason: string };
export type ToolImport = {
  tools: Tool[];
  presets: Preset[];
  rejects: Reject[];
};

type Item = { id: string };
type Entry = { id?: unknown; name?: unknown; kind?: unknown };

export const exportTools = (tools: Tool[], presets: Preset[]) =>
  JSON.stringify({ format: FORMAT, version: VERSION, tools, presets }, null, 2);

export function merge<T extends Item>(
  items: T[],
  incoming: T[],
  replace: boolean,
): T[] {
  const known = new Set(items.map((item) => item.id));
  const added = incoming.filter((item) => !known.has(item.id));
  const byId = new Map(incoming.map((item) => [item.id, item]));
  const replaced = replace && items.some((item) => byId.has(item.id));
  if (!added.length && !replaced) return items;
  const kept = replaced
    ? items.map((item) => byId.get(item.id) ?? item)
    : items;
  return [...kept, ...added];
}

function schemaProblem(schema: TSchema, value: unknown) {
  const [error] = Value.Errors(schema, value);
  if (!error) return undefined;
  const field = error.instancePath.slice(1).replaceAll("/", ".");
  return field ? `${field} ${error.message}` : error.message;
}

function toolProblem(value: unknown) {
  const kind = (value as Entry | null)?.kind;
  if (typeof value !== "object" || value === null) return "must be object";
  const branch = toolSchema.anyOf.find((b) =>
    Value.Check(b.properties.kind, kind),
  );
  if (!branch) return `kind ${JSON.stringify(kind)} is not a tool kind`;
  return schemaProblem(branch, value) ?? validateTool(value as Tool)[0];
}

const presetProblem = (value: unknown) =>
  schemaProblem(presetSchema, value) ?? validatePreset(value as Preset)[0];

function entries<T extends Item>(
  values: unknown[],
  noun: string,
  problem: (value: unknown) => string | undefined,
  rejects: Reject[],
): T[] {
  const ids = new Set<string>();
  const kept: T[] = [];
  values.forEach((value, index) => {
    const { name, id } = (value ?? {}) as Entry;
    const item =
      typeof name === "string" && name ? name : `${noun} ${index + 1}`;
    const reason =
      problem(value) ??
      (ids.has(id as string) ? `id ${id} appears twice` : undefined);
    if (reason) return void rejects.push({ item, reason });
    ids.add(id as string);
    kept.push(value as T);
  });
  return kept;
}

const refused = (reason: string): ToolImport => ({
  tools: [],
  presets: [],
  rejects: [{ item: "File", reason }],
});

export function importRockett(text: string): ToolImport {
  let body: {
    format?: unknown;
    version?: unknown;
    tools?: unknown;
    presets?: unknown;
  };
  try {
    body = JSON.parse(text) ?? {};
  } catch {
    return refused("is not JSON");
  }
  if (body.format !== FORMAT) return refused(`is not a ${FORMAT} file`);
  if (body.version !== VERSION)
    return refused(
      `is version ${body.version}; this Rockett reads version ${VERSION}`,
    );
  const presets = body.presets ?? [];
  if (!Array.isArray(body.tools)) return refused("tools must be a list");
  if (!Array.isArray(presets)) return refused("presets must be a list");
  const rejects: Reject[] = [];
  return {
    tools: entries<Tool>(body.tools, "Tool", toolProblem, rejects),
    presets: entries<Preset>(presets, "Preset", presetProblem, rejects),
    rejects,
  };
}
