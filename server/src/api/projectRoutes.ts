import { NAME_LENGTH, ROUTES } from "@rockett/shared";
import { downloadProjectFile, uploadProjectFile } from "./projectFile.js";
import { folderRoutes, requireFolderDestination } from "./folderRoutes.js";
import { projectMemberHandlers } from "./projectMembers.js";
import { receiveProjectFile } from "./uploads.js";
import { visibleProjects } from "./projectAccess.js";
import type { UserStore } from "../auth/userStore.js";
import type { ApiRoutes } from "./projectMutations.js";

export const userNames = async (users?: UserStore) =>
  new Map(
    (await users?.list())?.map((user) => [user.id, user.displayName]) ?? [],
  );

function projectCreationRoutes(context: ApiRoutes) {
  const { on, wrap, store, folders, users, notices, friends } = context;
  on(
    ROUTES.listProjects,
    wrap(async (_req, res, ctx) => {
      const named = await userNames(users);
      const listed = await visibleProjects(store, folders, ctx.user);
      res.json(
        await Promise.all(
          listed.map(async (project) => {
            const access = await store
              .projectAccess(project.id)
              .catch((error) => {
                if (project.status !== "ok") return null;
                throw error;
              });
            const owner = access?.owner ?? null;
            return Object.assign(project, {
              owner,
              ownerName:
                access === null
                  ? "Unavailable"
                  : owner
                    ? (named.get(owner) ?? owner)
                    : null,
            });
          }),
        ),
      );
    }),
  );

  const members = projectMemberHandlers(store, users, notices, friends);
  on(ROUTES.projectMembers, wrap(members.put));
  on(ROUTES.getProjectMembers, wrap(members.get));

  on(
    ROUTES.createProject,
    wrap(async (req, res, ctx) => {
      const name = (req.body.name ?? "Untitled").slice(0, NAME_LENGTH);
      const { folderId } = req.body;
      if (folderId !== undefined)
        await requireFolderDestination(folders, ctx.user, folderId);
      const doc =
        folderId === undefined
          ? await store.create(name, ctx.user.id)
          : await folders.createIn(folderId, () =>
              store.create(name, ctx.user.id),
            );
      res.json({ document: doc });
    }),
  );

  on(ROUTES.downloadProjectFile, wrap(downloadProjectFile(store)));
  on(
    ROUTES.uploadProjectFile,
    receiveProjectFile,
    wrap(uploadProjectFile(store, folders)),
  );
}

function projectDocumentRoutes(context: ApiRoutes) {
  const {
    on,
    wrap,
    store,
    folders,
    send,
    history,
    kernel,
    meshCache,
    editable,
  } = context;
  on(
    ROUTES.getProject,
    wrap(async (req, res) => {
      const access = res.locals.projectRole;
      await send(res, await store.load(req.params.id), undefined, { access });
    }),
  );

  on(
    ROUTES.deleteProject,
    wrap(async (req, res) => {
      await history.remove(req.params.id);
      kernel.drop(req.params.id);
      meshCache.drop(req.params.id);
      await folders.place(req.params.id, null);
      res.json({ ok: true });
    }),
  );

  on(
    ROUTES.duplicateProject,
    wrap(async (req, res, ctx) => {
      const copy = await store.duplicate(
        req.params.id,
        req.body.name ? req.body.name.slice(0, NAME_LENGTH) : undefined,
        ctx.user.id,
      );
      res.json({ document: copy });
    }),
  );

  on(
    ROUTES.renameProject,
    wrap(async (req, res, ctx) => {
      const doc = await editable(req, res);
      doc.name = (req.body.name ?? doc.name).slice(0, NAME_LENGTH);
      await history.save(doc, undefined, undefined, ctx.user.id);
      await send(res, doc);
    }),
  );
}

function projectFolderRoutes(context: ApiRoutes) {
  const { on, wrap, store, folders, users, notices, friends } = context;
  for (const [route, handler] of folderRoutes(
    folders,
    store,
    users,
    notices,
    friends,
  ))
    on(route, wrap(handler));
}

export function projectRoutes(context: ApiRoutes) {
  projectCreationRoutes(context);
  projectDocumentRoutes(context);
  projectFolderRoutes(context);
}
