import type { HTMLAttributes } from "react";
import type { Folder } from "@rockett/shared";

export type DropTarget = HTMLAttributes<HTMLElement> & { active: boolean };

export function ProjectBreadcrumb({
  folders,
  onOpen,
  target,
}: {
  folders: Pick<Folder, "id" | "name">[];
  onOpen: (id: string | null) => void;
  target: (id: string | null) => DropTarget;
}) {
  const crumbs = [{ id: null, name: "Projects" }, ...folders];
  const current = crumbs.pop()!;
  return (
    <div className="breadcrumb">
      {crumbs.map((c) => {
        const { active, ...drop } = target(c.id);
        return (
          <button
            key={c.id ?? ""}
            className={active ? "drop-target" : undefined}
            onClick={() => onOpen(c.id)}
            {...drop}
          >
            {c.name}
          </button>
        );
      })}
      <span>{current.name}</span>
    </div>
  );
}
