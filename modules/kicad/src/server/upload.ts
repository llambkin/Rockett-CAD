import {
  StoreError,
  type CadDocument,
  type ProjectMutationContext,
  type ProjectRouteContext,
  type Route,
  type RouteRequest,
  type RouteModule,
} from "@rockett/plugin-api";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { readBoard } from "../board.js";
import { diffBoards } from "../diff.js";
import { child, parseSexpr, SEXPR_LIMITS, str } from "../sexpr.js";
import {
  dataSchema,
  linkAssets,
  MODEL_NAME_LENGTH,
  NAMESPACE,
  READ_VERSIONS,
  SNAPSHOT_VERSION,
  snapshotSchema,
  VERSION,
  type Link,
} from "../shared/data.js";
import { modelName, resolveModel } from "../shared/models.js";

const encoded = Type.String({
  maxLength: Math.ceil(SEXPR_LIMITS.bytes / 3) * 4,
});
const body = Type.Object(
  { source: encoded, linkId: Type.Optional(Type.String({ maxLength: 128 })) },
  { additionalProperties: false },
);
const modelBody = Type.Object(
  { name: Type.String({ maxLength: MODEL_NAME_LENGTH }), source: encoded },
  { additionalProperties: false },
);
export const uploadRoute: Route<
  "/projects/:id/m/rockett/kicad/upload",
  Static<typeof body>
> & { readonly body: typeof body } = {
  method: "POST",
  path: "/projects/:id/m/rockett/kicad/upload",
  body,
  effect: "document",
};

export const modelUploadRoute: Route<
  "/projects/:id/m/rockett/kicad/models/:linkId",
  Static<typeof modelBody>
> & { readonly body: typeof modelBody } = {
  method: "POST",
  path: "/projects/:id/m/rockett/kicad/models/:linkId",
  body: modelBody,
  effect: "document",
};

export const modelListRoute: Route<"/projects/:id/m/rockett/kicad/models/:linkId"> =
  {
    method: "GET",
    path: "/projects/:id/m/rockett/kicad/models/:linkId",
  };

export function storedData(doc: CadDocument) {
  const stored = doc.extensions[NAMESPACE];
  if (stored === undefined) return { links: {} };
  if (
    !READ_VERSIONS.includes(stored.version) ||
    !Value.Check(dataSchema, stored.data)
  )
    throw new StoreError(
      `KiCad data version ${stored.version} is not supported or valid; saved data was kept`,
    );
  if (
    Object.values(stored.data.links).some(
      (link) => link.sha256 !== link.sourceAsset,
    )
  )
    throw new StoreError(
      "KiCad data has inconsistent source hashes; saved data was kept",
    );
  return stored.data;
}

export function sourceTree(bytes: Uint8Array) {
  if (bytes.byteLength > SEXPR_LIMITS.bytes)
    throw new Error("Board input is too large");
  return parseSexpr(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function decoded(source: string) {
  const binary = atob(source);
  if (btoa(binary) !== source)
    throw new Error("Source must be canonical base64");
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function refusing<T>(read: () => T, what: string): T {
  try {
    return read();
  } catch (error) {
    throw new StoreError(error instanceof Error ? error.message : what);
  }
}

function uploaded(source: string) {
  return refusing(() => {
    const bytes = decoded(source);
    const tree = sourceTree(bytes);
    const data = readBoard(tree);
    const metadata: { generator?: string; generatorVersion?: string } = {};
    for (const [field, key] of [
      ["generator", "generator"],
      ["generator_version", "generatorVersion"],
    ] as const) {
      const entry = child(tree, field);
      if (!entry) continue;
      const value = str(entry);
      if (value === undefined) throw new Error(`Invalid board ${field}`);
      metadata[key] = value;
    }
    return {
      bytes,
      data,
      metadata,
      snapshot: new TextEncoder().encode(
        JSON.stringify({ version: SNAPSHOT_VERSION, data }),
      ),
    };
  }, "Invalid KiCad board");
}

async function hash(bytes: Uint8Array<ArrayBuffer>) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function keep(
  doc: CadDocument,
  links: Record<string, Link>,
  ctx: ProjectMutationContext,
  added: Uint8Array<ArrayBuffer>[],
) {
  const hashes = await Promise.all(added.map(hash));
  const previous = new Set([
    ...(doc.moduleAssets?.namespaces[NAMESPACE] ?? []),
    ...Object.values(links).flatMap(linkAssets),
  ]);
  ctx.assets.set([...new Set([...previous, ...hashes])]);
  for (const reference of previous) await ctx.blobs.get(reference);
  const ordered = added.toSorted((a, b) => b.byteLength - a.byteLength);
  for (const bytes of ordered) await ctx.blobs.put(bytes);
  return hashes;
}

export function linkOf(doc: CadDocument, linkId: string) {
  const stored = storedData(doc);
  const link = Object.hasOwn(stored.links, linkId)
    ? stored.links[linkId]
    : undefined;
  if (!link)
    throw new StoreError(
      "KiCad board link is not in this project",
      "unprocessable",
    );
  return { stored, link };
}

async function snapshotOf(link: Link, ctx: ProjectRouteContext) {
  const snapshot: unknown = JSON.parse(
    new TextDecoder().decode(await ctx.blobs.get(link.snapshotAsset)),
  );
  if (!Value.Check(snapshotSchema, snapshot))
    throw new StoreError(
      "KiCad board snapshot is not supported or valid",
      "unprocessable",
    );
  return snapshot.data;
}

async function uploadBoard(
  doc: CadDocument,
  req: RouteRequest<typeof uploadRoute>,
  ctx: ProjectMutationContext,
) {
  const { source, linkId: target } = req.body;
  const stored = storedData(doc);
  const previous = target === undefined ? undefined : linkOf(doc, target).link;
  const before = previous && (await snapshotOf(previous, ctx));
  const {
    generator: _generator,
    generatorVersion: _version,
    ...kept
  } = previous ?? {};
  const board = uploaded(source);
  const [sourceAsset, snapshotAsset] = await keep(doc, stored.links, ctx, [
    board.bytes,
    board.snapshot,
  ]);
  const linkId = target ?? crypto.randomUUID();
  const link = {
    outlineOwner: "kicad",
    ...kept,
    sourceKind: "upload",
    sourceAsset,
    sha256: sourceAsset,
    formatVersion: board.data.formatVersion,
    ...board.metadata,
    snapshotAsset,
  };
  doc.extensions[NAMESPACE] = {
    ...doc.extensions[NAMESPACE],
    version: VERSION,
    data: { ...stored, links: { ...stored.links, [linkId]: link } },
  };
  if (!before) return { label: "Upload KiCad board", linkId };
  return {
    label: "Update KiCad board",
    linkId,
    diff: diffBoards(before, board.data),
  };
}

async function listModels(
  doc: CadDocument,
  req: RouteRequest<typeof modelListRoute>,
  ctx: ProjectRouteContext,
) {
  const { link } = linkOf(doc, req.params.linkId);
  return {
    models: (await snapshotOf(link, ctx)).footprints.flatMap(
      ({ uuid, reference, models }) =>
        models.map((model) => ({
          footprintUuid: uuid,
          reference,
          ...resolveModel(model, link.models),
        })),
    ),
  };
}

async function uploadModel(
  doc: CadDocument,
  req: RouteRequest<typeof modelUploadRoute>,
  ctx: ProjectMutationContext,
) {
  const { linkId } = req.params;
  const { stored, link } = linkOf(doc, linkId);
  const { name } = req.body;
  refusing(() => modelName(name), "Invalid KiCad model name");
  const referenced = (await snapshotOf(link, ctx)).footprints.some(
    ({ models }) =>
      models.some((model) => {
        const use = resolveModel(model);
        return use.status !== "refused" && use.name === name;
      }),
  );
  if (!referenced)
    throw new StoreError(`No footprint on this board references ${name}`);
  const bytes = refusing(() => {
    const read = decoded(req.body.source);
    if (
      !/^\s*ISO-10303-21;/.test(new TextDecoder().decode(read.subarray(0, 64)))
    )
      throw new Error("KiCad model is not a STEP file");
    return read;
  }, "Invalid KiCad model");
  const [sha256] = await keep(doc, stored.links, ctx, [bytes]);
  const models = { ...link.models, [name]: sha256 };
  doc.extensions[NAMESPACE] = {
    ...doc.extensions[NAMESPACE],
    version: VERSION,
    data: {
      ...stored,
      links: { ...stored.links, [linkId]: { ...link, models } },
    },
  };
  return { label: "Upload KiCad model", name, sha256 };
}

export const uploadModule: RouteModule = {
  id: "rockett.kicad.upload",
  mount(api) {
    api.projectMutation(uploadRoute, uploadBoard);
    api.projectRoute(modelListRoute, listModels);
    api.projectMutation(modelUploadRoute, uploadModel);
  },
};
