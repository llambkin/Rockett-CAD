import type { ServerContext } from "@rockett/plugin-api";
import {
  Placement,
  resolveDocumentParameters,
  type CadDocument,
  type FeatureStatus,
  type User,
} from "@rockett/shared";
import { projectAccess } from "../api/projectAccess.js";
import {
  bodyDependencies,
  bodyFingerprint,
  type BodyInputs,
} from "../geometry/fingerprint.js";
import type { KernelClient } from "../kernel/client.js";
import type { FolderStore } from "../store/folderStore.js";
import { StoreError, type ProjectStore } from "../store/projectStore.js";

export type BodyKernel = Pick<
  KernelClient,
  "evaluate" | "stateQuery" | "version"
>;

const problem = (status: FeatureStatus) =>
  status.status === "error" ||
  status.status === "cancelled" ||
  (status.refs?.length ?? 0) > 0;

async function canView(
  store: ProjectStore,
  folders: FolderStore,
  user: User,
  projectId: string,
) {
  try {
    return (await projectAccess(store, folders, user, projectId)) !== undefined;
  } catch (error) {
    if (error instanceof StoreError && error.code === "not_found") return false;
    throw error;
  }
}

export async function finalModel(
  store: ProjectStore,
  folders: FolderStore,
  user: User,
  projectId: string,
): Promise<CadDocument> {
  if (!(await canView(store, folders, user, projectId)))
    throw new StoreError("project not found", "not_found");
  const doc = await store.load(projectId);
  return { ...doc, timelinePosition: doc.features.length };
}

export function moduleBodies(
  kernel: BodyKernel,
  store: ProjectStore,
  folders: FolderStore,
): ServerContext["bodies"] {
  return async (projectId, user) => {
    const doc = await finalModel(store, folders, user, projectId);
    const evaluation = await kernel.evaluate(doc);
    const { bodies, featureStatuses } = evaluation;
    if (bodies.length === 0) return [];
    const breps = await kernel.stateQuery(doc, {
      kind: "brep",
      bodyIds: bodies.map((body) => body.bodyId),
    });
    const sources = await store.sources(doc);
    const resolved = {
      ...doc,
      features: resolveDocumentParameters(doc).features,
    };
    const statusOf = new Map(featureStatuses.map((s) => [s.featureId, s]));
    return bodies.map(({ bodyId, name, reference, bbox }, i) => {
      const inputs: BodyInputs = {
        doc: resolved,
        bodyId,
        sources,
        placement: Placement.identity(),
        selection: [],
        camVersion: "",
        kernel: kernel.version(),
        evaluation,
      };
      const features = bodyDependencies(inputs);
      const problems = features.flatMap((f) => {
        const status = statusOf.get(f.id);
        return status && problem(status) ? [status] : [];
      });
      return {
        id: bodyId,
        name,
        ...(reference && { reference }),
        bbox,
        brep: breps[i]!.brep,
        faceNames: breps[i]!.faceNames,
        fingerprint: bodyFingerprint(inputs, features),
        problems,
      };
    });
  };
}
