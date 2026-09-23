import crypto from "node:crypto";
import {
  FOLDERS_VERSION,
  foldersFile,
  parse,
  ValidationError,
  type Folder,
  type FoldersFile,
  type FolderTree,
} from "@rockett/shared";
import { JsonStore, StoreError } from "./jsonStore.js";
import { ProjectQueue } from "./projectQueue.js";

const KEY = "folders";

export class FolderStore {
  private file: JsonStore<FoldersFile>;
  private queue = new ProjectQueue();

  constructor(dataDir: string) {
    this.file = new JsonStore({
      root: dataDir,
      name: "folders",
      key: /^folders$/,
      file: "folders.json",
      migrate: (raw) => {
        try {
          return parse(foldersFile, raw);
        } catch {
          throw new StoreError("folders.json is corrupted", "internal");
        }
      },
      validate: (value) => parse(foldersFile, value),
    });
  }

  async tree(): Promise<FolderTree> {
    const { folders, placement } = await this.read();
    return { folders, placement };
  }

  create(name: string, parentId: string | null): Promise<Folder> {
    return this.change((tree) => {
      exists(tree, parentId, "/parentId");
      const folder = {
        id: crypto.randomBytes(6).toString("hex"),
        name,
        parentId,
      };
      tree.folders.push(folder);
      return folder;
    });
  }

  update(
    id: string,
    patch: { name?: string; parentId?: string | null },
  ): Promise<Folder> {
    return this.change((tree) => {
      const folder = find(tree, id);
      if (patch.parentId !== undefined) {
        exists(tree, patch.parentId, "/parentId");
        if (inside(tree, patch.parentId, id))
          throw new ValidationError(
            "A folder cannot move into itself or a folder inside it",
            "/parentId",
          );
        folder.parentId = patch.parentId;
      }
      if (patch.name !== undefined) folder.name = patch.name;
      return folder;
    });
  }

  remove(id: string): Promise<void> {
    return this.change((tree) => {
      const folder = find(tree, id);
      const items =
        tree.folders.filter((f) => f.parentId === id).length +
        Object.values(tree.placement).filter((f) => f === id).length;
      if (items > 0)
        throw new StoreError(
          `Folder "${folder.name}" is not empty. Move or delete its ${items} item${items === 1 ? "" : "s"} first.`,
          "conflict",
        );
      tree.folders = tree.folders.filter((f) => f.id !== id);
    });
  }

  place(projectId: string, folderId: string | null): Promise<void> {
    return this.change((tree) => {
      exists(tree, folderId, "/folderId");
      if (folderId === null) delete tree.placement[projectId];
      else tree.placement[projectId] = folderId;
    });
  }

  createIn<T extends { id: string }>(
    folderId: string,
    create: () => Promise<T>,
  ): Promise<T> {
    return this.change(async (tree) => {
      exists(tree, folderId, "/folderId");
      const project = await create();
      tree.placement[project.id] = folderId;
      return project;
    });
  }

  private async read(): Promise<FoldersFile> {
    try {
      return await this.file.read(KEY);
    } catch (err) {
      if (err instanceof StoreError && err.code === "not_found")
        return { version: FOLDERS_VERSION, folders: [], placement: {} };
      throw err;
    }
  }

  private change<R>(edit: (tree: FoldersFile) => R | Promise<R>): Promise<R> {
    return this.queue.run(KEY, async () => {
      const tree = await this.read();
      const result = await edit(tree);
      await this.file.write(KEY, tree);
      return result;
    });
  }
}

function find(tree: FoldersFile, id: string): Folder {
  const folder = tree.folders.find((f) => f.id === id);
  if (!folder) throw new StoreError("folder not found", "not_found");
  return folder;
}

function exists(tree: FoldersFile, id: string | null, detail: string): void {
  if (id !== null && !tree.folders.some((f) => f.id === id))
    throw new ValidationError("folder not found", detail);
}

function inside(tree: FoldersFile, start: string | null, id: string): boolean {
  let at = start;
  for (let step = 0; at !== null && step <= tree.folders.length; step++) {
    if (at === id) return true;
    at = tree.folders.find((f) => f.id === at)?.parentId ?? null;
  }
  return false;
}
