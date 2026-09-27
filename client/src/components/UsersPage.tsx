import { useEffect, useState } from "react";
import type { User } from "@rockett/shared";
import { api } from "../api";
import { confirmSignOut, endSession, useSession } from "../session";

type Load = "loading" | "ready" | "failed";
type NewUser = Parameters<typeof api.createUser>[0];
type UserPatch = Parameters<typeof api.patchUser>[1];

function useUserList() {
  const [users, setUsers] = useState<User[]>([]);
  const [load, setLoad] = useState<Load>("loading");
  const [error, setError] = useState("");
  const loadUsers = async () => {
    setLoad("loading");
    setError("");
    try {
      setUsers(await api.listUsers());
      setLoad("ready");
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not load users.",
      );
      setLoad("failed");
    }
  };
  useEffect(() => {
    void loadUsers();
  }, []);
  const saveUser = (user: User) =>
    setUsers((current) =>
      current.some((item) => item.id === user.id)
        ? current.map((item) => (item.id === user.id ? user : item))
        : [...current, user],
    );
  return { users, load, error, setError, loadUsers, saveUser };
}

function updateOwnAccess(id: string, change: UserPatch, user: User) {
  const session = useSession.getState();
  if (session.kind !== "signed-in" || session.user.id !== id) return;
  if (change.password !== undefined || user.status === "disabled") endSession();
  else useSession.setState({ kind: "signed-in", user }, true);
}

function useUserActions(list: ReturnType<typeof useUserList>) {
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<User>): Promise<User | undefined> => {
    if (busy || list.load !== "ready") return;
    setBusy(true);
    list.setError("");
    try {
      const user = await work();
      list.saveUser(user);
      return user;
    } catch (failure) {
      list.setError(
        failure instanceof Error ? failure.message : "Could not save user.",
      );
    } finally {
      setBusy(false);
    }
  };
  const create = async (draft: NewUser) =>
    !!(await run(() => api.createUser(draft)));
  const patch = async (id: string, change: UserPatch) => {
    const session = useSession.getState();
    const self = session.kind === "signed-in" && session.user.id === id;
    if (
      self &&
      (change.password !== undefined || change.status === "disabled") &&
      !confirmSignOut()
    )
      return false;
    const user = await run(() => api.patchUser(id, change));
    if (user) updateOwnAccess(id, change, user);
    return !!user;
  };
  return { busy, create, patch };
}

function AddUserForm({
  busy,
  create,
}: {
  busy: boolean;
  create: (draft: NewUser) => Promise<boolean>;
}) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<User["role"]>("member");
  const add = async () => {
    if (
      !(await create({
        username,
        displayName,
        role,
        password,
        ...(email && { email }),
      }))
    )
      return;
    setUsername("");
    setDisplayName("");
    setEmail("");
    setPassword("");
    setRole("member");
  };
  return (
    <div className="auth-form">
      <label>
        Username
        <input
          aria-label="Username"
          autoComplete="off"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </label>
      <label>
        Display name
        <input
          aria-label="Display name"
          autoComplete="off"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </label>
      <label>
        Email
        <input
          aria-label="Email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label>
        Password
        <input
          aria-label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <label>
        Role
        <select
          aria-label="New user role"
          value={role}
          onChange={(event) => setRole(event.target.value as User["role"])}
        >
          <option value="member">member</option>
          <option value="admin">admin</option>
        </select>
      </label>
      <button
        className="btn primary"
        disabled={busy || !username || !displayName || !password}
        onClick={() => void add()}
      >
        Add user
      </button>
    </div>
  );
}

function PasswordReset({
  user,
  busy,
  patch,
  onClose,
}: {
  user: User;
  busy: boolean;
  patch: (id: string, change: UserPatch) => Promise<boolean>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const submit = async () => {
    if (await patch(user.id, { password })) onClose();
  };
  return (
    <div className="auth-form">
      <label>
        New password for {user.displayName}
        <input
          aria-label={`New password for ${user.displayName}`}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <div className="new-project">
        <button
          className="btn primary"
          disabled={busy || !password}
          onClick={() => void submit()}
        >
          Set password
        </button>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function UserRow({
  user,
  busy,
  patch,
}: {
  user: User;
  busy: boolean;
  patch: (id: string, change: UserPatch) => Promise<boolean>;
}) {
  const [resetOpen, setResetOpen] = useState(false);
  const [email, setEmail] = useState(user.email ?? "");
  useEffect(() => setEmail(user.email ?? ""), [user.email]);
  const toggleStatus = () => {
    if (
      user.status === "active" &&
      !window.confirm(`Disable ${user.displayName}?`)
    )
      return;
    void patch(user.id, {
      status: user.status === "active" ? "disabled" : "active",
    });
  };
  return (
    <div className="project-row">
      <div
        className={`project-open${user.status === "disabled" ? " dimmed" : ""}`}
      >
        <strong>{user.displayName}</strong>
        <span>
          {user.username} · {user.status}
        </span>
        <label>
          Email for {user.displayName}
          <input
            aria-label={`Email for ${user.displayName}`}
            type="email"
            value={email}
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <button
          className="btn"
          disabled={busy || email === (user.email ?? "")}
          onClick={() => void patch(user.id, { email: email || null })}
        >
          Save email for {user.displayName}
        </button>
        <div className="new-project" style={{ flexWrap: "wrap" }}>
          <select
            aria-label={`Role for ${user.displayName}`}
            disabled={busy}
            value={user.role}
            onChange={(event) =>
              void patch(user.id, { role: event.target.value as User["role"] })
            }
          >
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
          <button className="btn" disabled={busy} onClick={toggleStatus}>
            {user.status === "active"
              ? `Disable ${user.displayName}`
              : `Enable ${user.displayName}`}
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() => setResetOpen(true)}
          >
            Set password for {user.displayName}
          </button>
        </div>
        {resetOpen && (
          <PasswordReset
            user={user}
            busy={busy}
            patch={patch}
            onClose={() => setResetOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

export function UsersPage({ onClose }: { onClose: () => void }) {
  const list = useUserList();
  const actions = useUserActions(list);
  return (
    <div className="project-list-page">
      <div className="project-list-card">
        <h1>Users</h1>
        <button className="btn" onClick={onClose}>
          Back
        </button>
        {list.error && (
          <div className="error-banner" role="alert">
            {list.error}
          </div>
        )}
        <AddUserForm
          busy={list.load !== "ready" || actions.busy}
          create={actions.create}
        />
        <div className="projects">
          {list.load === "loading" && (
            <div className="tree-empty">Loading users…</div>
          )}
          {list.load === "failed" && (
            <button className="btn" onClick={() => void list.loadUsers()}>
              Retry users
            </button>
          )}
          {list.load === "ready" && list.users.length === 0 && (
            <div className="tree-empty">No users yet.</div>
          )}
          {list.load === "ready" &&
            list.users.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                busy={actions.busy}
                patch={actions.patch}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
