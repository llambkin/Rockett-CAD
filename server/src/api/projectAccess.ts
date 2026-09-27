import type { NextFunction, Request, Response } from "express";
import {
  ROUTES,
  type ProjectMember,
  type ProjectSummary,
  type User,
} from "@rockett/shared";
import { StoreError } from "../store/jsonStore.js";
import type { ProjectStore } from "../store/projectStore.js";

const READ_POSTS = new Set([
  ROUTES.evaluate.path,
  ROUTES.projectEdge.path,
  ROUTES.tangentEdges.path,
  ROUTES.sizeLimit.path,
  ROUTES.measure.path,
  ROUTES.exportModel.path,
]);

function role(user: User, owner: string | null, members: ProjectMember[]) {
  return user.role === "admin" || owner === null || owner === user.id
    ? "edit"
    : members.find((member) => member.userId === user.id)?.role;
}

export async function visibleProjects(
  store: ProjectStore,
  user: User,
): Promise<ProjectSummary[]> {
  const listed = await store.list();
  if (user.role === "admin") return listed;
  const visible = await Promise.all(
    listed.map(async (project) => {
      const { owner, members } = await store.projectAccess(project.id);
      return role(user, owner, members) ? project : undefined;
    }),
  );
  return visible.filter((project) => project !== undefined);
}

export function projectAccessGuard(store: ProjectStore) {
  return (req: Request, res: Response, next: NextFunction, id: string) => {
    if (!req.route?.path.startsWith("/projects/:id")) return next();
    const user: User | undefined = res.locals.user;
    if (!user) return next(new Error("auth middleware missing"));
    store
      .projectAccess(id)
      .then(({ owner, members }) => {
        const access = role(user, owner, members);
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
