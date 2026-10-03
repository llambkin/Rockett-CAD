import { useState } from "react";
import type { User } from "@rockett/shared";
import { openTotpScreen, signOut, useSession } from "../session";
import { useStore } from "../store";
import { MenuButton, type MenuItem } from "./ContextMenu";
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
  const [passwordOpen, setPasswordOpen] = useState(false);
  const setError = useStore((state) => state.setError);
  const { count, items: noticeItems } = useNoticeItems(user.id, setError);

  const items: MenuItem[] = [
    ...noticeItems,
    { label: "Change password", action: () => setPasswordOpen(true) },
  ];
  if (!(user.totp && user.role === "admin"))
    items.push({
      label: user.totp ? "Turn off TOTP" : "Turn on TOTP",
      action: () =>
        void openTotpScreen().catch((error) => setError(error.message)),
    });
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
      <MenuButton
        label={`${user.displayName}${count ? ` (${count})` : ""}`}
        items={items}
      />
      <SettingsButton />
      {passwordOpen && (
        <PasswordDialog onClose={() => setPasswordOpen(false)} />
      )}
    </>
  );
}
