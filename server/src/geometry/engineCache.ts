import { ENGINE_CACHE } from "../tunables.js";
import { getKernel, kernelVersion } from "./kernel.js";

interface CachedEngine {
  readonly docId: string;
  readonly bytes: number;
  invalidate(): void;
}

export const heapBytes = (): number =>
  kernelVersion() ? getKernel().HEAP8.length : 0;

export function lruEngines<T extends CachedEngine>(
  create: (docId: string) => T,
) {
  const engines = new Map<string, T>();
  const cache = {
    budget: ENGINE_CACHE.bytes,
    get(docId: string): T {
      const engine = engines.get(docId) ?? create(docId);
      cache.adopt(engine);
      return engine;
    },
    adopt(engine: T): void {
      const held = engines.get(engine.docId);
      if (held !== engine) held?.invalidate();
      engines.delete(engine.docId);
      engines.set(engine.docId, engine);
      let total = 0;
      for (const e of engines.values()) total += e.bytes;
      for (const [id, e] of engines) {
        if (total <= cache.budget) break;
        if (e === engine) continue;
        total -= e.bytes;
        cache.drop(id);
      }
    },
    drop(docId: string): void {
      engines.get(docId)?.invalidate();
      engines.delete(docId);
    },
    clear(): void {
      for (const docId of engines.keys()) cache.drop(docId);
    },
  };
  return cache;
}
