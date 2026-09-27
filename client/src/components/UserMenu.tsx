import { useState } from "react";
import type { User } from "@rockett/shared";
import { signOut, useSession } from "../session";
import { useStore } from "../store";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { useNoticeItems } from "./NoticeItems";
import { PasswordDialog } from "./PasswordDialog";
import { SettingsButton } from "./SettingsPanel";

export function UserMenu({ onUsers }: { onUsers?: () => void }) {
  const session = useSession();
  if (session.kind !== "signed-in") return null;
  return (
    <SignedInUserMenu
      key={session.user.id}
      user={session.user}
      onUsers={onUsers}
    />
  );
}

function SignedInUserMenu({
  user,
  onUsers,
}: {
  user: User;
  onUsers: (() => void) | undefined;
}) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [passwordOpen, setPasswordOpen] = useState(false);
  const setError = useStore((state) => state.setError);
  const { count, items: noticeItems } = useNoticeItems(user.id, setError);

  const items: MenuItem[] = [
    ...noticeItems,
    { label: "Change password", action: () => setPasswordOpen(true) },
  ];
  if (user.role === "admin")
    items.push(
      onUsers
        ? { label: "Users", action: onUsers }
        : { label: "Users", disabled: true },
    );
  items.push({
    label: "Sign out",
    action: () => void signOut().catch((error) => setError(error.message)),
  });
  return (
    <>
      <button
        className="icon-btn"
        aria-expanded={position !== null}
        aria-haspopup="menu"
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setPosition({ x: Math.max(0, bounds.right - 150), y: bounds.bottom });
        }}
      >
        {user.displayName}
        {count ? ` (${count})` : ""}
      </button>
      <SettingsButton />
      {position && (
        <ContextMenu
          x={position.x}
          y={position.y}
          items={items}
          onClose={() => setPosition(null)}
        />
      )}
      {passwordOpen && (
        <PasswordDialog onClose={() => setPasswordOpen(false)} />
      )}
    </>
  );
}
