import type { NextFunction, Request, Response } from "express";
import {
  ROUTES,
  type ProjectMember,
  type ProjectSummary,
  type User,
} from "@rockett/shared";
import { StoreError } from "../store/jsonStore.js";
import type { ProjectStore } from "../store/projectStore.js";
import type { FolderStore } from "../store/folderStore.js";
import type { Folder } from "@rockett/shared";

const READ_POSTS = new Set([
  ROUTES.evaluate.path,
  ROUTES.projectEdge.path,
  ROUTES.tangentEdges.path,
  ROUTES.sizeLimit.path,
  ROUTES.measure.path,
  ROUTES.exportModel.path,
]);

export function projectRole(
  user: User,
  owner: string | null,
  members: ProjectMember[],
) {
  return user.role === "admin" || owner === null || owner === user.id
    ? "edit"
    : members.find((member) => member.userId === user.id)?.role;
}

export function folderRole(user: User, folder: Folder) {
  return user.role === "admin" ||
    folder.owner === null ||
    folder.owner === user.id
    ? "edit"
    : folder.members.find((member) => member.userId === user.id)?.role;
}

export async function folderAccess(
  folders: FolderStore,
  user: User,
  id: string,
) {
  const roles = new Set(
    (await folders.ancestors(id)).map((folder) => folderRole(user, folder)),
  );
  return roles.has("edit") ? "edit" : roles.has("view") ? "view" : undefined;
}

export async function projectAccess(
  store: ProjectStore,
  folders: FolderStore,
  user: User,
  id: string,
) {
  const { owner, members } = await store.projectAccess(id);
  const direct = projectRole(user, owner, members);
  if (direct === "edit") return direct;
  const inherited = new Set(
    (await folders.containing(id)).flatMap((folder) => {
      const role = folderRole(user, folder);
      return role ? [role] : [];
    }),
  );
  return inherited.has("edit")
    ? "edit"
    : (direct ?? (inherited.has("view") ? "view" : undefined));
}

export const isProjectRoute = (req: Request): boolean =>
  req.route?.path.startsWith("/projects/:id") ?? false;

export async function visibleProjects(
  store: ProjectStore,
  folders: FolderStore,
  user: User,
): Promise<ProjectSummary[]> {
  const listed = await store.list();
  if (user.role === "admin") return listed;
  const visible = await Promise.all(
    listed.map(async (project) => {
      return (await projectAccess(store, folders, user, project.id))
        ? project
        : undefined;
    }),
  );
  return visible.filter((project) => project !== undefined);
}

export function projectAccessGuard(store: ProjectStore, folders: FolderStore) {
  return (req: Request, res: Response, next: NextFunction, id: string) => {
    if (!isProjectRoute(req)) return next();
    const user: User | undefined = res.locals.user;
    if (!user) return next(new Error("auth middleware missing"));
    projectAccess(store, folders, user, id)
      .then((access) => {
        if (!access)
          return res
            .status(404)
            .json({ error: "project not found", code: "not_found" });
        res.locals.projectRole = access;
        if (
          access === "view" &&
          (req.method === "PUT" ||
            req.method === "PATCH" ||
            req.method === "DELETE" ||
            (req.method === "POST" && !READ_POSTS.has(req.route.path)))
        )
          return res.status(403).json({ error: "forbidden" });
        next();
      })
      .catch((err: unknown) => {
        if (err instanceof StoreError && err.code === "not_found")
          return res
            .status(404)
            .json({ error: "project not found", code: "not_found" });
        if (err instanceof StoreError && err.code === "unprocessable")
          return res.status(422).json({ error: err.message, code: err.code });
        next(err);
      });
  };
}
