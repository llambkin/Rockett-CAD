import path from "node:path";
import {
  ASSEMBLY_SCHEMA_VERSION,
  StoreError,
  ValidationError,
  validateAssembly,
  type AssemblyDocument,
  type CadDocument,
} from "@rockett/shared";
import { build } from "../build.js";
import { HistoryStore } from "../store/historyStore.js";
import { newId, type Write } from "../store/jsonStore.js";
import { ID_RE } from "../store/manifestStore.js";
import { assemblyMigrations, migrate } from "../store/migrations.js";
import { ProjectQueue } from "../store/projectQueue.js";
import type { ProjectStore } from "../store/projectStore.js";

type Part = Pick<CadDocument, "id" | "revision">;

function readAssembly(value: unknown): AssemblyDocument {
  try {
    return validateAssembly(migrate(assemblyMigrations, value));
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError((err as Error).message);
  }
}

export function fileAssemblies(
  values: unknown[],
  part: string,
): AssemblyDocument[] {
  const ids = new Set([part]);
  return values.map((value, i) => {
    const at = `assemblies.${i}`;
    let doc: AssemblyDocument;
    try {
      doc = readAssembly(value);
    } catch (err) {
      const { message, detail = "" } = err as ValidationError;
      throw new ValidationError(
        `${at}: ${message}`,
        `/assemblies/${i}${detail}`,
      );
    }
    if (ids.has(doc.id) || !ID_RE.test(doc.id))
      throw new ValidationError(
        `${at}.id ${doc.id} repeats a document id or is not a document id`,
        `/assemblies/${i}/id`,
      );
    ids.add(doc.id);
    doc.components.forEach(({ documentId }, j) => {
      if (documentId !== part)
        throw new ValidationError(
          `${at}.components.${j}.documentId names ${documentId}, not this file's part`,
          `/assemblies/${i}/components/${j}/documentId`,
        );
    });
    return doc;
  });
}

export function rehome(
  docs: AssemblyDocument[],
  from: Part,
  to: Part,
): AssemblyDocument[] {
  const moved = (documentId: string) =>
    documentId === from.id ? to.id : documentId;
  return docs.map((doc) => ({
    ...doc,
    components: doc.components.map(({ documentId, acknowledgedRevision }) => ({
      documentId: moved(documentId),
      acknowledgedRevision:
        acknowledgedRevision === from.revision ? to.revision : 0,
    })),
    instances: doc.instances.map((instance) => ({
      ...instance,
      documentId: moved(instance.documentId),
    })),
  }));
}

export class AssemblyStore {
  private readonly queue = new ProjectQueue();

  constructor(private readonly store: ProjectStore) {}

  private get storage() {
    return this.store.documents.options.storage;
  }

  private dir(projectId: string, documentId: string): string {
    if (!ID_RE.test(documentId))
      throw new StoreError(`assembly ${documentId} not found`, "not_found");
    return path.posix.join(
      this.store.documents.dir(projectId),
      "documents",
      documentId,
    );
  }

  private file(projectId: string, documentId: string): string {
    return `${this.dir(projectId, documentId)}.json`;
  }

  private async revision(file: string): Promise<number> {
    const data = await this.storage.read(file).catch(() => undefined);
    if (!data) return 0;
    const { revision } = JSON.parse(data.toString("utf8")) as {
      revision?: unknown;
    };
    return typeof revision === "number" ? revision : 0;
  }

  async load(projectId: string, documentId: string): Promise<AssemblyDocument> {
    const { documents } = await this.store.manifests.read(projectId);
    if (!documents.some((d) => d.id === documentId && d.type === "assembly"))
      throw new StoreError(`assembly ${documentId} not found`, "not_found");
    try {
      const data = await this.storage.read(this.file(projectId, documentId));
      return readAssembly(JSON.parse(data.toString("utf8")));
    } catch (err) {
      throw new StoreError(
        `assembly ${documentId} is invalid: ${(err as Error).message}`,
        "unprocessable",
      );
    }
  }

  async all(projectId: string): Promise<AssemblyDocument[]> {
    const { documents } = await this.store.manifests.read(projectId);
    const out: AssemblyDocument[] = [];
    for (const { id, type } of documents)
      if (type === "assembly") out.push(await this.load(projectId, id));
    return out;
  }

  save(
    projectId: string,
    doc: AssemblyDocument,
    write?: Write<AssemblyDocument>,
  ): Promise<void> {
    validateAssembly(doc);
    const file = this.file(projectId, doc.id);
    return this.queue.run(`${projectId}/${doc.id}`, async () => {
      const snapshot = {
        ...doc,
        revision: (await this.revision(file)) + 1,
        savedWith: build(),
      };
      const text = JSON.stringify(snapshot, null, 1);
      await (write
        ? write(file, text, snapshot)
        : this.storage.writeAtomic(file, text));
      doc.revision = snapshot.revision;
      doc.savedWith = snapshot.savedWith;
    });
  }

  async create(projectId: string): Promise<AssemblyDocument> {
    const doc: AssemblyDocument = {
      schemaVersion: ASSEMBLY_SCHEMA_VERSION,
      revision: 0,
      savedWith: null,
      id: newId(),
      components: [],
      instances: [],
      joints: [],
      extensions: {},
    };
    await this.adopt(projectId, [doc]);
    return doc;
  }

  async adopt(projectId: string, docs: AssemblyDocument[]): Promise<void> {
    if (!docs.length) return;
    for (const doc of docs) await this.save(projectId, doc);
    await this.store.manifests.update(projectId, (manifest) => ({
      ...manifest,
      documents: [
        ...manifest.documents,
        ...docs.map(({ id }) => ({ id, type: "assembly" as const })),
      ],
    }));
  }

  async copy(fromId: string, to: Part): Promise<void> {
    const from = await this.store.load(fromId);
    await this.adopt(to.id, rehome(await this.all(fromId), from, to));
  }

  history(projectId: string): HistoryStore<AssemblyDocument> {
    return new HistoryStore<AssemblyDocument>(this.storage, {
      save: (doc, _actor, write) => this.save(projectId, doc, write),
      exclusive: (id, operation) =>
        this.queue.run(`${projectId}/${id}`, operation),
      isTemporary: () => this.store.isTemporary(projectId),
      historyDir: (id) => this.dir(projectId, id),
      storedRevision: (id) => this.revision(this.file(projectId, id)),
      restored: (stored) => readAssembly(stored),
    });
  }
}
