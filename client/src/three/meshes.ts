import { useSyncExternalStore } from "react";
import {
  meshPayloadOf,
  pathFor,
  ROUTES,
  type BodyPayload,
  type MeshedBody,
  type MeshPayload,
} from "@rockett/shared";
import { request } from "../api";

const MAX_FETCHES = 6;
const MESH_NUMBERS = 32 * 1024 * 1024;
const QUEUE_LIMIT = 1024;

export type LayerBody = BodyPayload & Partial<MeshPayload>;

export const hashOf = (body: LayerBody) => body.mesh?.hash ?? body.meshKey;
const decoded = (body: LayerBody): body is MeshedBody =>
  body.positions !== undefined;
const numbers = (m: MeshPayload) =>
  m.positions.length + m.normals.length + m.indices.length;

export class MeshRegistry {
  private readonly meshes = new Map<string, MeshPayload>();
  private readonly queue = new Map<string, string>();
  private readonly fetching = new Set<string>();
  private readonly failed = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private scope: { id: string; stop: AbortController } | null = null;
  private size = 0;
  private active = 0;
  private version = 0;

  constructor(private readonly limit = MESH_NUMBERS) {}

  readonly current = () => this.version;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  get(body: LayerBody, coarse = false): MeshPayload | undefined {
    if (decoded(body)) return body;
    const level = coarse ? body.coarse?.hash : undefined;
    const key = level ?? body.meshKey;
    const hit = this.meshes.get(key);
    if (!hit) return this.want(key, level ?? hashOf(body));
    this.meshes.delete(key);
    this.meshes.set(key, hit);
    return hit;
  }

  useProject(id: string | undefined) {
    if (this.scope?.id === id) return;
    this.scope?.stop.abort();
    this.meshes.clear();
    this.size = 0;
    this.queue.clear();
    this.fetching.clear();
    this.failed.clear();
    this.active = 0;
    this.scope = id === undefined ? null : { id, stop: new AbortController() };
  }

  retry() {
    this.failed.clear();
  }

  notify() {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  private keep(key: string, mesh: MeshPayload) {
    const replaced = this.meshes.get(key);
    if (replaced) this.size -= numbers(replaced);
    this.meshes.delete(key);
    this.meshes.set(key, mesh);
    this.size += numbers(mesh);
    for (const [old, dropped] of this.meshes) {
      if (this.size <= this.limit || old === key) break;
      this.meshes.delete(old);
      this.size -= numbers(dropped);
    }
    return mesh;
  }

  private want(key: string, hash: string): undefined {
    if (!this.scope || this.fetching.has(key) || this.failed.has(key)) return;
    this.queue.delete(key);
    this.queue.set(key, hash);
    for (const [old] of this.queue) {
      if (this.queue.size <= QUEUE_LIMIT) break;
      this.queue.delete(old);
    }
    this.pump();
  }

  private pump() {
    const scope = this.scope;
    if (!scope) return;
    while (this.active < MAX_FETCHES && this.queue.size > 0) {
      const [key, hash] = [...this.queue].at(-1)!;
      this.queue.delete(key);
      this.fetch(scope, key, hash);
    }
  }

  private fetch(
    scope: NonNullable<MeshRegistry["scope"]>,
    key: string,
    hash: string,
  ) {
    this.active++;
    this.fetching.add(key);
    const path = pathFor(ROUTES.mesh, { id: scope.id, hash });
    request(ROUTES.mesh.method, path, {
      signal: scope.stop.signal,
      unwatched: true,
      response: "blob",
    })
      .then(({ blob }) => blob.arrayBuffer())
      .then((bytes) => {
        if (scope !== this.scope) return;
        this.keep(key, meshPayloadOf(new Uint8Array(bytes)));
        this.notify();
      })
      .catch(() => {
        if (scope === this.scope) this.failed.add(key);
      })
      .finally(() => {
        if (scope !== this.scope) return;
        this.fetching.delete(key);
        this.active--;
        this.pump();
      });
  }
}

export const meshes = new MeshRegistry();
export const meshOf = (body: LayerBody) => meshes.get(body);
export const useMeshVersion = () =>
  useSyncExternalStore(meshes.subscribe, meshes.current, meshes.current);
