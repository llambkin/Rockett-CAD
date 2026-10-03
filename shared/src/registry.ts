export const REGISTRY_ID = /^([a-z][a-z0-9-]*)[.][A-Za-z0-9.-]+$/;

export interface Registry<T> {
  register(item: T): () => void;
  get(id: string): T | undefined;
  list(): readonly T[];
  subscribe(fn: () => void): () => void;
  snapshot(): readonly T[];
}

export function createRegistry<T>(
  name: string,
  idOf: (item: T) => string,
): Registry<T> {
  let entries: readonly { item: T }[] = [];
  let items: readonly T[] = [];
  const listeners = new Set<() => void>();
  const changed = (next: readonly { item: T }[]) => {
    entries = next;
    items = next.map((entry) => entry.item);
    for (const fn of listeners) fn();
  };
  const get = (id: string) => items.find((item) => idOf(item) === id);
  return {
    register(item) {
      const id = idOf(item);
      if (get(id)) throw new Error(`${name} registry already has ${id}`);
      const entry = { item };
      changed([...entries, entry]);
      return () => {
        if (entries.includes(entry))
          changed(entries.filter((other) => other !== entry));
      };
    },
    get,
    list: () => items,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    snapshot: () => items,
  };
}
