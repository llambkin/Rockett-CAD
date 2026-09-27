import { useState } from "react";
import { signOut, useSession } from "../session";
import { useStore } from "../store";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { PasswordDialog } from "./PasswordDialog";

export function UserMenu({ onUsers }: { onUsers?: () => void }) {
  const session = useSession();
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [passwordOpen, setPasswordOpen] = useState(false);
  const setError = useStore((state) => state.setError);
  if (session.kind !== "signed-in") return null;

  const items: MenuItem[] = [
    { label: "Change password", action: () => setPasswordOpen(true) },
  ];
  if (session.user.role === "admin")
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
        {session.user.displayName}
      </button>
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
