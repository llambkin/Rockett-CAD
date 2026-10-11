import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import type {
  Route,
  RouteModuleApi,
  ServerContext,
  User,
  UserData,
} from "@rockett/plugin-api";
import type { Post } from "../post/schema.js";
import {
  CAM_EXTENSION,
  CAM_VERSION,
  entry,
  migrateCam,
  storedPostProblem,
} from "../shared/document.js";
import {
  machineSchema,
  validateMachine,
  type MachineProfile,
} from "../shared/machine.js";
import {
  storedPresetSchema,
  toolSchema,
  validatePreset,
  validateTool,
  type Preset,
  type Tool,
} from "../shared/tools.js";
import { refusal } from "./generate.js";
import { userPost, userPostText } from "./posts.js";

const useTool: Route<
  "/projects/:id/m/rockett/cam/tools",
  Static<typeof entry>
> & { readonly body: typeof entry } = {
  method: "POST",
  path: "/projects/:id/m/rockett/cam/tools",
  body: entry,
  effect: "document",
};

const etagOrNull = Type.Union([Type.String(), Type.Null()]);

const addPost: Route<
  "/m/rockett/cam/posts",
  { post: string; etag: string | null }
> & { readonly body: TSchema } = {
  method: "POST",
  path: "/m/rockett/cam/posts",
  body: Type.Object({ post: userPostText, etag: etagOrNull }),
};

function mountPosts(api: RouteModuleApi, store: UserData) {
  list<Post>(api, store, "post", entry, (post) =>
    [storedPostProblem(post)].filter(Boolean),
  );
  api.userRoute(addPost, async (req, { user }) => {
    const post = userPost(JSON.parse(req.body.post));
    const stored = (await store.read(user))?.data;
    const kept = Array.isArray(stored)
      ? stored.filter((item) => item?.id !== post.id)
      : [];
    return store.write(user, [...kept, post], req.body.etag);
  });
}

function list<T extends { id: string }>(
  api: RouteModuleApi,
  store: UserData,
  noun: string,
  item: TSchema,
  problems: (item: T) => string[],
) {
  const path = `/m/rockett/cam/${noun}s`;
  const save: Route<string, { data: T[]; etag: string | null }> & {
    readonly body: TSchema;
  } = {
    method: "PUT",
    path,
    body: Type.Object({
      data: Type.Array(item),
      etag: etagOrNull,
    }),
  };
  api.userRoute({ method: "GET", path }, (_req, { user }) => store.read(user));
  api.userRoute(save, async (req, { user }) => {
    const { data, etag } = req.body;
    const ids = new Set<string>();
    for (const value of data) {
      if (ids.has(value.id)) throw refusal(`${noun}s has ${value.id} twice`);
      ids.add(value.id);
      const [problem] = problems(value);
      if (problem) throw refusal(`${noun} ${value.id}: ${problem}`);
    }
    return store.write(user, data, etag);
  });
}

export async function libraryItem<T extends TSchema>(
  store: UserData,
  user: User,
  id: string,
  schema: T,
): Promise<Static<T> | undefined> {
  const stored = (await store.read(user))?.data;
  const item: unknown = Array.isArray(stored)
    ? stored.find((value) => value?.id === id)
    : undefined;
  return Value.Check(schema, item) ? item : undefined;
}

export function mountLibrary(
  api: RouteModuleApi,
  userData: ServerContext["userData"],
) {
  const tools = userData("tools", 1);
  list<Tool>(api, tools, "tool", toolSchema, validateTool);
  list<Preset>(
    api,
    userData("presets", 1),
    "preset",
    storedPresetSchema,
    validatePreset,
  );
  list<MachineProfile>(
    api,
    userData("machines", 1),
    "machine",
    machineSchema,
    validateMachine,
  );
  mountPosts(api, userData("posts", 1));
  api.projectMutation(useTool, async (doc, req, { user }) => {
    const cam = migrateCam(doc.extensions[CAM_EXTENSION]);
    if (cam.status === "kept") throw refusal(cam.reason);
    const { id } = req.body;
    const tool = await libraryItem(tools, user, id, toolSchema);
    if (!tool) throw refusal(`tool ${id} is not in your library`);
    cam.data.tools.push({
      ...tool,
      id: crypto.randomUUID(),
      libraryRef: { id },
    });
    doc.extensions[CAM_EXTENSION] = { version: CAM_VERSION, data: cam.data };
    return { label: `Use tool ${tool.name}` };
  });
}
