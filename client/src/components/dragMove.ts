import { useState, type DragEvent } from "react";
import type { FolderTree, ProjectSummary } from "@rockett/shared";
import { canMoveTo, THIS_BROWSER, type Item } from "../projectTree";
import { useSession } from "../session";
import type { Point } from "./projectActions";

export function useOwnership(projects: ProjectSummary[]) {
  const session = useSession();
  const actor = session.kind === "signed-in" ? session.user : null;
  const manages = (owner?: string | null) =>
    actor !== null && (actor.role === "admin" || owner === actor.id);
  const offersBrowser = (item: Item) =>
    item.kind === "folder" ||
    manages(projects.find((p) => p.id === item.id)?.owner);
  return { actor, manages, offersBrowser };
}

export function useDragMove(
  tree: FolderTree,
  move: (item: Item, target: string | null, at?: Point) => void,
  offersBrowser: (item: Item) => boolean,
) {
  const [dragged, setDragged] = useState<Item | null>(null);
  const [over, setOver] = useState<string | null>();
  const end = () => {
    setDragged(null);
    setOver(undefined);
  };
  const source = (item: Item) => ({
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData("text/plain", item.name);
      e.dataTransfer.effectAllowed = "move";
      setDragged(item);
    },
    onDragEnd: end,
  });
  const target = (id: string | null) => {
    if (
      !dragged ||
      !canMoveTo(tree, dragged, id) ||
      (id === THIS_BROWSER && !offersBrowser(dragged))
    )
      return { active: false };
    const hold = (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOver(id);
    };
    return {
      active: over === id,
      onDragEnter: hold,
      onDragOver: hold,
      onDragLeave: (e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setOver(undefined);
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        end();
        move(dragged, id, { x: e.clientX, y: e.clientY });
      },
    };
  };
  return { source, target };
}
