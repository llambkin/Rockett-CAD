import path from "node:path";
import type { ModuleFiles } from "@rockett/plugin-api";
import { readFirst, storagePath, type Storage } from "../store/storage.js";

export function moduleFiles(storage: Storage, moduleId: string): ModuleFiles {
  const root = path.posix.join("modules", storagePath(moduleId));
  const at = (name: string) => {
    try {
      return path.posix.join(root, storagePath(name));
    } catch {
      throw new Error(`module file ${JSON.stringify(name)} leaves ${root}/`);
    }
  };
  return {
    read: async (name) => (await readFirst(storage, [at(name)]))?.data ?? null,
    write: async (name, data) => storage.writeAtomic(at(name), data),
    remove: async (name) => storage.remove(at(name)),
    list: () => storage.files(root),
  };
}
