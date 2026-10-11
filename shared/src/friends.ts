import { Type } from "typebox";
import type { User } from "./auth.js";
import { route } from "./routes.js";

export const friendRequestBody = Type.Object(
  {
    email: Type.String({
      minLength: 3,
      maxLength: 254,
      pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
    }),
  },
  { additionalProperties: false },
);

export interface FriendList {
  friends: Array<Pick<User, "id" | "username" | "displayName">>;
  incoming: Array<{
    id: string;
    email: string;
    from: Pick<User, "id" | "username" | "displayName">;
  }>;
  outgoing: Array<{ id: string; email: string }>;
}

export const FRIEND_ROUTES = {
  list: route<never, FriendList>()("GET", "/me/friends"),
  request: route<{ email: string }, { ok: true }>()(
    "POST",
    "/me/friends",
    friendRequestBody,
  ),
  accept: route<never, { ok: true }>()(
    "POST",
    "/me/friends/requests/:id/accept",
  ),
  reject: route<never, { ok: true }>()(
    "POST",
    "/me/friends/requests/:id/reject",
  ),
  cancel: route<never, { ok: true }>()("DELETE", "/me/friends/requests/:id"),
  remove: route<never, { ok: true }>()("DELETE", "/me/friends/:id"),
};
