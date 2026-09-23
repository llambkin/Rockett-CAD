import { Fragment, useState, type ReactNode } from "react";
import type { FolderTree } from "@rockett/shared";
import { canMoveTo, parentOf, subfolders, type Item } from "../projectTree";
import { DraggablePanel } from "./DraggablePanel";

export function MoveDialog({
  tree,
  item,
  onMove,
  onClose,
}: {
  tree: FolderTree;
  item: Item;
  onMove: (target: string | null) => void;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<string | null>();
  const here = parentOf(tree, item);
  const row = (id: string | null, name: string) => {
    const allowed = canMoveTo(tree, item, id);
    const self = item.kind === "folder" && id === item.id;
    const note = id === here ? " (here)" : self ? " (this folder)" : "";
    return (
      <button
        className={`tree-item${allowed ? "" : " dimmed"}${target === id ? " selected" : ""}`}
        disabled={!allowed}
        onClick={() => setTarget(id)}
      >
        {name}
        {note}
      </button>
    );
  };
  const branch = (parentId: string | null): ReactNode =>
    subfolders(tree, parentId).map((f) => (
      <Fragment key={f.id}>
        {row(f.id, f.name)}
        <div className="tree-children">{branch(f.id)}</div>
      </Fragment>
    ));
  return (
    <DraggablePanel title={`Move "${item.name}"`}>
      <div className="dialog-body">
        <div className="move-tree">
          {row(null, "Projects")}
          <div className="tree-children">{branch(null)}</div>
        </div>
      </div>
      <div className="dialog-actions">
        <button
          className="btn primary"
          disabled={target === undefined}
          onClick={() => target !== undefined && onMove(target)}
        >
          Move
        </button>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </DraggablePanel>
  );
}
