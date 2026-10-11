import {
  coarseOf,
  lazyMesh,
  meshBinary,
  meshHead,
  type BodyPayload,
  type MeshedBody,
} from "@rockett/shared";
import type { NamedBody } from "./naming.js";
import type { TriangleMesh } from "./meshBody.js";
import { shapeHash, type Shape } from "./kernel.js";

interface Tessellation {
  source: Shape | TriangleMesh;
  head: BodyPayload;
  binary: Uint8Array;
  bytes: number;
}

export const tessCache = {
  limit: 256 * 1024 * 1024,
  bytes: 0,
  entries: new Map<string, Tessellation>(),
};

export function payloadBytes(value: unknown): number {
  if (typeof value === "number" || typeof value === "boolean") return 8;
  if (typeof value === "string") return value.length * 2;
  if (!value || typeof value !== "object") return 0;
  if (Array.isArray(value) && typeof value[0] === "number")
    return value.length * 8;
  let bytes = 0;
  for (const v of Object.values(value)) bytes += payloadBytes(v);
  return bytes;
}

export const sourceOf = (body: NamedBody) => body.mesh ?? body.shape;

function cacheKey(body: NamedBody): string {
  return `${body.bodyId}:${body.mesh?.key ?? shapeHash(body.shape)}`;
}

function evict(key: string): void {
  const entry = tessCache.entries.get(key);
  if (!entry) return;
  tessCache.entries.delete(key);
  tessCache.bytes -= entry.bytes;
}

export function forget(body: NamedBody): void {
  const key = cacheKey(body);
  if (tessCache.entries.get(key)?.source === sourceOf(body)) evict(key);
}

export function store(body: NamedBody, payload: MeshedBody): Tessellation {
  const key = cacheKey(body);
  evict(key);
  const head = meshHead(payload);
  const binary = meshBinary(payload);
  const coarse = coarseOf(payload)?.byteLength ?? 0;
  const entry = {
    source: sourceOf(body),
    head,
    binary,
    bytes: binary.byteLength + coarse + payloadBytes(head),
  };
  tessCache.entries.set(key, entry);
  tessCache.bytes += entry.bytes;
  for (const old of tessCache.entries.keys()) {
    if (tessCache.bytes <= tessCache.limit) break;
    evict(old);
  }
  return entry;
}

export type Decoded = Map<Tessellation, MeshedBody>;

export function sourceMesh(entry: Tessellation, memo: Decoded): MeshedBody {
  const mesh = memo.get(entry) ?? lazyMesh({ ...entry.head }, entry.binary);
  memo.set(entry, mesh);
  return mesh;
}

export function cached(body: NamedBody): Tessellation | undefined {
  const key = cacheKey(body);
  const entry = tessCache.entries.get(key);
  if (!entry) return undefined;
  if (!body.mesh && entry.source.isDeleted()) {
    evict(key);
    return undefined;
  }
  if (
    !body.mesh &&
    (body.shape.isDeleted() || !entry.source.IsSame(body.shape))
  )
    return undefined;
  tessCache.entries.delete(key);
  tessCache.entries.set(key, entry);
  return entry;
}
