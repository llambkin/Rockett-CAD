import { useState, type FormEvent } from "react";
import { ApiError } from "../api";
import { completeSetup, signIn, type Session } from "../session";

function authError(failure: unknown, setup: boolean): string {
  if (failure instanceof ApiError && failure.status === 429)
    return failure.retryAfter
      ? `Too many attempts. Try again in ${failure.retryAfter} seconds.`
      : "Too many attempts. Try again later.";
  if (!setup && failure instanceof ApiError && failure.status === 401)
    return "Incorrect username or password.";
  return failure instanceof Error ? failure.message : "Sign in failed.";
}

function AuthField({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete: string;
}) {
  return (
    <label>
      {label}
      <input
        type={type}
        autoComplete={autoComplete}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function useAuthForm(setup: boolean) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [token, setToken] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (setup && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      if (setup) await completeSetup(token, username, displayName, password);
      else await signIn(username, password);
    } catch (failure) {
      setError(authError(failure, setup));
    } finally {
      setBusy(false);
    }
  };
  return {
    username,
    setUsername,
    password,
    setPassword,
    confirm,
    setConfirm,
    token,
    setToken,
    displayName,
    setDisplayName,
    error,
    busy,
    submit,
  };
}

function AuthForm({ setup }: { setup: boolean }) {
  const {
    username,
    setUsername,
    password,
    setPassword,
    confirm,
    setConfirm,
    token,
    setToken,
    displayName,
    setDisplayName,
    error,
    busy,
    submit,
  } = useAuthForm(setup);
  return (
    <>
      <p className="tagline">
        {setup ? "Set up Rockett CAD" : "Sign in to continue"}
      </p>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <form className="auth-form" onSubmit={(event) => void submit(event)}>
        {setup && (
          <AuthField
            label="Setup token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={setToken}
          />
        )}
        <AuthField
          label="Username"
          autoComplete="username"
          value={username}
          onChange={setUsername}
        />
        {setup && (
          <AuthField
            label="Display name"
            autoComplete="name"
            value={displayName}
            onChange={setDisplayName}
          />
        )}
        <AuthField
          label="Password"
          type="password"
          autoComplete={setup ? "new-password" : "current-password"}
          value={password}
          onChange={setPassword}
        />
        {setup && (
          <AuthField
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={setConfirm}
          />
        )}
        <button className="btn primary" disabled={busy} type="submit">
          {busy ? "Please wait…" : setup ? "Create account" : "Sign in"}
        </button>
      </form>
    </>
  );
}

export function LoginScreen({
  session,
  bootError,
  retryBoot,
}: {
  session: Exclude<Session, { kind: "signed-in" }>;
  bootError: string | null;
  retryBoot: () => void;
}) {
  return (
    <div className="project-list-page">
      <div className="project-list-card">
        <h1>
          <span className="logo">⬢</span> Rockett CAD
        </h1>
        {session.kind === "loading" ? (
          bootError ? (
            <div className="error-banner" role="alert">
              {bootError}{" "}
              <button className="btn" onClick={retryBoot}>
                Retry
              </button>
            </div>
          ) : (
            <p>Checking session…</p>
          )
        ) : session.setup === "needs-token" ? (
          <div className="error-banner" role="alert">
            Setup token is not configured on the server.
          </div>
        ) : (
          <AuthForm setup={session.setup === "ready"} />
        )}
      </div>
    </div>
  );
}
