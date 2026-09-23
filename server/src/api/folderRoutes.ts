import { ROUTES, type Route } from "@rockett/shared";
import type { FolderStore } from "../store/folderStore.js";
import type { ProjectStore } from "../store/projectStore.js";

type Handler = (req: any, res: any) => Promise<void>;

export function folderRoutes(
  folders: FolderStore,
  store: ProjectStore,
): Array<[Route, Handler]> {
  return [
    [
      ROUTES.listFolders,
      async (_req, res) => {
        res.json(await folders.tree());
      },
    ],
    [
      ROUTES.createFolder,
      async (req, res) => {
        const { name, parentId = null } = req.body;
        res.json({ folder: await folders.create(name, parentId) });
      },
    ],
    [
      ROUTES.updateFolder,
      async (req, res) => {
        res.json({ folder: await folders.update(req.params.id, req.body) });
      },
    ],
    [
      ROUTES.deleteFolder,
      async (req, res) => {
        await folders.remove(req.params.id);
        res.json({ ok: true });
      },
    ],
    [
      ROUTES.placeProject,
      async (req, res) => {
        await store.load(req.params.id);
        await folders.place(req.params.id, req.body.folderId);
        res.json({ ok: true });
      },
    ],
  ];
}
