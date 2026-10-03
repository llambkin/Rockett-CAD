import { createHash } from "node:crypto";
import type { BodyPayload } from "@rockett/shared";

const LIMIT = 256 * 1024 * 1024;
const PROJECT_LIMIT = 4096;
const INDEX_LIMIT = 65536;

type Entry = { hash: string; data: Buffer };

export class MeshCache {
  private readonly entries = new Map<string, Entry>();
  private readonly projects = new Map<
    string,
    { revision: number; hashes: Set<string> }
  >();
  private size = 0;
  private indexed = 0;

  private encoded(body: BodyPayload): Entry {
    const hit = this.entries.get(body.meshKey);
    if (hit) {
      this.entries.delete(body.meshKey);
      this.entries.set(body.meshKey, hit);
      return hit;
    }
    const { positions, normals, indices, faces, edges, vertices, bbox } = body;
    const data = Buffer.from(
      JSON.stringify({
        positions,
        normals,
        indices,
        faces,
        edges,
        vertices,
        bbox,
      }),
    );
    const entry = {
      hash: createHash("sha256").update(data).digest("hex"),
      data,
    };
    if (data.length <= LIMIT) {
      this.entries.set(body.meshKey, entry);
      this.size += data.length;
      for (const [key, old] of this.entries) {
        if (this.size <= LIMIT) break;
        this.entries.delete(key);
        this.size -= old.data.length;
      }
    }
    return entry;
  }

  publish(
    projectId: string,
    revision: number,
    bodies: BodyPayload[],
    current = true,
  ): void {
    const hashes = new Set<string>();
    for (const body of bodies) {
      this.describe(body);
      hashes.add(body.mesh!.hash);
    }
    if (!current) return;
    this.drop(projectId);
    this.projects.set(projectId, { revision, hashes });
    this.indexed += hashes.size;
    for (const [oldId] of this.projects) {
      if (this.projects.size <= PROJECT_LIMIT && this.indexed <= INDEX_LIMIT)
        break;
      this.drop(oldId);
    }
  }

  describe(body: BodyPayload): void {
    const { hash, data } = this.encoded(body);
    body.mesh = { hash, bytes: data.length };
  }

  rejects(projectId: string, revision: number, hash: string): boolean {
    const project = this.projects.get(projectId);
    return project?.revision === revision && !project.hashes.has(hash);
  }

  get(projectId: string, revision: number, hash: string): Buffer | undefined {
    const project = this.projects.get(projectId);
    if (project?.revision !== revision || !project.hashes.has(hash)) return;
    for (const [key, entry] of this.entries) {
      if (entry.hash !== hash) continue;
      this.entries.delete(key);
      this.entries.set(key, entry);
      return entry.data;
    }
  }

  materialize(body: BodyPayload): Buffer {
    return this.encoded(body).data;
  }

  drop(projectId: string): void {
    this.indexed -= this.projects.get(projectId)?.hashes.size ?? 0;
    this.projects.delete(projectId);
  }
}
