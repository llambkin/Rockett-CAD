import { useEffect, useState } from "react";
import { ROUTES, type ProjectMember } from "@rockett/shared";
import { api, send } from "../api";
import { moveToServer, type BrowserProject } from "../browserProjects";
import { DraggablePanel } from "./DraggablePanel";
import { DialogFooter } from "./form/DialogFooter";

type Target = { kind: "project" | "folder"; id: string; name: string };

export function BrowserShareDialog({
  project,
  onMoved,
  onClose,
}: {
  project: BrowserProject;
  onMoved: (id: string) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const move = async () => {
    setPending(true);
    setError(null);
    try {
      onMoved(await moveToServer(project, null));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  return (
    <DraggablePanel id="dialog.shareBrowser" title={`Share "${project.name}"`}>
      <div className="dialog-body">
        {error && <div className="error-banner">{error}</div>}
        <div className="measure-row">
          Move this project to the server before sharing it.
        </div>
      </div>
      <DialogFooter
        onOk={() => void move()}
        onCancel={onClose}
        okLabel="Move to server"
        pending={pending}
      />
    </DraggablePanel>
  );
}

const getMembers = (target: Target) =>
  target.kind === "project"
    ? api.getProjectMembers(target.id)
    : send(ROUTES.getFolderMembers, { id: target.id });

const saveMembers = (
  target: Target,
  owner: string | null,
  members: ProjectMember[],
) =>
  target.kind === "project"
    ? api.projectMembers(target.id, owner, members)
    : send(
        ROUTES.folderMembers,
        { id: target.id },
        { body: { owner, members } },
      );

export function ShareDialog({
  target,
  actor,
  onSaved,
  onClose,
}: {
  target: Target;
  actor: { id: string; role: "admin" | "member" };
  onSaved: () => void;
  onClose: () => void;
}) {
  const [roster, setRoster] = useState<Awaited<
    ReturnType<typeof api.getProjectMembers>
  > | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    void getMembers(target).then(
      (access) => {
        setRoster(access);
        setOwner(access.owner);
        const active = new Set(access.users.map((user) => user.id));
        setMembers(
          access.members.filter((member) => active.has(member.userId)),
        );
      },
      (e) => setError(e.message),
    );
  }, [target.id, target.kind]);
  const choose = (userId: string, role: "view" | "edit" | "none") =>
    setMembers((current) =>
      role === "none"
        ? current.filter((member) => member.userId !== userId)
        : [
            ...current.filter((member) => member.userId !== userId),
            { userId, role },
          ],
    );
  const save = async () => {
    setPending(true);
    setError(null);
    try {
      await saveMembers(target, owner, members);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  return (
    <DraggablePanel id="dialog.share" title={`Share "${target.name}"`}>
      <div className="dialog-body">
        {error && <div className="error-banner">{error}</div>}
        {!roster && !error && <div className="tree-empty">Loading people…</div>}
        {roster && (
          <>
            <div className="measure-row">
              Owner:{" "}
              {roster.users.find((user) => user.id === owner)?.displayName ??
                owner ??
                "Unclaimed"}
            </div>
            {roster.owner === null &&
              actor.role === "admin" &&
              owner === null && (
                <button
                  className="btn"
                  onClick={() => {
                    setOwner(actor.id);
                    setMembers((current) =>
                      current.filter((member) => member.userId !== actor.id),
                    );
                  }}
                >
                  Claim {target.kind}
                </button>
              )}
            {roster.users.filter((user) => user.id !== owner).length === 0 && (
              <div className="tree-empty">No other active people</div>
            )}
            {roster.users
              .filter((user) => user.id !== owner)
              .map((user) => (
                <label className="field" key={user.id}>
                  <span>
                    {user.displayName} ({user.username})
                  </span>
                  <select
                    aria-label={`Access for ${user.displayName}`}
                    value={
                      members.find((member) => member.userId === user.id)
                        ?.role ?? "none"
                    }
                    onChange={(e) =>
                      choose(
                        user.id,
                        e.target.value as "none" | "view" | "edit",
                      )
                    }
                  >
                    <option value="none">No access</option>
                    <option value="view">View</option>
                    <option value="edit">Edit</option>
                  </select>
                </label>
              ))}
          </>
        )}
      </div>
      <DialogFooter
        onOk={() => void save()}
        onCancel={onClose}
        okLabel="Save"
        pending={pending}
        okDisabled={!roster || owner === null}
      />
    </DraggablePanel>
  );
}
