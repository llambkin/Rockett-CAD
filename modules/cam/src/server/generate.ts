import { Value } from "typebox/value";
import {
  StoreError,
  type CadDocument,
  type FeatureStatus,
  type KernelJobRun,
  type RouteModuleApi,
  type ServerBody,
  type ServerContext,
  type User,
} from "@rockett/plugin-api";
import type { GenerateInput } from "../kernel/input.js";
import {
  CAM_EXTENSION,
  CAM_VERSION,
  generateRoute,
  generateStaleRoute,
  migrateCam,
  programRoute,
  statusRoute,
  type CamData,
  type OperationStatus,
  type Target,
} from "../shared/document.js";
import type { Program } from "../shared/ir.js";
import { isOperation, OPERATION_VERSIONS } from "../shared/operations.js";
import type { StockSetup } from "../shared/setup.js";
import { toolSchema, type Tool } from "../shared/tools.js";
import { programCache, type ProgramCache } from "./cache.js";

export const CAM_ENGINE = 1;
export const GENERATE_JOB = "rockett.cam.generate";

export type GenerateRequest = Omit<GenerateInput, "bodies"> & {
  projectId: string;
  user: User;
};

export const sorted = (_key: string, value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).toSorted(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      )
    : value;

export async function sha256(text: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export { generateRoute };

export const refusal = (reason: string) =>
  new StoreError(reason, "unprocessable");

const refused = async <T>(run: () => Promise<T>) => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Error && error.name === "RangeError")
      throw refusal(error.message);
    throw error;
  }
};

type Blocked = Extract<OperationStatus, { reason: string }>;

const why = ({ featureId, status, error }: FeatureStatus) =>
  status === "error"
    ? `${featureId}, which failed${error ? `: ${error}` : ""}`
    : status === "cancelled"
      ? `${featureId}, which was cancelled`
      : `${featureId}, which has unresolved references`;

export type Model = Map<string, ServerBody>;
type Job = Omit<GenerateInput, "bodies">;
type Ready = { fingerprint: string; input: GenerateInput };

export const readModel = async (
  context: Pick<ServerContext, "bodies">,
  projectId: string,
  user: User,
): Promise<Model> =>
  new Map(
    (await context.bodies(projectId, user)).map((body) => [body.id, body]),
  );

export function setupBodies(
  model: Model,
  ids: readonly string[],
): ServerBody[] | Blocked {
  const bodies: ServerBody[] = [];
  for (const id of ids) {
    const body = model.get(id);
    if (!body)
      return {
        status: "missingReference",
        reason: `setup body ${id} is not in the model`,
      };
    if (body.problems?.length)
      return {
        status: "error",
        reason: `setup body ${id} depends on ${body.problems.map(why).join("; ")}`,
      };
    bodies.push(body);
  }
  return bodies;
}

export async function stockSetup(
  context: Pick<ServerContext, "bodies">,
  doc: CadDocument,
  { id, setupId }: { id: string; setupId: string },
  user: User,
): Promise<{ setup: StockSetup; bodies: ServerBody[] } | { reason: string }> {
  const setup = cam(doc).setups.find((item) => item.id === setupId);
  if (!setup) return { reason: `setup ${setupId} is not in this project` };
  const { bodies: ids, stock, wcs } = setup;
  if (!ids?.length || !stock || !wcs)
    return { reason: `setup ${setupId} needs bodies, stock and WCS` };
  const bodies = setupBodies(await readModel(context, id, user), ids);
  if ("reason" in bodies) return { reason: bodies.reason };
  return { setup: { bodies: ids, stock, wcs }, bodies };
}

async function prepare(model: Model, job: Job): Promise<Blocked | Ready> {
  const { type } = job.operation;
  if (!isOperation(type))
    return { status: "error", reason: `operation ${type} is unknown` };
  const bodies = setupBodies(model, job.setup.bodies);
  if ("reason" in bodies) return bodies;
  const fingerprint = await sha256(
    JSON.stringify(
      {
        engine: CAM_ENGINE,
        generator: OPERATION_VERSIONS[type],
        bodies: bodies.map((body) => body.fingerprint),
        ...job,
      },
      sorted,
    ),
  );
  return {
    fingerprint,
    input: {
      ...job,
      bodies: bodies.map(({ id, bbox, brep, faceNames }) => ({
        id,
        bbox,
        brep,
        faceNames,
      })),
    },
  };
}

type Made = { fingerprint: string; program: Program };

const producer =
  (context: Pick<ServerContext, "startKernelJob">, cache: ProgramCache) =>
  async (
    { fingerprint, input }: Ready,
    run: KernelJobRun = {},
  ): Promise<Made> => ({
    fingerprint,
    program: await cache.program(
      fingerprint,
      () =>
        refused(
          async () =>
            (await context.startKernelJob(GENERATE_JOB, input, run)) as Program,
        ),
      run.signal,
    ),
  });

export function generator(
  context: Pick<ServerContext, "bodies" | "startKernelJob">,
  cache: ProgramCache,
) {
  const produce = producer(context, cache);
  return async function generate(
    { projectId, user, ...job }: GenerateRequest,
    run: KernelJobRun = {},
  ): Promise<Made> {
    const ready = await prepare(await readModel(context, projectId, user), job);
    if ("reason" in ready) throw refusal(ready.reason);
    return produce(ready, run);
  };
}

export function cam(doc: CadDocument): CamData {
  const read = migrateCam(doc.extensions[CAM_EXTENSION]);
  if (read.status === "kept") throw refusal(read.reason);
  return read.data;
}

const find = (data: CamData, { setupId, operationId }: Target) => {
  const setup = data.setups.find((item) => item.id === setupId);
  if (!setup) throw refusal(`setup ${setupId} is not in this project`);
  const op = setup.operations?.find((item) => item.id === operationId);
  if (!op) throw refusal(`operation ${operationId} is not in ${setupId}`);
  return { setup, op };
};

export function inputs(data: CamData, at: Target): Job | string {
  const { setup, op } = find(data, at);
  const { bodies, stock, wcs, safeHeight, clearance, fixtures } = setup;
  if (!bodies || !stock || !wcs || safeHeight === undefined)
    return `setup ${setup.id} needs bodies, stock, WCS and heights`;
  if (clearance === undefined || !op.type)
    return `setup ${setup.id} needs a clearance and operation type`;
  const found = data.tools.find((item) => item.id === op.toolId);
  if (!found) return `operation ${op.id} needs a tool`;
  const { presets, libraryRef: _ref, ...tool } = found;
  if (!Value.Check(toolSchema, { ...tool }) || tool.number === undefined)
    return `operation ${op.id} needs a complete numbered tool`;
  const preset = presets?.find((item) => item.id === op.presetId);
  if (!preset) return `operation ${op.id} needs a preset of its tool`;
  return structuredClone({
    setup: {
      id: setup.id,
      bodies,
      stock,
      wcs,
      safeHeight,
      clearance,
      ...(fixtures && { fixtures }),
    },
    operation: { id: op.id, type: op.type, params: op.params ?? {} },
    tool: tool as Tool & { number: number },
    preset,
  });
}

export async function assess(
  model: Model,
  data: CamData,
  at: Target,
  cache: Pick<ProgramCache, "failure">,
): Promise<[OperationStatus, Ready?]> {
  const { op } = find(data, at);
  if (op.suppressed) return [{ status: "suppressed" }];
  const job = inputs(data, at);
  if (typeof job === "string") return [{ status: "error", reason: job }];
  const ready = await prepare(model, job);
  if ("reason" in ready) return [ready];
  const failed = cache.failure(ready.fingerprint);
  if (failed !== undefined) return [{ status: "error", reason: failed }];
  if (!op.lastGenerated) return [{ status: "never" }];
  return op.lastGenerated.fingerprint === ready.fingerprint
    ? [{ status: "fresh" }]
    : [{ status: "stale" }, ready];
}

const stamp = async ({ fingerprint, program }: Made) => ({
  fingerprint,
  programSha256: await sha256(JSON.stringify(program)),
  at: new Date().toISOString(),
});

const save = (doc: CadDocument, data: CamData) => {
  doc.extensions[CAM_EXTENSION] = { version: CAM_VERSION, data };
};

export function mountGenerate(
  api: RouteModuleApi,
  context: Pick<ServerContext, "bodies" | "startKernelJob" | "files">,
): ProgramCache {
  const cache = programCache(context.files);
  const generate = generator(context, cache);
  const produce = producer(context, cache);
  api.projectRoute(statusRoute, async (doc, req, { user }) => {
    const { id, setupId } = req.params;
    const data = cam(doc);
    const setup = data.setups.find((item) => item.id === setupId);
    if (!setup) throw refusal(`setup ${setupId} is not in this project`);
    const operations = setup.operations ?? [];
    if (!operations.length) return {};
    const model = await readModel(context, id, user);
    return Object.fromEntries(
      await Promise.all(
        operations.map(async ({ id: operationId }) => {
          const [status] = await assess(
            model,
            data,
            { setupId, operationId },
            cache,
          );
          return [operationId, status];
        }),
      ),
    );
  });
  api.projectRoute(programRoute, async (doc, req) => {
    const { op } = find(cam(doc), req.params);
    const name = op.name ?? op.id;
    if (!op.lastGenerated) return { reason: `${name} has not been generated` };
    const program = await cache.cached(op.lastGenerated.fingerprint);
    return program
      ? { program }
      : { reason: `${name} is not cached; generate it again` };
  });
  api.projectMutation(generateRoute, async (doc, req, { user }) => {
    const data = cam(doc);
    const { op } = find(data, req.body);
    if (op.suppressed)
      throw refusal(`operation ${op.id} is suppressed; unsuppress it first`);
    const ready = inputs(data, req.body);
    if (typeof ready === "string") throw refusal(ready);
    const made = await generate({ projectId: req.params.id, user, ...ready });
    op.lastGenerated = await stamp(made);
    save(doc, data);
    return { label: `Generate ${op.name ?? op.id}`, ...made };
  });
  api.projectMutation(generateStaleRoute, async (doc, req, { user }) => {
    const data = cam(doc);
    const model = await readModel(context, req.params.id, user);
    const stale = [];
    for (const setup of data.setups)
      for (const op of setup.operations ?? []) {
        const at = { setupId: setup.id, operationId: op.id };
        const [{ status }, ready] = await assess(model, data, at, cache);
        if (status === "stale" && ready) stale.push({ op, ready });
      }
    if (!stale.length) throw refusal("No operation is stale");
    for (const { op, ready } of stale)
      op.lastGenerated = await stamp(await produce(ready));
    save(doc, data);
    return { label: "Generate all stale" };
  });
  return cache;
}
