import { useEffect, useState } from "react";
import {
  LABEL_LIMIT,
  ROUTES,
  type HistoryList,
  type HistoryMark,
} from "@rockett/shared";
import { api, send } from "../api";
import { useStore } from "../store";
import { ContextMenu } from "./ContextMenu";
import { DraggablePanel } from "./DraggablePanel";
import { DialogFooter } from "./form/DialogFooter";
import { confirm } from "./ConfirmPanel";
import { editedAt } from "./SnapshotPopover";

export function HistoryPanel({ onClose }: { onClose: () => void }) {
  const projectId = useStore((s) => s.projectId);
  const revision = useStore((s) => s.document?.revision);
  const canEdit = useStore((s) => s.access !== "view");
  const [list, setList] = useState<HistoryList | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (id: string) =>
    api.history(id).then(
      (next) => {
        if (useStore.getState().projectId !== id) return;
        setList(next);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );

  useEffect(() => {
    if (projectId) void load(projectId);
  }, [projectId, revision]);

  const remove = async (id: string, { label, snapshot, at }: HistoryMark) => {
    if (
      !(await confirm(`Delete checkpoint "${label}"? This cannot be undone.`))
    )
      return;
    try {
      const body = { label, at, snapshot };
      await send(ROUTES.deleteCheckpoint, { id }, { body });
      await load(id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <DraggablePanel id="design.history" title="History">
      <div className="dialog-body">
        {error && <div className="error-banner">{error}</div>}
        {!list && !error && <div className="tree-empty">Loading history…</div>}
        {list && (
          <HistoryMarks
            list={list}
            canRestore={canEdit}
            onDelete={
              canEdit && projectId
                ? (mark) => void remove(projectId, mark)
                : undefined
            }
          />
        )}
        {canEdit && projectId && (
          <CheckpointForm
            projectId={projectId}
            reload={load}
            setError={setError}
          />
        )}
      </div>
      <DialogFooter onCancel={onClose} cancelLabel="Close history" />
    </DraggablePanel>
  );
}

function HistoryMarks({
  list,
  canRestore,
  onDelete,
}: {
  list: HistoryList;
  canRestore: boolean;
  onDelete: ((mark: HistoryMark) => void) | undefined;
}) {
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    mark: HistoryMark;
  }>();
  const current = list.entries[list.position - 1]?.snapshot;
  const menuFor =
    onDelete &&
    ((mark: HistoryMark) => (x: number, y: number) => setMenu({ x, y, mark }));
  const marks = (
    items: HistoryMark[],
    undoneFrom = Infinity,
    menuOf?: typeof menuFor,
  ) =>
    items.map((mark, i) => (
      <MarkRow
        key={i}
        mark={mark}
        current={mark.snapshot === current}
        undone={i >= undoneFrom}
        canRestore={canRestore}
        onMenu={menuOf?.(mark)}
      />
    ));
  return (
    <>
      <div className="measure-head">Entries</div>
      {list.entries.length === 0 && (
        <div className="tree-empty">No history yet</div>
      )}
      {marks(list.entries, list.position)}
      <div className="measure-head">Checkpoints</div>
      {list.checkpoints.length === 0 && (
        <div className="tree-empty">No checkpoints yet</div>
      )}
      {marks(list.checkpoints, Infinity, menuFor)}
      {menu && onDelete && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            {
              label: "Delete",
              danger: true,
              action: () => onDelete(menu.mark),
            },
          ]}
          onClose={() => setMenu(undefined)}
        />
      )}
    </>
  );
}

function CheckpointForm({
  projectId,
  reload,
  setError,
}: {
  projectId: string;
  reload: (id: string) => Promise<void>;
  setError: (error: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const save = async () => {
    setPending(true);
    setError(null);
    try {
      await api.createCheckpoint(projectId, name.trim());
      setName("");
      await reload(projectId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <label className="field">
        <span>Checkpoint name</span>
        <input
          type="text"
          aria-label="Checkpoint name"
          maxLength={LABEL_LIMIT}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button
        className="btn"
        disabled={pending || name.trim() === ""}
        onClick={() => void save()}
      >
        Save checkpoint
      </button>
    </>
  );
}

function MarkRow({
  mark,
  current,
  undone,
  canRestore,
  onMenu,
}: {
  mark: HistoryMark;
  current: boolean;
  undone: boolean;
  canRestore: boolean;
  onMenu: ((x: number, y: number) => void) | undefined;
}) {
  const busy = useStore((s) => s.busy);
  const restore = async () => {
    if (
      await confirm(
        `Restore "${mark.label}"? It becomes a new step you can undo.`,
      )
    )
      void useStore.getState().restore(mark.snapshot);
  };
  return (
    <div
      className={undone ? "measure-row dimmed" : "measure-row"}
      onContextMenu={
        onMenu &&
        ((e) => {
          e.preventDefault();
          onMenu(e.clientX, e.clientY);
        })
      }
    >
      <b>{mark.label}</b>
      <span>
        {editedAt(mark.at)}
        {mark.byName && ` · ${mark.byName}`}
      </span>
      {current ? (
        <span>current</span>
      ) : (
        canRestore && (
          <button
            className="btn"
            aria-label={`Restore ${mark.label}`}
            disabled={busy}
            onClick={restore}
          >
            Restore
          </button>
        )
      )}
    </div>
  );
}
