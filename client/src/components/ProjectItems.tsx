import { useState, type DragEvent, type ReactNode } from "react";
import type { Folder, FolderTree, ProjectSummary } from "@rockett/shared";
import { api, saveDownload, type Download } from "../api";
import {
  deleteBrowserProject,
  downloadBrowserProject,
  duplicateBrowserProject,
  moveToBrowser,
  renameBrowserProject,
  type BrowserProject,
} from "../browserProjects";
import { openBrowserProject } from "../browserSession";
import { ICONS } from "../icons";
import {
  canMoveTo,
  itemCount,
  projectsIn,
  subfolders,
  THIS_BROWSER,
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

function ItemRow({
  item,
  meta,
  glyph,
  renaming = false,
  actions,
  drop = { active: false },
  onOpen,
  onRename = () => {},
  onMenu,
  drag,
}: {
  item: Item;
  meta: ReactNode;
  glyph?: ReactNode;
  renaming?: boolean;
  actions: RowAction[];
  drop?: DropTarget;
  onOpen?: () => void;
  onRename?: (name: string | null) => void;
  onMenu: (menu: Menu) => void;
  drag?: ReturnType<ReturnType<typeof useDragMove>["source"]>;
}) {
  const { active, ...dropHandlers } = drop;
  return (
    <div
      className={active ? "project-row drop-target" : "project-row"}
      draggable={drag !== undefined && !renaming}
      {...drag}
      {...dropHandlers}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({
          x: e.clientX,
          y: e.clientY,
          items: [
            ...(onOpen ? [{ label: "Open", action: onOpen }] : []),
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
          className={`project-open${glyph ? " folder-open" : ""}`}
          disabled={!onOpen}
          onClick={onOpen}
          onDoubleClick={(e) => e.preventDefault()}
        >
          {glyph && (
            <span className="tree-icon" aria-hidden="true">
              {glyph}
            </span>
          )}
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

const features = (p: Pick<ProjectSummary, "featureCount" | "modifiedAt">) =>
  `${p.featureCount} features · ${new Date(p.modifiedAt).toLocaleString()}`;

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

function size(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let unit = 0;
  for (; n >= 1024 && unit < units.length - 1; unit++) n /= 1024;
  return unit === 0 ? `${n} B` : `${n.toFixed(1)} ${units[unit]}`;
}

type Run = (work: Promise<unknown>) => void;

function projectActions(
  name: string,
  run: Run,
  ops: {
    rename: () => void;
    duplicate: () => Promise<unknown>;
    download: () => Promise<Download>;
    remove: () => Promise<unknown>;
  },
  moveTo: RowAction[] = [],
): RowAction[] {
  return [
    { label: "Rename", glyph: "✎", run: ops.rename },
    { label: "Duplicate", glyph: "⎘", run: () => run(ops.duplicate()) },
    {
      label: "Download",
      glyph: "⤓",
      title: "Download project file",
      run: () => run(ops.download().then(saveDownload)),
    },
    ...moveTo,
    {
      label: "Delete",
      glyph: "✕",
      danger: true,
      run: () => {
        if (window.confirm(`Delete project "${name}"?`)) run(ops.remove());
      },
    },
  ];
}

const BrowserGlyph = ICONS.browser;

const confirmIntoBrowser = (name: string) =>
  window.confirm(
    `Move "${name}" to this browser? Other users lose access, and clearing this site's data deletes it.`,
  );

const moveTo = (item: Item, open: (item: Item) => void): RowAction => ({
  label: "Move to…",
  glyph: "⇥",
  run: () => open(item),
});

export function ProjectItems({
  projects,
  tree,
  folderId,
  kept,
  renaming,
  setRenaming,
  onOpenFolder,
  onOpenBrowser,
  onOpenProject,
  run,
}: {
  projects: ProjectSummary[];
  tree: FolderTree;
  folderId: string | null;
  kept: number | null;
  renaming: Renaming;
  setRenaming: (r: Renaming) => void;
  onOpenFolder: (id: string | null) => void;
  onOpenBrowser: () => void;
  onOpenProject: (id: string) => void;
  run: Run;
}) {
  const [menu, setMenu] = useState<Menu>(null);
  const [moving, setMoving] = useState<Item | null>(null);
  const move = (item: Item, target: string | null) =>
    target !== THIS_BROWSER
      ? run(
          item.kind === "project"
            ? api.placeProject(item.id, target)
            : api.moveFolder(item.id, target),
        )
      : confirmIntoBrowser(item.name) && run(moveToBrowser(item.id, item.name));
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
      glyph={item.kind === "folder" && "▣"}
      renaming={renaming?.kind === item.kind && renaming.id === item.id}
      actions={actions}
      drop={item.kind === "folder" ? target(item.id) : { active: false }}
      onOpen={() =>
        item.kind === "folder" ? onOpenFolder(item.id) : onOpenProject(item.id)
      }
      onRename={rename(item)}
      onMenu={setMenu}
      drag={source(item)}
    />
  );
  const folders = subfolders(tree, folderId);
  const here = projectsIn(tree, projects, folderId);
  const pinned = folderId === null ? kept : null;
  return (
    <>
      <Breadcrumb
        folders={trail(tree, folderId)}
        onOpen={onOpenFolder}
        target={target}
      />
      {pinned !== null && (
        <ItemRow
          item={{ kind: "folder", id: THIS_BROWSER, name: "This browser" }}
          meta={count(pinned, "project")}
          glyph={<BrowserGlyph />}
          actions={[]}
          drop={target(THIS_BROWSER)}
          onOpen={onOpenBrowser}
          onMenu={setMenu}
        />
      )}
      {folders.map((f) => {
        const item: Item = { kind: "folder", ...f };
        const n = itemCount(tree, projects, f.id);
        return row(item, count(n, "item"), [
          { label: "Rename", glyph: "✎", run: () => setRenaming(item) },
          moveTo(item, setMoving),
          {
            label: "Delete",
            glyph: "✕",
            danger: true,
            run: () => {
              if (n === 0 && !window.confirm(`Delete folder "${f.name}"?`))
                return;
              run(api.deleteFolder(f.id));
            },
          },
        ]);
      })}
      {here.map((p) => {
        const item: Item = { kind: "project", ...p };
        return row(
          item,
          features(p),
          projectActions(
            p.name,
            run,
            {
              rename: () => setRenaming(item),
              duplicate: () => api.duplicateProject(p.id),
              download: () => api.downloadProjectFile(p.id),
              remove: () => api.deleteProject(p.id),
            },
            [moveTo(item, setMoving)],
          ),
        );
      })}
      {folders.length + here.length + (pinned ?? 0) === 0 && (
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

export function BrowserItems({
  records,
  tree,
  renaming,
  setRenaming,
  onOpenFolder,
  onMove,
  run,
}: {
  records: BrowserProject[];
  tree: FolderTree;
  renaming: Renaming;
  setRenaming: (r: Renaming) => void;
  onOpenFolder: (id: string | null) => void;
  onMove: (r: BrowserProject, folderId: string | null) => void;
  run: Run;
}) {
  const [menu, setMenu] = useState<Menu>(null);
  const [moving, setMoving] = useState<Item | null>(null);
  return (
    <>
      <Breadcrumb
        folders={[{ id: THIS_BROWSER, name: "This browser" }]}
        onOpen={onOpenFolder}
        target={() => ({ active: false })}
      />
      {records.map((r) => {
        const item: Item = {
          kind: "project",
          id: r.key,
          name: r.name,
          inBrowser: true,
        };
        return (
          <ItemRow
            key={r.key}
            item={item}
            meta={`${features(r)} · ${size(r.size)}`}
            renaming={renaming?.kind === "project" && renaming.id === r.key}
            actions={projectActions(
              r.name,
              run,
              {
                rename: () => setRenaming(item),
                duplicate: () => duplicateBrowserProject(r.key),
                download: () => downloadBrowserProject(r),
                remove: () => deleteBrowserProject(r.key),
              },
              [moveTo(item, setMoving)],
            )}
            onOpen={() => void openBrowserProject(r.key)}
            onRename={(name) => {
              setRenaming(null);
              if (name !== null) run(renameBrowserProject(r.key, name));
            }}
            onMenu={setMenu}
          />
        );
      })}
      {records.length === 0 && (
        <div className="tree-empty">No projects in this browser yet.</div>
      )}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {moving && (
        <MoveDialog
          tree={tree}
          item={moving}
          onMove={(t) => {
            setMoving(null);
            const r = records.find((x) => x.key === moving.id);
            if (r) onMove(r, t);
          }}
          onClose={() => setMoving(null)}
        />
      )}
    </>
  );
}
