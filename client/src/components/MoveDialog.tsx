import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
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

function moveFocus(e: KeyboardEvent<HTMLDivElement>) {
  const rows = [
    ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
      "button:not(:disabled)",
    ),
  ];
  const index = rows.findIndex(
    (destination) => destination === document.activeElement,
  );
  if (index < 0) return;
  const positions: Record<string, number> = {
    ArrowUp: Math.max(0, index - 1),
    ArrowDown: Math.min(rows.length - 1, index + 1),
    Home: 0,
    End: rows.length - 1,
  };
  const next = positions[e.key];
  if (next === undefined) return;
  e.preventDefault();
  rows[next]?.focus();
}

export function MoveDialog({
  tree,
  item,
  at,
  browser = true,
  onMove,
  onClose,
}: {
  tree: FolderTree;
  item: Item;
  at: { x: number; y: number };
  browser?: boolean;
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
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          onMove(id);
        }}
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
    <DraggablePanel id="dialog.move" title={`Move "${item.name}"`} at={at}>
      <div className="dialog-body" ref={body} onKeyDown={moveFocus}>
        <div className="move-tree">
          {row(null, "Projects")}
          <div className="tree-children">{branch(null)}</div>
          {browser && row(THIS_BROWSER, "This browser")}
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
