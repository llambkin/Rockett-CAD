import { Type, type Static } from "typebox";
import type { HistoryStatus } from "./api.js";
import type { route as defineRoute } from "./routes.js";
import { featureNameSchema } from "./schema/coreFeatures.js";
import { documentSchema } from "./schema/documents.js";
import { featureIdSchema } from "./schema/refs.js";
import { parse, ValidationError } from "./schema/validation.js";
import { placementSchema } from "./placement.js";

export const ASSEMBLY_SCHEMA_VERSION = 1;

const { revision, savedWith, extensions } = documentSchema.properties;
const id = featureIdSchema;
const documentId = featureIdSchema;

const componentRefSchema = Type.Object({
  documentId,
  acknowledgedRevision: revision,
});

const instanceFields = {
  name: featureNameSchema,
  placement: placementSchema,
  grounded: Type.Boolean(),
};

const instanceSchema = Type.Object({ id, documentId, ...instanceFields });

const assemblySchema = Type.Object({
  schemaVersion: Type.Literal(ASSEMBLY_SCHEMA_VERSION),
  revision,
  savedWith,
  id,
  components: Type.Array(componentRefSchema),
  instances: Type.Array(instanceSchema),
  joints: Type.Tuple([]),
  extensions,
});

export type Instance = Static<typeof instanceSchema>;
export type AssemblyDocument = Static<typeof assemblySchema>;
type InstanceInput = Omit<Instance, "id">;
type InstanceEdit = Partial<Omit<InstanceInput, "documentId">>;

interface AssemblyResponse {
  document: AssemblyDocument;
  history: HistoryStatus;
}

const strict = { additionalProperties: false } as const;

export function assemblyRoutes(route: typeof defineRoute) {
  return {
    createAssembly: route<never, AssemblyResponse>()(
      "POST",
      "/projects/:id/assemblies",
    ),
    getAssembly: route<never, AssemblyResponse>()(
      "GET",
      "/projects/:id/assemblies/:doc",
    ),
    addInstance: route<{ instance: InstanceInput }, AssemblyResponse>()(
      "POST",
      "/projects/:id/assemblies/:doc/instances",
      Type.Object(
        { instance: Type.Object({ documentId, ...instanceFields }, strict) },
        strict,
      ),
      "document",
    ),
    updateInstance: route<{ instance: InstanceEdit }, AssemblyResponse>()(
      "PATCH",
      "/projects/:id/assemblies/:doc/instances/:instance",
      Type.Object(
        { instance: Type.Partial(Type.Object(instanceFields, strict)) },
        strict,
      ),
      "document",
    ),
    removeInstance: route<never, AssemblyResponse>()(
      "DELETE",
      "/projects/:id/assemblies/:doc/instances/:instance",
      undefined,
      "document",
    ),
    undoAssembly: route<never, AssemblyResponse>()(
      "POST",
      "/projects/:id/assemblies/:doc/undo",
      undefined,
      "document",
    ),
    redoAssembly: route<never, AssemblyResponse>()(
      "POST",
      "/projects/:id/assemblies/:doc/redo",
      undefined,
      "document",
    ),
  };
}

const reject = (path: string, message: string): never => {
  throw new ValidationError(
    `assembly${path.replaceAll("/", ".")} ${message}`,
    path,
  );
};

export function validateAssembly(value: unknown): AssemblyDocument {
  const doc = parse(assemblySchema, value, "assembly");
  const listed = new Set<string>();
  doc.components.forEach((component, i) => {
    const path = `/components/${i}/documentId`;
    if (component.documentId === doc.id)
      reject(path, "references the assembly itself");
    if (listed.has(component.documentId))
      reject(path, `repeats component ${component.documentId}`);
    listed.add(component.documentId);
  });
  const ids = new Set<string>();
  doc.instances.forEach((instance, i) => {
    if (ids.has(instance.id))
      reject(`/instances/${i}/id`, `repeats instance id ${instance.id}`);
    ids.add(instance.id);
    if (!listed.has(instance.documentId))
      reject(
        `/instances/${i}/documentId`,
        `names unlisted component ${instance.documentId}`,
      );
  });
  return doc;
}
