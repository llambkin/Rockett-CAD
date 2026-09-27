import { Router, json, type Response } from "express";
import { FRIEND_ROUTES, friendRequestBody, parse } from "@rockett/shared";
import { StoreError } from "../store/jsonStore.js";
import type { ProjectStore } from "../store/projectStore.js";
import type { FriendStore } from "./friendStore.js";
import { toPublicUser, type UserStore } from "./userStore.js";

export function createFriendRouter(
  users: UserStore,
  friends: FriendStore,
  projects: ProjectStore,
): Router {
  const router = Router();
  registerFriendList(router, users, friends);
  registerFriendActions(router, users, friends, projects);
  return router;
}

const run =
  (action: (req: any, res: Response) => Promise<void>) =>
  async (req: any, res: Response, next: (err: unknown) => void) => {
    try {
      await action(req, res);
    } catch (err) {
      if (err instanceof StoreError && err.code === "not_found")
        return void res.status(404).json({ error: "not found" });
      if (err instanceof StoreError && err.code === "conflict")
        return void res.status(409).json({ error: "conflict" });
      next(err);
    }
  };

function registerFriendList(
  router: Router,
  users: UserStore,
  friends: FriendStore,
): void {
  router.get(
    FRIEND_ROUTES.list.path,
    run(async (_req, res) => {
      const user = res.locals.user;
      const file = await friends.list();
      const roster = (await users.list()).filter(
        (record) => record.status === "active",
      );
      const names = new Map(
        roster.map((record) => [record.id, toPublicUser(record)]),
      );
      const publicFriend = (id: string) => {
        const record = names.get(id);
        return (
          record && {
            id: record.id,
            username: record.username,
            displayName: record.displayName,
          }
        );
      };
      res.json({
        friends: file.friends.flatMap((friend) => {
          const other =
            friend.a === user.id
              ? friend.b
              : friend.b === user.id
                ? friend.a
                : null;
          const named = other && publicFriend(other);
          return named ? [named] : [];
        }),
        incoming: file.requests.flatMap((request) => {
          const from = publicFriend(request.from);
          return request.email === user.email && from
            ? [{ id: request.id, email: request.email, from }]
            : [];
        }),
        outgoing: file.requests
          .filter((request) => request.from === user.id)
          .map(({ id, email }) => ({ id, email })),
      });
    }),
  );
}

function registerFriendActions(
  router: Router,
  users: UserStore,
  friends: FriendStore,
  projects: ProjectStore,
): void {
  router.post(
    FRIEND_ROUTES.request.path,
    json({ limit: "1kb" }),
    run(async (req, res) => {
      const user = res.locals.user;
      const { email } = parse(friendRequestBody, {
        email:
          typeof req.body?.email === "string"
            ? req.body.email.trim()
            : req.body?.email,
      });
      const address = email.trim().toLowerCase();
      if (address === user.email)
        return void res.status(400).json({ error: "cannot request yourself" });
      const target = await users.findByEmail(address);
      await friends.request(user.id, address, target?.id);
      res.status(202).json({ ok: true });
    }),
  );
  for (const [route, accept] of [
    [FRIEND_ROUTES.accept, true],
    [FRIEND_ROUTES.reject, false],
  ] as const)
    router.post(
      route.path,
      run(async (req, res) => {
        const user = res.locals.user;
        if (!user.email)
          return void res.status(404).json({ error: "not found" });
        const file = await friends.list();
        const pending = file.requests.find(
          (item) => item.id === req.params.id && item.email === user.email,
        );
        if (!pending) return void res.status(404).json({ error: "not found" });
        const sender = await users.get(pending.from);
        if (accept && sender?.status !== "active")
          return void res.status(404).json({ error: "not found" });
        await friends.answer(
          req.params.id,
          user.id,
          user.email,
          accept,
          sender?.email,
        );
        res.json({ ok: true });
      }),
    );
  router.delete(
    FRIEND_ROUTES.cancel.path,
    run(async (req, res) => {
      await friends.cancel(req.params.id, res.locals.user.id);
      res.json({ ok: true });
    }),
  );
  router.delete(
    FRIEND_ROUTES.remove.path,
    run(async (req, res) => {
      const userId = res.locals.user.id;
      await friends.remove(userId, req.params.id, () =>
        projects.revokeFriendShares(userId, req.params.id),
      );
      res.json({ ok: true });
    }),
  );
}
