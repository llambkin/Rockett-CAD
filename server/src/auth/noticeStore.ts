import { JsonStore, StoreError } from "../store/jsonStore.js";
import { ProjectQueue } from "../store/projectQueue.js";
import type { Storage } from "../store/storage.js";

interface OpenedFile {
  version: 1;
  projects: string[];
}

export class NoticeStore {
  private readonly file: JsonStore<OpenedFile>;
  private readonly queue = new ProjectQueue();

  constructor(storage: Storage) {
    this.file = new JsonStore({
      storage,
      root: "users/notices",
      name: "notices",
      key: /^[a-z0-9][a-z0-9-]{0,63}$/,
      file: () => "opened.json",
      migrations: {
        namespace: "notices",
        current: 1,
        field: "version",
        steps: {},
      },
      validate: (file) => {
        if (
          file.version !== 1 ||
          !Array.isArray(file.projects) ||
          file.projects.some((id) => typeof id !== "string")
        )
          throw new StoreError("notices are corrupted", "internal");
      },
    });
  }

  async opened(userId: string): Promise<Set<string>> {
    try {
      return new Set((await this.file.read(userId)).projects);
    } catch (error) {
      if (error instanceof StoreError && error.code === "not_found")
        return new Set();
      throw error;
    }
  }

  open(userId: string, projectId: string): Promise<void> {
    return this.queue.run(userId, async () => {
      const opened = await this.opened(userId);
      opened.add(projectId);
      await this.file.write(userId, { version: 1, projects: [...opened] });
    });
  }

  reopen(userId: string, projectId: string): Promise<void> {
    return this.queue.run(userId, async () => {
      const opened = await this.opened(userId);
      if (!opened.delete(projectId)) return;
      await this.file.write(userId, { version: 1, projects: [...opened] });
    });
  }
}
