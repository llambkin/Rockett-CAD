import { useEffect, useState, type ReactNode } from "react";
import type { FolderTree, ProjectSummary } from "@rockett/shared";
import { api } from "../api";
import {
  deleteBrowserProject,
  downloadBrowserProject,
  duplicateBrowserProject,
  formatSize,
  moveToBrowser,
  renameBrowserProject,
  storageLine,
  type BrowserProject,
  type StorageLine,
} from "../browserProjects";
import { openBrowserProject } from "../browserSession";
import { ICONS } from "../icons";
import { useSession } from "../session";
import {
  itemCount,
  projectView,
  THIS_BROWSER,
  trail,
  type Item,
} from "../projectTree";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { ProjectBreadcrumb, type DropTarget } from "./ProjectBreadcrumb";
import { MoveDialog } from "./MoveDialog";
import { useDragMove, useOwnership } from "./dragMove";
import { RenameInput } from "./RenameInput";
import {
  editedAt,
  useSnapshotPeek,
  type SnapshotTarget,
} from "./SnapshotPopover";
import {
  deleteAction,
  projectActions,
  type Point,
  type RowAction,
  type Run,
} from "./projectActions";
import { BrowserShareDialog, ShareDialog } from "./ShareDialog";
import { confirm } from "./ConfirmPanel";

export type Renaming = Pick<Item, "kind" | "id"> | null;

type Moving = { item: Item; at: Point } | null;

type Menu = { x: number; y: number; items: MenuItem[] } | null;

function ItemRow({
  item,
  meta,
  glyph,
  dimmed = false,
  renaming = false,
  actions,
  drop = { active: false },
  onOpen,
  onRename = () => {},
  onMenu,
  drag,
  snapshot,
}: {
  item: Item;
  meta: ReactNode;
  glyph?: ReactNode;
  dimmed?: boolean;
  renaming?: boolean;
  actions: RowAction[];
  drop?: DropTarget;
  onOpen?: () => void;
  onRename?: (name: string | null) => void;
  onMenu: (menu: Menu) => void;
  drag?: ReturnType<ReturnType<typeof useDragMove>["source"]>;
  snapshot?: SnapshotTarget | undefined;
}) {
  const { active, ...dropHandlers } = drop;
  const peek = useSnapshotPeek(snapshot);
  return (
    <div
      className={`project-row${active ? " drop-target" : ""}${dimmed ? " dimmed" : ""}`}
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
              action: () => a.run({ x: e.clientX, y: e.clientY }),
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
          {...peek.handlers}
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
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            a.run({ x: r.left, y: r.bottom });
          }}
        >
          {a.glyph}
        </button>
      ))}
      {peek.popover}
    </div>
  );
}

const features = (p: Pick<ProjectSummary, "featureCount" | "modifiedAt">) =>
  `${p.featureCount} features · ${editedAt(p.modifiedAt)}`;

const unreadable = (p: ProjectSummary) =>
  p.status === "tooNew"
    ? `Saved by a newer Rockett (schema ${p.schemaVersion})`
    : p.status === "invalid"
      ? (p.error ?? "This project could not be read.")
      : null;

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

const BrowserGlyph = ICONS.browser;

const intoBrowser = async (item: Item, run: Run, at?: Point) =>
  (await confirm(
    `Move "${item.name}" to this browser? Other users lose access, and clearing this site's data deletes it.`,
    at,
  )) && run(moveToBrowser(item.id, item.name));

const moveTo = (item: Item, open: (moving: Moving) => void): RowAction => ({
  label: "Move to…",
  glyph: "⇥",
  run: (at) => open({ item, at }),
});

type ProjectItemsProps = {
  controls?: ReactNode;
  filter?: string;
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
};

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
  controls,
  filter = "",
}: ProjectItemsProps) {
  const [menu, setMenu] = useState<Menu>(null);
  const [moving, setMoving] = useState<Moving>(null);
  const [sharing, setSharing] = useState<Item | null>(null);
  const { actor, manages, offersBrowser } = useOwnership(projects);
  const move = (item: Item, target: string | null, at?: Point) =>
    target !== THIS_BROWSER
      ? run(
          item.kind === "project"
            ? api.placeProject(item.id, target)
            : api.moveFolder(item.id, target),
        )
      : void intoBrowser(item, run, at);
  const { source, target } = useDragMove(tree, move, offersBrowser);
  const rename = (item: Item) => (name: string | null) => {
    setRenaming(null);
    if (name === null) return;
    run(
      item.kind === "project"
        ? api.renameProject(item.id, name)
        : api.renameFolder(item.id, name),
    );
  };
  const row = (
    item: Item,
    meta: string,
    actions: RowAction[],
    snapshot?: SnapshotTarget,
  ) => (
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
      snapshot={snapshot}
    />
  );
  const { folders, here, pinned, meta, empty } = projectView(
    tree,
    projects,
    folderId,
    kept,
    filter,
  );
  return (
    <>
      <ProjectBreadcrumb
        folders={trail(tree, folderId)}
        onOpen={onOpenFolder}
        target={target}
      />
      {controls}
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
        return row(item, meta(item, count(n, "item")), [
          { label: "Rename", glyph: "✎", run: () => setRenaming(item) },
          ...(manages(f.owner)
            ? [{ label: "Share", glyph: "♧", run: () => setSharing(item) }]
            : []),
          moveTo(item, setMoving),
          {
            label: "Delete",
            glyph: "✕",
            danger: true,
            run: async (at) =>
              (n > 0 || (await confirm(`Delete folder "${f.name}"?`, at))) &&
              run(api.deleteFolder(f.id)),
          },
        ]);
      })}
      {here.map((p) => {
        const item: Item = { kind: "project", ...p };
        const reason = unreadable(p);
        if (reason !== null)
          return (
            <ItemRow
              key={`project:${p.id}`}
              item={item}
              meta={meta(
                item,
                `${reason} · Owner: ${p.ownerName ?? "Unclaimed"}`,
              )}
              dimmed
              snapshot={p}
              actions={[
                deleteAction(p.name, run, () =>
                  api.deleteProject(p.id, false, p.deleteTag ?? p.revision),
                ),
              ]}
              onMenu={setMenu}
            />
          );
        return row(
          item,
          meta(item, `${features(p)} · Owner: ${p.ownerName ?? "Unclaimed"}`),
          projectActions(
            p.name,
            run,
            {
              rename: () => setRenaming(item),
              duplicate: () => api.duplicateProject(p.id),
              download: () => api.downloadProjectFile(p.id),
              remove: () =>
                api.deleteProject(p.id, false, p.deleteTag ?? p.revision),
            },
            [
              ...(manages(p.owner)
                ? [{ label: "Share", glyph: "♧", run: () => setSharing(item) }]
                : []),
              moveTo(item, setMoving),
            ],
          ),
          p,
        );
      })}
      {folders.length + here.length + (pinned ?? 0) === 0 && (
        <div className="tree-empty">{empty}</div>
      )}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {moving && (
        <MoveDialog
          tree={tree}
          item={moving.item}
          at={moving.at}
          browser={offersBrowser(moving.item)}
          onMove={(t) => {
            setMoving(null);
            move(moving.item, t, moving.at);
          }}
          onClose={() => setMoving(null)}
        />
      )}
      {sharing && actor && (
        <ShareDialog
          target={sharing}
          actor={actor}
          onSaved={() => {
            setSharing(null);
            run(Promise.resolve());
          }}
          onClose={() => setSharing(null)}
        />
      )}
    </>
  );
}

function StorageStatus({ records }: { records: BrowserProject[] }) {
  const [line, setLine] = useState<StorageLine>();
  useEffect(() => void storageLine().then(setLine), [records]);
  return (
    line && (
      <div className={line.warn ? "storage-line warn" : "storage-line"}>
        {line.text}
      </div>
    )
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
  const [moving, setMoving] = useState<Moving>(null);
  const [sharing, setSharing] = useState<
    BrowserProject | { id: string; name: string } | null
  >(null);
  const session = useSession();
  const actor = session.kind === "signed-in" ? session.user : null;
  return (
    <>
      <ProjectBreadcrumb
        folders={[{ id: THIS_BROWSER, name: "This browser" }]}
        onOpen={onOpenFolder}
        target={() => ({ active: false })}
      />
      <StorageStatus records={records} />
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
            meta={`${features(r)} · ${formatSize(r.size)}`}
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
              [
                { label: "Share", glyph: "♧", run: () => setSharing(r) },
                moveTo(item, setMoving),
              ],
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
          item={moving.item}
          at={moving.at}
          onMove={(t) => {
            setMoving(null);
            const r = records.find((x) => x.key === moving.item.id);
            if (r) onMove(r, t);
          }}
          onClose={() => setMoving(null)}
        />
      )}
      {sharing &&
        actor &&
        ("key" in sharing ? (
          <BrowserShareDialog
            project={sharing}
            onMoved={(id) => {
              setSharing({ id, name: sharing.name });
              run(Promise.resolve());
            }}
            onClose={() => setSharing(null)}
          />
        ) : (
          <ShareDialog
            target={{ kind: "project", ...sharing }}
            actor={actor}
            onSaved={() => {
              setSharing(null);
              run(Promise.resolve());
            }}
            onClose={() => setSharing(null)}
          />
        ))}
    </>
  );
}
