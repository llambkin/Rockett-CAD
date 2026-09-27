import { ValidationError, type ProjectMember } from "@rockett/shared";
import type { NoticeStore } from "../auth/noticeStore.js";
import type { UserStore } from "../auth/userStore.js";
import type { ProjectAccess } from "../store/manifestStore.js";
import type { ProjectStore } from "../store/projectStore.js";

export async function updateProjectMembers(
  store: ProjectStore,
  users: UserStore,
  notices: NoticeStore | undefined,
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
