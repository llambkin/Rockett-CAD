import { NAME_LENGTH, ROUTES } from "@rockett/shared";
import { downloadProjectFile, uploadProjectFile } from "./projectFile.js";
import { folderRoutes, requireFolderDestination } from "./folderRoutes.js";
import { projectMemberHandlers } from "./projectMembers.js";
import { receiveProjectFile } from "./uploads.js";
import { checkRevision, ifMatchRevision } from "./revision.js";
import { visibleProjects } from "./projectAccess.js";
import { checkDeleteTag } from "../store/projectInventory.js";
import type { UserStore } from "../auth/userStore.js";
import type { ApiRoutes } from "./projectMutations.js";

export const userNames = async (users?: UserStore) =>
  new Map(
    (await users?.list())?.map((user) => [user.id, user.displayName]) ?? [],
  );

function projectCreationRoutes(context: ApiRoutes) {
  const {
    on,
    wrap,
    store,
    folders,
    users,
    notices,
    friends,
    uploadBytes,
    importBytes,
    assemblies,
  } = context;
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

  on(ROUTES.downloadProjectFile, wrap(downloadProjectFile(store, assemblies)));
  on(
    ROUTES.uploadProjectFile,
    receiveProjectFile(store.uploads, uploadBytes),
    wrap(uploadProjectFile(store, assemblies, folders, importBytes)),
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
    assemblies,
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
      if (!(await store.isTemporary(req.params.id))) {
        const header: string | undefined = req.get("If-Match");
        if (header !== undefined && /^"[a-f0-9]{64}"$/.test(header))
          await checkDeleteTag(store, req.params.id, header);
        else {
          const revision = ifMatchRevision(header);
          checkRevision(await store.load(req.params.id), revision);
        }
      }
      await store.remove(req.params.id);
      history.forget(req.params.id);
      kernel.drop(req.params.id);
      meshCache.drop(req.params.id);
      await folders.place(req.params.id, null);
      res.json({ ok: true });
    }),
  );

  on(
    ROUTES.duplicateProject,
    wrap(async (req, res, ctx) => {
      const view = await store.view(req.params.id, ctx.user.id);
      const copy = await store.duplicate(
        req.params.id,
        req.body.name ? req.body.name.slice(0, NAME_LENGTH) : undefined,
        ctx.user.id,
      );
      await assemblies.copy(req.params.id, copy).catch(async (err) => {
        await store.remove(copy.id);
        throw err;
      });
      await store.setView(copy.id, ctx.user.id, view);
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
