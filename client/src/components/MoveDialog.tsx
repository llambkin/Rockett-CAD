import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { FolderTree } from "@rockett/shared";
import {
  canMoveTo,
  parentOf,
  subfolders,
  THIS_BROWSER,
  type Item,
} from "../projectTree";
import { DraggablePanel } from "./DraggablePanel";
import { DialogFooter } from "./form/DialogFooter";

export function MoveDialog({
  tree,
  item,
  at,
  onMove,
  onClose,
}: {
  tree: FolderTree;
  item: Item;
  at: { x: number; y: number };
  onMove: (target: string | null) => void;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<string | null>();
  const here = parentOf(tree, item);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = (el?: Element | null) =>
      el?.querySelector<HTMLElement>("button:not(:disabled)");
    (first(body.current) ?? first(body.current?.nextElementSibling))?.focus();
  }, []);
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
    <DraggablePanel title={`Move "${item.name}"`} at={at}>
      <div className="dialog-body" ref={body}>
        <div className="move-tree">
          {row(null, "Projects")}
          <div className="tree-children">{branch(null)}</div>
          {row(THIS_BROWSER, "This browser")}
        </div>
      </div>
      <DialogFooter
        onOk={() => target !== undefined && onMove(target)}
        onCancel={onClose}
        okLabel="Move"
        okDisabled={target === undefined}
      />
    </DraggablePanel>
  );
}
