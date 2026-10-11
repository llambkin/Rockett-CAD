import { strToU8, zipSync } from "fflate";
import { Value } from "typebox/value";
import type { RouteModuleApi, ServerContext, User } from "@rockett/plugin-api";
import manifest from "../../manifest.json";
import { checkProgram } from "../post/check.js";
import { formatProgram, type FormatOptions } from "../post/format.js";
import { linked } from "../post/link.js";
import { normalise } from "../post/normalise.js";
import { commentForm, type Post } from "../post/schema.js";
import {
  copiedPost,
  ncRoute,
  type Blocker,
  type CamData,
  type NcExport,
  type PostCopy,
  USER_POST_PREFIX,
} from "../shared/document.js";
import type { Program } from "../shared/ir.js";
import {
  machineKind,
  machineSchema,
  type MachineProfile,
} from "../shared/machine.js";
import { stockBox } from "../shared/setup.js";
import type { ProgramCache } from "./cache.js";
import { emittedProblems, expected } from "./emitted.js";
import {
  assess,
  cam,
  inputs,
  readModel,
  sha256,
  sorted,
  type Model,
} from "./generate.js";
import { libraryItem } from "./library.js";
import { POSTS } from "./posts.js";

type Setup = CamData["setups"][number];
type Operation = NonNullable<Setup["operations"]>[number];
type Made = { op: Operation; program: Program };
type Target = {
  post: Post;
  machine: MachineProfile;
  toolChange: boolean;
  kernel: string;
};
type File = { name: string; text: string };
type Posted = { files: string[] } | { blocked: Blocker[] };

const EXPORT_MAX_BYTES = 64 * 1024 * 1024;
const NOT_CACHED = "is not cached; generate it again";

async function gather(
  model: Model,
  data: CamData,
  setup: Setup,
  cache: ProgramCache,
) {
  const blocked: Blocker[] = [];
  const made: Made[] = [];
  for (const op of setup.operations ?? []) {
    const at = { setupId: setup.id, operationId: op.id };
    const [state] = await assess(model, data, at, cache);
    if (state.status === "suppressed") continue;
    const blocker = {
      kind: "operation" as const,
      ...at,
      name: op.name ?? op.id,
    };
    if (state.status !== "fresh" || !op.lastGenerated) {
      blocked.push({ ...blocker, ...state });
      continue;
    }
    const { fingerprint, programSha256 } = op.lastGenerated;
    const program = await cache.cached(fingerprint);
    if (program && (await sha256(JSON.stringify(program))) === programSha256)
      made.push({ op, program });
    else blocked.push({ ...blocker, status: "fresh", reason: NOT_CACHED });
  }
  return { blocked, made };
}

function combined(setupId: string, offsetIndex: number, made: Made[]) {
  const tools = made.flatMap(({ program }) => program.tools);
  const program: Program = {
    irVersion: 1,
    units: "mm",
    setupId,
    offsetIndex,
    tools: [
      ...new Map(tools.map((tool) => [JSON.stringify(tool), tool])).values(),
    ],
    sections: made.flatMap(({ program: each }) => each.sections),
  };
  return program;
}

function header(post: Post, lines: string[]) {
  const { open, close } = commentForm(post.templates.comment)!;
  return lines.map((line) => `${open}${line}${close}\n`).join("");
}

const fingerprint = (target: Target, setupId: string, made: Made[]) =>
  sha256(
    JSON.stringify(
      {
        post: target.post,
        machine: target.machine,
        toolChange: target.toolChange,
        setupId,
        operations: made.map(({ op }) => ({
          id: op.id,
          fingerprint: op.lastGenerated?.fingerprint,
          programSha256: op.lastGenerated?.programSha256,
        })),
      },
      sorted,
    ),
  );

function formatOptions(machine: MachineProfile): FormatOptions {
  const max = machine.laserPowerMax;
  const accelerationProfiles = machine.accelerationProfiles === true;
  return machineKind(machine) === "laser" && max !== undefined
    ? { laserPowerMax: max, accelerationProfiles }
    : { accelerationProfiles };
}

async function posted(
  model: Model,
  data: CamData,
  setup: Setup,
  made: Made[],
  target: Target,
  room: number,
): Promise<Posted> {
  const { post, machine, toolChange } = target;
  const check = (rule: string, reason: string): Blocker => ({
    kind: "check",
    setupId: setup.id,
    rule,
    reason,
  });
  const job = inputs(data, { setupId: setup.id, operationId: made[0]!.op.id });
  if (typeof job === "string") return { blocked: [check("ir", job)] };
  const boxes = Object.fromEntries(
    job.setup.bodies.map((id) => [id, model.get(id)!.bbox]),
  );
  const { min, max } = stockBox(job.setup, boxes);
  const checked = {
    ...job.setup,
    name: setup.name ?? setup.id,
    tolerance: 0,
    fixtures: setup.fixtures ?? [],
  };
  const program = linked(combined(setup.id, job.setup.wcs.offsetIndex, made), {
    setup: checked,
    stock: { max },
    spinUpSeconds: machine.spinUpSeconds,
  });
  const { problems } = checkProgram({
    program,
    setup: checked,
    stock: { min, max },
    operations: made.map(({ op }) => ({ id: op.id, type: op.type ?? "" })),
    machine,
    post,
    units: machine.units,
  });
  const opName = (section?: number) => {
    const id = section === undefined ? undefined : program.sections[section];
    const op = made.find((each) => each.op.id === id?.operationId)?.op;
    return op ? `${op.name ?? op.id}: ` : "";
  };
  if (problems.length)
    return {
      blocked: problems.map((p) => check(p.rule, opName(p.section) + p.reason)),
    };
  const units = machine.units;
  const normalised = normalise(program, post, { units, toolChange });
  const top = header(post, [
    `Rockett CAM ${manifest.version}`,
    `kernel ${target.kernel}`,
    `post ${post.id}`,
    `input ${await fingerprint(target, setup.id, made)}`,
  ]);
  const heads = Buffer.byteLength(top) * normalised.files.length;
  const texts = formatProgram(normalised, post, {
    ...formatOptions(machine),
    maxBytes: Math.max(room - heads, 0),
  });
  const files = texts.map((text) => top + text);
  const offsetIndex = job.setup.wcs.offsetIndex;
  const emitted = files.flatMap((text, i) =>
    emittedProblems(text, post, expected(normalised, i, offsetIndex)).map(
      (reason) => check("dialect", `file ${i + 1}, ${reason}`),
    ),
  );
  return emitted.length ? { blocked: emitted } : { files };
}

const safe = (name: string) =>
  name.replace(/[^\w .-]/g, "_").trim() || "program";

function unique(stem: string, used: Set<string>) {
  let name = stem;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${stem}-${n}`;
  used.add(name.toLowerCase());
  return name;
}

function named(setup: Setup, texts: string[], post: Post, used: Set<string>) {
  const base = safe(setup.name ?? setup.id);
  return texts.map((text, i): File => {
    const stem = texts.length > 1 ? `${base}-${i + 1}` : base;
    return { name: `${unique(stem, used)}.${post.extension}`, text };
  });
}

function nothing(setups: Setup[]) {
  return setups.some((setup) => setup.operations?.length)
    ? "Nothing to export: every operation is suppressed"
    : "Nothing to export: the chosen setups have no operations";
}

function chosenSetups(data: CamData, setupIds: string): Setup[] | string {
  const ids = setupIds.split(",");
  if (ids.length > data.setups.length)
    return `${ids.length} setups were asked for; this project has ${data.setups.length}`;
  const setups: Setup[] = [];
  for (const id of ids) {
    const setup = data.setups.find((each) => each.id === id);
    if (!setup) return `setup ${id} is not in this project`;
    if (setups.includes(setup)) return `setup ${id} is asked for twice`;
    setups.push(setup);
  }
  return setups;
}

function reply(files: File[], title: string, setups: Setup[]): NcExport {
  const [only] = files;
  if (!only) return { reason: nothing(setups) };
  if (files.length === 1) return { fileName: only.name, nc: only.text };
  const zip = zipSync(
    Object.fromEntries(files.map(({ name, text }) => [name, strToU8(text)])),
  );
  return {
    fileName: `${safe(title)}.zip`,
    zip: Buffer.from(zip).toString("base64"),
  };
}

const postOf = (setup: Setup, postId: string) =>
  POSTS.get(postId) ??
  (postId.startsWith(USER_POST_PREFIX) && setup.post?.id === postId
    ? copiedPost(setup.post as PostCopy)
    : undefined);

const machineOf = (
  setup: Setup,
  machineId: string,
  library: MachineProfile | undefined,
): MachineProfile | undefined => {
  if (setup.machine?.id !== machineId) return library;
  const { libraryRef: _ref, ...machine } = setup.machine;
  return machine;
};

async function targetOf(
  context: Pick<ServerContext, "userData" | "kernelVersion">,
  user: User,
  params: { machineId: string; toolChange: string },
  setups: Setup[],
): Promise<Map<Setup, Omit<Target, "post">> | string> {
  const { machineId, toolChange } = params;
  const machines = context.userData("machines", 1);
  const library = await libraryItem(machines, user, machineId, machineSchema);
  const chosen = setups.map((setup) => machineOf(setup, machineId, library));
  const lost = setups[chosen.indexOf(undefined)];
  if (lost)
    return `${lost.name ?? lost.id}: machine ${machineId} is not in your library`;
  if (!Value.Check(machineSchema.properties.toolChange, toolChange))
    return `tool change ${toolChange} is not perFile or m6`;
  const kernel = context.kernelVersion;
  const common = {
    toolChange: toolChange === "m6",
    kernel: kernel ? `OCCT ${kernel.occt} ${kernel.commit}` : "unknown",
  };
  return new Map(
    setups.map((setup, i) => [setup, { ...common, machine: chosen[i]! }]),
  );
}

export function mountExport(
  api: RouteModuleApi,
  context: Pick<ServerContext, "bodies" | "userData" | "kernelVersion">,
  cache: ProgramCache,
  maxBytes = EXPORT_MAX_BYTES,
) {
  api.projectRoute(ncRoute, async (doc, { params }, { user }) => {
    const data = cam(doc);
    const setups = chosenSetups(data, params.setupIds);
    if (typeof setups === "string") return { reason: setups };
    const targets = await targetOf(context, user, params, setups);
    if (typeof targets === "string") return { reason: targets };
    const posts = new Map(setups.map((s) => [s, postOf(s, params.postId)]));
    if ([...posts.values()].includes(undefined))
      return { reason: `post ${params.postId} is not installed` };
    const model = await readModel(context, params.id, user);
    const gathered = [];
    for (const setup of setups)
      gathered.push({ setup, ...(await gather(model, data, setup, cache)) });
    const blocked = gathered.flatMap((each) => each.blocked);
    if (blocked.length) return { blocked };
    const files: File[] = [];
    const used = new Set<string>();
    let room = maxBytes;
    for (const { setup, made } of gathered) {
      if (!made.length) continue;
      const target = { ...targets.get(setup)!, post: posts.get(setup)! };
      const out = await posted(model, data, setup, made, target, room).catch(
        (error: unknown): Posted => ({
          blocked: [
            {
              kind: "check",
              setupId: setup.id,
              rule: "post",
              reason: error instanceof Error ? error.message : String(error),
            },
          ],
        }),
      );
      if ("blocked" in out) {
        blocked.push(...out.blocked);
        continue;
      }
      files.push(...named(setup, out.files, target.post, used));
      room -= Buffer.byteLength(out.files.join(""));
    }
    return blocked.length ? { blocked } : reply(files, doc.name, setups);
  });
}
