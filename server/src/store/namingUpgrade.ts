import type {
  CadDocument,
  NamingDecision,
  NamingUpgradeProposal,
} from "@rockett/shared";
import type { KernelClient } from "../kernel/client.js";
import { backupNamespace } from "./jsonStore.js";
import { StoreError, type ProjectStore } from "./projectStore.js";

type Planner = Pick<KernelClient, "planNamingUpgrade">;

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

export async function stageNamingUpgrade(
  store: ProjectStore,
  kernel: Planner,
  doc: CadDocument,
  accept?: NamingDecision[],
): Promise<NamingUpgradeProposal> {
  const { backup, mappings } = await staged(store, kernel, doc, accept);
  return { backup, revision: doc.revision, mappings };
}

export async function acceptedNamingUpgrade(
  store: ProjectStore,
  kernel: Planner,
  doc: CadDocument,
  accept?: NamingDecision[],
) {
  const plan = await staged(store, kernel, doc, accept);
  const open = plan.mappings.filter((m) => !m.to && m.status !== "missing");
  if (open.length)
    throw new StoreError(
      `${open.length} references have no proven mapping; accept one for each before the upgrade`,
      "conflict",
    );
  return plan;
}
