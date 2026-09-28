import {
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { ApiError } from "../api";
import {
  cancelTotp,
  completeSetup,
  signIn,
  submitTotpCode,
  type Session,
  type TotpScreen,
} from "../session";
import { QrCode } from "./QrCode";

interface WrongCredential {
  status: number;
  message: string;
}

const WRONG_PASSWORD: WrongCredential = {
  status: 401,
  message: "Incorrect username or password.",
};
const WRONG_CODE: WrongCredential = { status: 403, message: "Incorrect code." };

function authError(failure: unknown, wrong: WrongCredential | null): string {
  if (failure instanceof ApiError && failure.status === 429)
    return failure.retryAfter
      ? `Too many attempts. Try again in ${failure.retryAfter} seconds.`
      : "Too many attempts. Try again later.";
  if (wrong && failure instanceof ApiError && failure.status === wrong.status)
    return wrong.message;
  return failure instanceof Error ? failure.message : "Sign in failed.";
}

function useAuthSubmit(wrong: WrongCredential | null) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await work();
    } catch (failure) {
      setError(authError(failure, wrong));
    } finally {
      setBusy(false);
    }
  };
  const submit = (work: () => Promise<void>) => (event: FormEvent) => {
    event.preventDefault();
    void run(work);
  };
  return { error, busy, run, submit };
}

function AuthError({ message }: { message: string | null }) {
  return (
    message && (
      <div className="error-banner" role="alert">
        {message}
      </div>
    )
  );
}

function AuthField({
  label,
  onChange,
  type = "text",
  ...input
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
  autoComplete: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "onChange">) {
  return (
    <label>
      {label}
      <input
        type={type}
        required
        onChange={(event) => onChange(event.target.value)}
        {...input}
      />
    </label>
  );
}

function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="project-list-page">
      <div className="project-list-card">
        <h1>
          <span className="logo">⬢</span> Rockett CAD
        </h1>
        {children}
      </div>
    </div>
  );
}

function useAuthForm(setup: boolean) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [token, setToken] = useState("");
  const [displayName, setDisplayName] = useState("");
  const { error, busy, submit } = useAuthSubmit(setup ? null : WRONG_PASSWORD);
  const send = submit(async () => {
    if (!setup) return signIn(username, password);
    if (password !== confirm) throw new Error("Passwords do not match.");
    await completeSetup(token, username, displayName, password);
  });
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
    send,
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
    send,
  } = useAuthForm(setup);
  return (
    <>
      <p className="tagline">
        {setup ? "Set up Rockett CAD" : "Sign in to continue"}
      </p>
      <AuthError message={error} />
      <form className="auth-form" onSubmit={send}>
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

function TotpForm({
  screen,
  tagline,
  submitLabel,
}: {
  screen: TotpScreen;
  tagline: string;
  submitLabel: string;
}) {
  const [code, setCode] = useState("");
  const { error, busy, run, submit } = useAuthSubmit(WRONG_CODE);
  return (
    <>
      <p className="tagline">{tagline}</p>
      <AuthError message={error} />
      <form className="auth-form" onSubmit={submit(() => submitTotpCode(code))}>
        {screen.kind === "enrol" && (
          <>
            <QrCode text={screen.enrolment.uri} label="TOTP setup QR code" />
            <p>
              Key: <code>{screen.enrolment.secret}</code>
            </p>
            <a className="btn" href={screen.enrolment.uri}>
              Open in an authenticator app
            </a>
          </>
        )}
        <AuthField
          label="Code"
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={setCode}
        />
        <button className="btn primary" disabled={busy} type="submit">
          {busy ? "Please wait…" : submitLabel}
        </button>
        <button
          className="btn"
          disabled={busy}
          type="button"
          onClick={() => void run(cancelTotp)}
        >
          Cancel
        </button>
      </form>
    </>
  );
}

const SCAN =
  "Scan the code with an authenticator app, then enter the 6-digit code it shows.";

const SIGN_IN_TEXT = {
  code: {
    tagline: "Enter the 6-digit code from your authenticator app.",
    submitLabel: "Sign in",
  },
  enrol: {
    tagline: `Admins sign in with TOTP. ${SCAN}`,
    submitLabel: "Turn on TOTP",
  },
};

const ACCOUNT_TEXT = {
  code: {
    tagline: "Enter a current code to turn TOTP off.",
    submitLabel: "Turn off TOTP",
  },
  enrol: { tagline: SCAN, submitLabel: "Turn on TOTP" },
};

export function AccountTotp({ screen }: { screen: TotpScreen }) {
  return (
    <AuthCard>
      <TotpForm screen={screen} {...ACCOUNT_TEXT[screen.kind]} />
    </AuthCard>
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
    <AuthCard>
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
      ) : session.kind === "signing-in" ? (
        <TotpForm
          screen={session.screen}
          {...SIGN_IN_TEXT[session.screen.kind]}
        />
      ) : session.setup === "needs-token" ? (
        <div className="error-banner" role="alert">
          Setup token is not configured on the server.
        </div>
      ) : (
        <AuthForm setup={session.setup === "ready"} />
      )}
    </AuthCard>
  );
}
