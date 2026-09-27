import type { User } from "./auth.js";
import { route } from "./routes.js";

export type Notice =
  | {
      kind: "friend";
      id: string;
      from: Pick<User, "id" | "username" | "displayName">;
    }
  | { kind: "project"; id: string; name: string };

export const NOTICE_ROUTES = {
  list: route<never, { items: Notice[] }>()("GET", "/me/notices"),
  openProject: route<never, { ok: true }>()(
    "POST",
    "/me/notices/projects/:id/open",
  ),
};
