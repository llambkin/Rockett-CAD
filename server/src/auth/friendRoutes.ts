import { Router, json, type Response } from "express";
import {
  FRIEND_ROUTES,
  NOTICE_ROUTES,
  friendRequestBody,
  parse,
  type Notice,
} from "@rockett/shared";
import { StoreError } from "../store/jsonStore.js";
import type { ProjectStore } from "../store/projectStore.js";
import type { FriendStore } from "./friendStore.js";
import type { NoticeStore } from "./noticeStore.js";
import { toPublicUser, type UserStore } from "./userStore.js";

export function createFriendRouter(
  users: UserStore,
  friends: FriendStore,
  projects: ProjectStore,
  notices: NoticeStore,
): Router {
  const router = Router();
  registerFriendList(router, users, friends);
  registerFriendActions(router, users, friends, projects);
  registerNotices(router, users, friends, projects, notices);
  return router;
}

function registerNotices(
  router: Router,
  users: UserStore,
  friends: FriendStore,
  projects: ProjectStore,
  notices: NoticeStore,
): void {
  router.get(
    NOTICE_ROUTES.list.path,
    run(async (_req, res) => {
      const user = res.locals.user;
      const requests = (await friends.list()).requests.filter(
        (request) => request.email === user.email,
      );
      const senders = new Map(
        (await users.list())
          .filter((record) => record.status === "active")
          .map((record) => [record.id, toPublicUser(record)]),
      );
      const incoming: Notice[] = requests.flatMap((request) => {
        const sender = senders.get(request.from);
        return sender
          ? [
              {
                kind: "friend",
                id: request.id,
                from: {
                  id: sender.id,
                  username: sender.username,
                  displayName: sender.displayName,
                },
              },
            ]
          : [];
      });
      const opened = await notices.opened(user.id);
      const projectsForUser: Notice[] = [];
      for (const project of await projects.list()) {
        if (project.status !== "ok" || opened.has(project.id)) continue;
        const access = await projects.projectAccess(project.id);
        if (access.members.some((member) => member.userId === user.id))
          projectsForUser.push({
            kind: "project",
            id: project.id,
            name: project.name,
          });
      }
      res.json({ items: [...incoming, ...projectsForUser] });
    }),
  );
  router.post(
    NOTICE_ROUTES.openProject.path,
    run(async (req, res) => {
      const access = await projects.projectAccess(req.params.id);
      if (
        !access.members.some((member) => member.userId === res.locals.user.id)
      )
        return void res.status(404).json({ error: "not found" });
      await notices.open(res.locals.user.id, req.params.id);
      res.json({ ok: true });
    }),
  );
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
