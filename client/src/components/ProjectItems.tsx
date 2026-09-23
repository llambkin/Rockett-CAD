import { useState, type DragEvent, type ReactNode } from "react";
import type { Folder, FolderTree, ProjectSummary } from "@rockett/shared";
import { api, saveDownload } from "../api";
import {
  canMoveTo,
  itemCount,
  projectsIn,
  subfolders,
  trail,
  type Item,
} from "../projectTree";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { MoveDialog } from "./MoveDialog";
import { RenameInput } from "./RenameInput";

export type Renaming = Pick<Item, "kind" | "id"> | null;

interface RowAction {
  label: string;
  glyph: string;
  title?: string;
  danger?: boolean;
  run: () => void;
}

type Menu = { x: number; y: number; items: MenuItem[] } | null;

function useDragMove(
  tree: FolderTree,
  move: (item: Item, target: string | null) => void,
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
    if (!dragged || !canMoveTo(tree, dragged, id)) return { active: false };
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
        move(dragged, id);
      },
    };
  };
  return { source, target };
}

type DropTarget = ReturnType<ReturnType<typeof useDragMove>["target"]>;

function Breadcrumb({
  folders,
  onOpen,
  target,
}: {
  folders: Folder[];
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

function ItemRow({
  item,
  meta,
  renaming,
  actions,
  drop,
  onOpen,
  onRename,
  onMenu,
  drag,
}: {
  item: Item;
  meta: ReactNode;
  renaming: boolean;
  actions: RowAction[];
  drop: DropTarget;
  onOpen: () => void;
  onRename: (name: string | null) => void;
  onMenu: (menu: Menu) => void;
  drag: ReturnType<ReturnType<typeof useDragMove>["source"]>;
}) {
  const { active, ...dropHandlers } = drop;
  const glyph = item.kind === "folder" && (
    <span className="tree-icon" aria-hidden="true">
      ▣
    </span>
  );
  return (
    <div
      className={active ? "project-row drop-target" : "project-row"}
      draggable={!renaming}
      {...drag}
      {...dropHandlers}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({
          x: e.clientX,
          y: e.clientY,
          items: [
            { label: "Open", action: onOpen },
            ...actions.map((a) => ({
              label: a.label,
              action: a.run,
              danger: a.danger ?? false,
            })),
          ],
        });
      }}
    >
      {renaming ? (
        <div className="project-open project-renaming">
          <RenameInput
            value={item.name}
            className="project-rename"
            label={item.kind === "folder" ? "Folder name" : "Project name"}
            onCommit={onRename}
            onCancel={() => onRename(null)}
          />
          <span>{meta}</span>
        </div>
      ) : (
        <button
          className={`project-open${item.kind === "folder" ? " folder-open" : ""}`}
          onClick={onOpen}
          onDoubleClick={(e) => e.preventDefault()}
        >
          {glyph}
          <b>{item.name}</b>
          <span>{meta}</span>
        </button>
      )}
      {actions.map((a) => (
        <button
          key={a.label}
          className={a.danger ? "icon-btn danger" : "icon-btn"}
          title={a.title ?? a.label}
          aria-label={`${a.label} ${item.name}`}
          onClick={a.run}
        >
          {a.glyph}
        </button>
      ))}
    </div>
  );
}

const features = (p: ProjectSummary) =>
  `${p.featureCount} features · ${new Date(p.modifiedAt).toLocaleString()}`;

const items = (n: number) => `${n} item${n === 1 ? "" : "s"}`;

export function ProjectItems({
  projects,
  tree,
  folderId,
  renaming,
  setRenaming,
  onOpenFolder,
  onOpenProject,
  run,
}: {
  projects: ProjectSummary[];
  tree: FolderTree;
  folderId: string | null;
  renaming: Renaming;
  setRenaming: (r: Renaming) => void;
  onOpenFolder: (id: string | null) => void;
  onOpenProject: (id: string) => void;
  run: (work: Promise<unknown>) => void;
}) {
  const [menu, setMenu] = useState<Menu>(null);
  const [moving, setMoving] = useState<Item | null>(null);
  const move = (item: Item, target: string | null) =>
    run(
      item.kind === "project"
        ? api.placeProject(item.id, target)
        : api.moveFolder(item.id, target),
    );
  const { source, target } = useDragMove(tree, move);
  const rename = (item: Item) => (name: string | null) => {
    setRenaming(null);
    if (name === null) return;
    run(
      item.kind === "project"
        ? api.renameProject(item.id, name)
        : api.renameFolder(item.id, name),
    );
  };
  const row = (item: Item, meta: string, actions: RowAction[]) => (
    <ItemRow
      key={`${item.kind}:${item.id}`}
      item={item}
      meta={meta}
      renaming={renaming?.kind === item.kind && renaming.id === item.id}
      actions={[
        { label: "Rename", glyph: "✎", run: () => setRenaming(item) },
        ...actions,
      ]}
      drop={item.kind === "folder" ? target(item.id) : { active: false }}
      onOpen={() =>
        item.kind === "folder" ? onOpenFolder(item.id) : onOpenProject(item.id)
      }
      onRename={rename(item)}
      onMenu={setMenu}
      drag={source(item)}
    />
  );
  const moveTo = (item: Item): RowAction => ({
    label: "Move to…",
    glyph: "⇥",
    run: () => setMoving(item),
  });
  const folders = subfolders(tree, folderId);
  const here = projectsIn(tree, projects, folderId);
  return (
    <>
      <Breadcrumb
        folders={trail(tree, folderId)}
        onOpen={onOpenFolder}
        target={target}
      />
      {folders.map((f) => {
        const item: Item = { kind: "folder", ...f };
        const count = itemCount(tree, projects, f.id);
        return row(item, items(count), [
          moveTo(item),
          {
            label: "Delete",
            glyph: "✕",
            danger: true,
            run: () => {
              if (count === 0 && !window.confirm(`Delete folder "${f.name}"?`))
                return;
              run(api.deleteFolder(f.id));
            },
          },
        ]);
      })}
      {here.map((p) => {
        const item: Item = { kind: "project", ...p };
        return row(item, features(p), [
          {
            label: "Duplicate",
            glyph: "⎘",
            run: () => run(api.duplicateProject(p.id)),
          },
          {
            label: "Download",
            glyph: "⤓",
            title: "Download project file",
            run: () => run(api.downloadProjectFile(p.id).then(saveDownload)),
          },
          moveTo(item),
          {
            label: "Delete",
            glyph: "✕",
            danger: true,
            run: () => {
              if (window.confirm(`Delete project "${p.name}"?`))
                run(api.deleteProject(p.id));
            },
          },
        ]);
      })}
      {folders.length + here.length === 0 && (
        <div className="tree-empty">
          {folderId === null
            ? "No projects yet"
            : "This folder is empty. Drag a project here or Move to."}
        </div>
      )}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {moving && (
        <MoveDialog
          tree={tree}
          item={moving}
          onMove={(t) => {
            setMoving(null);
            move(moving, t);
          }}
          onClose={() => setMoving(null)}
        />
      )}
    </>
  );
}
