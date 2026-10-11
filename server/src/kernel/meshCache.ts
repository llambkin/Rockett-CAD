import { promises } from "node:fs";
import {
  coarseOf,
  meshBinary,
  type BodyPayload,
  type EvaluateResult,
  type MeshedBody,
  type MeshedEvaluation,
} from "@rockett/shared";
import { sha256 } from "../store/jsonStore.js";
import { LocalStorage } from "../store/storage.js";

const MESH_LIMITS = {
  bytes: 256 * 1024 * 1024,
  disk: 1024 * 1024 * 1024,
  projects: 4096,
  indexed: 65536,
  recent: 4096,
};

type Entry = { hash: string; data: Buffer };

const levelOf = ({ hash, data }: Entry) => ({ hash, bytes: data.length });

type Project = { revision?: number; hashes: Set<string>; recent: Set<string> };

const CACHE_FILE = /^[0-9a-f]{64}\.rkm(\.[0-9a-f-]+\.tmp)?$/;

const reported = (error: unknown) =>
  console.error(`[rockett] mesh disk cache: ${String(error)}`);

class MeshDisk {
  private readonly storage: LocalStorage;
  private readonly files = new Map<string, number>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly ready: Promise<unknown>;
  private size = 0;
  private freeing = 0;
  private off = false;

  constructor(
    dir: string,
    private readonly limit: number,
  ) {
    this.storage = new LocalStorage(dir, promises);
    this.ready = this.storage
      .list("")
      .then((names) =>
        Promise.all(
          names
            .filter((name) => CACHE_FILE.test(name))
            .map((name) => this.storage.remove(name)),
        ),
      )
      .catch((error) => this.disable(error));
  }

  private disable(error: unknown) {
    if (!this.off) reported(error);
    this.off = true;
  }

  private queue<T>(hash: string, work: (file: string) => Promise<T>) {
    const run = (this.pending.get(hash) ?? this.ready).then(() =>
      work(`${hash}.rkm`),
    );
    const settled = run.catch(() => undefined);
    this.pending.set(hash, settled);
    void settled.then(() => {
      if (this.pending.get(hash) === settled) this.pending.delete(hash);
    });
    return run;
  }

  private forget(hash: string) {
    const bytes = this.files.get(hash);
    if (bytes === undefined) return;
    this.files.delete(hash);
    this.freeing += bytes;
    this.queue(hash, (file) => this.storage.remove(file))
      .then(() => (this.size -= bytes), reported)
      .finally(() => (this.freeing -= bytes));
  }

  put({ hash, data }: Entry) {
    if (this.off || this.files.has(hash) || data.length > this.limit) return;
    const fits = () => this.size - this.freeing + data.length <= this.limit;
    for (const old of this.files.keys()) {
      if (fits()) break;
      this.forget(old);
    }
    if (!fits()) return;
    this.files.set(hash, data.length);
    this.size += data.length;
    this.queue(hash, (file) => this.storage.writeAtomic(file, data)).catch(
      (error) => {
        this.disable(error);
        this.forget(hash);
      },
    );
  }

  async get(hash: string): Promise<Buffer | undefined> {
    if (!this.files.has(hash)) return;
    try {
      const data = await this.queue(hash, async (file) =>
        this.files.has(hash) ? this.storage.read(file) : undefined,
      );
      if (!data) return;
      if (sha256(data) !== hash) throw new Error(`${hash} is corrupt`);
      if (this.files.delete(hash)) this.files.set(hash, data.length);
      return data;
    } catch (error) {
      reported(error);
      this.forget(hash);
    }
  }
}

export class MeshCache {
  private readonly entries = new Map<string, Entry>();
  private readonly projects = new Map<string, Project>();
  private readonly limits: typeof MESH_LIMITS;
  private readonly disk: MeshDisk | undefined;
  private size = 0;
  private indexed = 0;

  constructor(limits: Partial<typeof MESH_LIMITS> = {}, dir?: string) {
    this.limits = { ...MESH_LIMITS, ...limits };
    this.disk =
      dir === undefined ? undefined : new MeshDisk(dir, this.limits.disk);
  }

  private levels(body: MeshedBody): { fine: Entry; coarse?: Entry } {
    const fine = this.encoded(body.meshKey, () => meshBinary(body));
    const coarse = coarseOf(body);
    if (!coarse) return { fine };
    return {
      fine,
      coarse: this.encoded(`${body.meshKey} coarse`, () => coarse),
    };
  }

  private encoded(key: string, encode: () => Uint8Array): Entry {
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit;
    }
    const binary = encode();
    const data = Buffer.from(
      binary.buffer,
      binary.byteOffset,
      binary.byteLength,
    );
    const entry = { hash: sha256(data), data };
    if (data.length > this.limits.bytes) {
      this.disk?.put(entry);
      return entry;
    }
    this.entries.set(key, entry);
    this.size += data.length;
    for (const [oldKey, old] of this.entries) {
      if (this.size <= this.limits.bytes) break;
      this.entries.delete(oldKey);
      this.size -= old.data.length;
      this.disk?.put(old);
    }
    return entry;
  }

  private project(projectId: string): Project {
    const project = this.projects.get(projectId) ?? {
      hashes: new Set<string>(),
      recent: new Set<string>(),
    };
    this.projects.delete(projectId);
    this.projects.set(projectId, project);
    return project;
  }

  publish(
    projectId: string,
    revision: number,
    evaluation: MeshedEvaluation,
    current = true,
  ): EvaluateResult {
    const bodies = evaluation.bodies.map((body) => this.wire(body));
    const hashes = new Set(
      bodies.flatMap(({ mesh, coarse }) => [
        mesh!.hash,
        ...(coarse ? [coarse.hash] : []),
      ]),
    );
    const project = this.project(projectId);
    const before = project.hashes.size + project.recent.size;
    if (current) {
      project.revision = revision;
      project.hashes = hashes;
    } else {
      for (const hash of hashes) {
        project.recent.delete(hash);
        project.recent.add(hash);
      }
      for (const hash of project.recent) {
        if (project.recent.size <= this.limits.recent) break;
        project.recent.delete(hash);
      }
    }
    this.indexed += project.hashes.size + project.recent.size - before;
    for (const [oldId] of this.projects) {
      if (
        this.projects.size <= this.limits.projects &&
        this.indexed <= this.limits.indexed
      )
        break;
      this.drop(oldId);
    }
    return { ...evaluation, bodies };
  }

  private wire(body: MeshedBody): BodyPayload {
    const { fine, coarse } = this.levels(body);
    const { bodyId, name, color, reference, approximate, meshKey, bbox } = body;
    return {
      bodyId,
      name,
      ...(color && { color }),
      ...(reference && { reference }),
      ...(approximate && { approximate }),
      meshKey,
      mesh: levelOf(fine),
      ...(coarse && { coarse: levelOf(coarse) }),
      bbox,
    };
  }

  rejects(projectId: string, revision: number, hash: string): boolean {
    const project = this.projects.get(projectId);
    return project?.revision === revision && !project.hashes.has(hash);
  }

  async get(
    projectId: string,
    revision: number,
    hash: string,
  ): Promise<Buffer | undefined> {
    const project = this.projects.get(projectId);
    const known =
      project?.recent.has(hash) ||
      (project?.revision === revision && project.hashes.has(hash));
    if (!known) return;
    for (const [key, entry] of this.entries) {
      if (entry.hash !== hash) continue;
      this.entries.delete(key);
      this.entries.set(key, entry);
      return entry.data;
    }
    return this.disk?.get(hash);
  }

  materialize(body: MeshedBody, hash: string): Buffer | undefined {
    const { fine, coarse } = this.levels(body);
    return [fine, coarse].find((level) => level?.hash === hash)?.data;
  }

  drop(projectId: string): void {
    const project = this.projects.get(projectId);
    if (!project) return;
    this.indexed -= project.hashes.size + project.recent.size;
    this.projects.delete(projectId);
  }
}
