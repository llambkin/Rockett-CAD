import type {
  CadDocument,
  NamingCandidate,
  NamingDecision,
  NamingMapping,
  NamingMesh,
  NamingUpgradeProposal,
  NamingVersion,
  MeshedBody,
} from "@rockett/shared";
import type { KernelClient } from "../kernel/client.js";
import { backupNamespace } from "./jsonStore.js";
import { StoreError, type ProjectStore } from "./projectStore.js";
import { remapViews } from "./viewStore.js";

type Planner = Pick<KernelClient, "planNamingUpgrade">;
type Stager = Pick<KernelClient, "planNamingUpgrade" | "evaluate" | "drop">;

const BACKUP = "naming1";

function backupOf(store: ProjectStore, id: string) {
  return backupNamespace(
    store.documents.options.storage,
    store.documents.dir(id),
  );
}

async function staged(
  store: ProjectStore,
  kernel: Planner,
  doc: CadDocument,
  accept: NamingDecision[] = [],
) {
  if (doc.namingVersion !== 1)
    throw new StoreError(
      `project ${doc.id} already uses naming version ${doc.namingVersion}`,
      "conflict",
    );
  const backup = await backupOf(store, doc.id).backup(BACKUP);
  return { backup, ...(await kernel.planNamingUpgrade(doc, accept)) };
}

function meshOf(
  bodies: MeshedBody[],
  { bodyId, name }: NamingCandidate,
): NamingMesh | undefined {
  const body = bodies.find((b) => b.bodyId === bodyId);
  if (!body) return undefined;
  const { bbox } = body;
  if (name === undefined)
    return { kind: "body", bbox, start: 0, count: body.indices.length };
  const face = body.faces.find((f) => f.name === name);
  if (face) return { kind: "face", bbox, start: face.start, count: face.count };
  const edge = body.edges.find((e) => e.name === name);
  return edge && { kind: "edge", bbox, polyline: edge.polyline };
}

async function withMeshes(
  store: ProjectStore,
  kernel: Stager,
  upgraded: CadDocument,
  mappings: NamingMapping[],
): Promise<NamingMapping[]> {
  const scratch = { ...upgraded, id: `${upgraded.id}~mesh` };
  const sources = await store.sources(upgraded);
  const states = new Map<string | null, MeshedBody[]>();
  const bodiesAt = async (featureId: string | null) => {
    const known = states.get(featureId);
    if (known) return known;
    const position =
      featureId === null
        ? undefined
        : upgraded.features.findIndex((f) => f.id === featureId);
    const { bodies } = await kernel.evaluate(scratch, position, sources);
    states.set(featureId, bodies);
    return bodies;
  };
  try {
    const out: NamingMapping[] = [];
    for (const m of mappings) {
      if (!m.candidates.length && !m.suggestions.length) {
        out.push(m);
        continue;
      }
      const bodies = await bodiesAt(m.featureId);
      const meshed = (c: NamingCandidate): NamingCandidate => {
        const mesh = meshOf(bodies, c);
        return mesh ? { ...c, mesh } : c;
      };
      out.push({
        ...m,
        candidates: m.candidates.map(meshed),
        suggestions: m.suggestions.map(meshed),
      });
    }
    return out;
  } finally {
    kernel.drop(scratch.id);
  }
}

export async function stageNamingUpgrade(
  store: ProjectStore,
  kernel: Stager,
  doc: CadDocument,
  accept?: NamingDecision[],
): Promise<NamingUpgradeProposal> {
  const { backup, document, mappings, failures } = await staged(
    store,
    kernel,
    doc,
    accept,
  );
  return {
    backup,
    revision: doc.revision,
    mappings: await withMeshes(store, kernel, document, mappings),
    failures,
  };
}

export function upgradeViews(
  store: ProjectStore,
  id: string,
  mappings: NamingMapping[],
): Promise<void> {
  const moved = new Map(
    mappings.flatMap(({ featureId, from, to }) =>
      featureId === null && to ? [[from.bodyId, to.bodyId] as const] : [],
    ),
  );
  return remapViews(store.documents.options.storage, id, moved);
}

export async function acceptedNamingUpgrade(
  store: ProjectStore,
  kernel: Planner,
  doc: CadDocument,
  accept?: NamingDecision[],
) {
  const { failures, ...plan } = await staged(store, kernel, doc, accept);
  const open = plan.mappings.filter((m) => !m.to && m.status !== "missing");
  if (open.length)
    throw new StoreError(
      `${open.length} references have no proven mapping; accept one for each before the upgrade`,
      "conflict",
    );
  const failed = (version: NamingVersion) =>
    new Set(
      failures
        .filter((f) => f.namingVersion === version)
        .map((f) => f.featureId),
    );
  const [before, after] = [failed(1), failed(2)];
  const broken = doc.features.filter(
    ({ id }) => after.has(id) && !before.has(id),
  );
  if (broken.length)
    throw new StoreError(
      `${broken.map((f) => f.name).join(", ")} would fail under naming version 2; the project stays on version 1`,
      "unprocessable",
    );
  return plan;
}
