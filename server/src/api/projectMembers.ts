import {
  ValidationError,
  type ProjectMember,
  type User,
} from "@rockett/shared";
import type { NoticeStore } from "../auth/noticeStore.js";
import type { UserStore } from "../auth/userStore.js";
import type { ProjectAccess } from "../store/manifestStore.js";
import type { ProjectStore } from "../store/projectStore.js";
import type { FriendStore } from "../auth/friendStore.js";

async function updateProjectMembers(
  store: ProjectStore,
  users: UserStore,
  notices: NoticeStore | undefined,
  friends: FriendStore | undefined,
  actor: User,
  id: string,
  current: ProjectAccess,
  next: { owner: string | null; members: ProjectMember[] },
): Promise<void> {
  const active = (await users.list()).filter(
    (user) => user.status === "active",
  );
  const ids = new Set(active.map((user) => user.id));
  const { owner, members } = next;
  if (current.owner !== null && owner === null)
    throw new ValidationError("owned project cannot become unclaimed");
  if (
    (owner !== null && !ids.has(owner)) ||
    members.some(
      (member) => !ids.has(member.userId) || member.userId === owner,
    ) ||
    new Set(members.map((member) => member.userId)).size !== members.length
  )
    throw new ValidationError(
      "owner and members must be distinct active users",
    );
  if (friends && owner !== null && actor.role !== "admin") {
    const allowed = await friends.friendIds(owner);
    for (const member of members)
      if (!allowed.has(member.userId))
        throw new ValidationError("share recipients must be friends");
  }
  if (notices) {
    const previous = new Set(current.members.map((member) => member.userId));
    await Promise.all(
      members
        .filter((member) => !previous.has(member.userId))
        .map((member) => notices.reopen(member.userId, id)),
    );
  }
  await store.setProjectAccess(id, next);
}

export function projectMemberHandlers(
  store: ProjectStore,
  users?: UserStore,
  notices?: NoticeStore,
  friends?: FriendStore,
) {
  return {
    put: async (req: any, res: any, { user }: { user: User }) => {
      const current = await store.projectAccess(req.params.id);
      if (user.role !== "admin" && current.owner !== user.id)
        return void res.status(403).json({ error: "forbidden" });
      if (!users) throw new Error("user store missing");
      const next = req.body as {
        owner: string | null;
        members: ProjectMember[];
      };
      await updateProjectMembers(
        store,
        users,
        notices,
        friends,
        user,
        req.params.id,
        current,
        next,
      );
      res.json(next);
    },
    get: async (req: any, res: any, { user }: { user: User }) => {
      const access = await store.projectAccess(req.params.id);
      if (user.role !== "admin" && access.owner !== user.id)
        return void res.status(403).json({ error: "forbidden" });
      if (!users) throw new Error("user store missing");
      const active = (await users.list()).filter(
        (record) => record.status === "active",
      );
      const allowed =
        user.role === "admin" ? null : await friends?.friendIds(user.id);
      const roster = active.map((record) =>
        user.role === "admin" ||
        record.id === user.id ||
        access.members.some((member) => member.userId === record.id) ||
        allowed?.has(record.id)
          ? {
              id: record.id,
              displayName: record.displayName,
              username: record.username,
            }
          : undefined,
      );
      res.json({
        ...access,
        users: roster.filter((record) => record !== undefined),
      });
    },
  };
}
