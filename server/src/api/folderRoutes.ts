import {
  ROUTES,
  ValidationError,
  type Folder,
  type ProjectMember,
  type Route,
  type User,
} from "@rockett/shared";
import type { FolderStore } from "../store/folderStore.js";
import type { ProjectStore } from "../store/projectStore.js";
import type { UserStore } from "../auth/userStore.js";
import type { NoticeStore } from "../auth/noticeStore.js";
import type { FriendStore } from "../auth/friendStore.js";
import { StoreError } from "../store/jsonStore.js";
import { folderAccess } from "./projectAccess.js";

type Handler = (req: any, res: any) => Promise<void>;

async function folderRoster(
  users: UserStore | undefined,
  friends: FriendStore | undefined,
  actor: User,
  folder: Folder,
) {
  const allowed =
    actor.role === "admin" ? null : await friends?.friendIds(actor.id);
  return ((await users?.list()) ?? [])
    .filter(
      (user) =>
        user.status === "active" &&
        (actor.role === "admin" ||
          user.id === actor.id ||
          folder.members.some((member) => member.userId === user.id) ||
          allowed?.has(user.id)),
    )
    .map(({ id, username, displayName }) => ({ id, username, displayName }));
}

async function may(
  folders: FolderStore,
  user: User,
  id: string,
): Promise<void> {
  if ((await folderAccess(folders, user, id)) === "edit") return;
  throw new StoreError("folder not found", "not_found");
}

async function canManageShare(
  folders: FolderStore,
  user: User,
  folder: Folder,
) {
  if (user.role === "admin" || folder.owner === user.id) return true;
  if (await folderAccess(folders, user, folder.id)) return false;
  throw new StoreError("folder not found", "not_found");
}

export async function requireFolderDestination(
  folders: FolderStore,
  user: User,
  id: string,
): Promise<void> {
  try {
    await folders.get(id);
  } catch (error) {
    if (error instanceof StoreError && error.code === "not_found")
      throw new ValidationError("folder not found", "/folderId");
    throw error;
  }
  await may(folders, user, id);
}

function folderListRoute(folders: FolderStore): [Route, Handler] {
  return [
    ROUTES.listFolders,
    async (_req, res) => {
      const user = res.locals.user as User;
      const tree = await folders.tree();
      const visible = new Set<string>();
      for (const folder of tree.folders)
        if (await folderAccess(folders, user, folder.id))
          visible.add(folder.id);
      res.json({
        folders: tree.folders
          .filter((folder) => visible.has(folder.id))
          .map((folder) =>
            Object.assign({}, folder, {
              parentId:
                folder.parentId && visible.has(folder.parentId)
                  ? folder.parentId
                  : null,
              members:
                user.role === "admin" || folder.owner === user.id
                  ? folder.members
                  : folder.members.filter(
                      (member) => member.userId === user.id,
                    ),
            }),
          ),
        placement: Object.fromEntries(
          Object.entries(tree.placement).filter(([, id]) => visible.has(id)),
        ),
      });
    },
  ];
}

export function folderRoutes(
  folders: FolderStore,
  store: ProjectStore,
  users?: UserStore,
  notices?: NoticeStore,
  friends?: FriendStore,
): Array<[Route, Handler]> {
  return [
    folderListRoute(folders),
    [
      ROUTES.createFolder,
      async (req, res) => {
        const { name, parentId = null } = req.body;
        if (parentId !== null)
          await requireFolderDestination(folders, res.locals.user, parentId);
        res.json({
          folder: await folders.create(name, parentId, res.locals.user.id),
        });
      },
    ],
    [
      ROUTES.updateFolder,
      async (req, res) => {
        await may(folders, res.locals.user, req.params.id);
        if (req.body.parentId !== undefined && req.body.parentId !== null)
          await requireFolderDestination(
            folders,
            res.locals.user,
            req.body.parentId,
          );
        res.json({ folder: await folders.update(req.params.id, req.body) });
      },
    ],
    [
      ROUTES.deleteFolder,
      async (req, res) => {
        await may(folders, res.locals.user, req.params.id);
        await folders.remove(req.params.id);
        res.json({ ok: true });
      },
    ],
    [
      ROUTES.placeProject,
      async (req, res) => {
        await store.load(req.params.id);
        if (req.body.folderId !== null)
          await requireFolderDestination(
            folders,
            res.locals.user,
            req.body.folderId,
          );
        if (await store.isTemporary(req.params.id))
          throw new ValidationError(
            "A temporary project cannot move to a folder",
          );
        await folders.place(req.params.id, req.body.folderId);
        res.json({ ok: true });
      },
    ],
    ...folderMemberRoutes(folders, users, notices, friends),
  ];
}

function folderMemberRoutes(
  folders: FolderStore,
  users?: UserStore,
  notices?: NoticeStore,
  friends?: FriendStore,
): Array<[Route, Handler]> {
  return [
    [
      ROUTES.getFolderMembers,
      async (req, res) => {
        const folder = await folders.get(req.params.id);
        const actor = res.locals.user as User;
        if (!(await canManageShare(folders, actor, folder)))
          return void res.status(403).json({ error: "forbidden" });
        res.json({
          owner: folder.owner,
          members: folder.members,
          users: await folderRoster(users, friends, actor, folder),
        });
      },
    ],
    [
      ROUTES.folderMembers,
      async (req, res) => {
        const folder = await folders.get(req.params.id);
        const actor = res.locals.user as User;
        if (!(await canManageShare(folders, actor, folder)))
          return void res.status(403).json({ error: "forbidden" });
        const { owner, members } = req.body as {
          owner: string | null;
          members: ProjectMember[];
        };
        const active = new Set(
          ((await users?.list()) ?? [])
            .filter((user) => user.status === "active")
            .map((user) => user.id),
        );
        if (
          owner === null ||
          (folder.owner !== null && owner !== folder.owner) ||
          (folder.owner === null &&
            owner !== actor.id &&
            actor.role !== "admin") ||
          !active.has(owner) ||
          members.some(
            (member) => !active.has(member.userId) || member.userId === owner,
          ) ||
          new Set(members.map((member) => member.userId)).size !==
            members.length
        )
          throw new ValidationError(
            "owner and members must be distinct active users",
          );
        if (actor.role !== "admin" && owner !== null) {
          const allowed = await friends?.friendIds(owner);
          for (const member of members)
            if (!allowed?.has(member.userId))
              throw new ValidationError("share recipients must be friends");
        }
        const prior = new Set(folder.members.map((member) => member.userId));
        for (const member of members)
          if (!prior.has(member.userId))
            await notices?.reopen(member.userId, `folder:${folder.id}`);
        await folders.setAccess(folder.id, owner, members);
        res.json({ owner, members });
      },
    ],
  ];
}
