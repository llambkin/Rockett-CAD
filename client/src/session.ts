import { create } from "zustand";
import type { SignInStep, TotpEnrolment, User } from "@rockett/shared";
import { api, UnauthorizedError, watchUnauthorized } from "./api";
import { projectIdFromPath, showPath } from "./paths";
import { leaveBrowserProject } from "./browserSession";
import { browserUser } from "./browserProjects";
import { dropCameraSave } from "./cameraSave";
import { useStore } from "./store";
import { clearSettings } from "./settings";
import { confirm } from "./components/ConfirmPanel";

type Setup = Awaited<ReturnType<typeof api.authStatus>>["setup"];

export type TotpScreen =
  { kind: "code" } | { kind: "enrol"; enrolment: TotpEnrolment };

export type Session =
  | { kind: "loading" }
  | { kind: "signed-out"; setup: Setup; returnProjectId: string | null }
  | { kind: "signing-in"; screen: TotpScreen; returnProjectId: string | null }
  | { kind: "signed-in"; user: User; screen?: TotpScreen };

export const useSession = create<Session>(() => ({ kind: "loading" }));

useSession.subscribe((s) =>
  browserUser(s.kind === "signed-in" ? s.user.id : null),
);

function returnProjectId(): string | null {
  const state = useSession.getState();
  return state.kind === "signed-out" || state.kind === "signing-in"
    ? state.returnProjectId
    : (useStore.getState().projectId ??
        projectIdFromPath(window.location.pathname));
}

watchUnauthorized(() => {
  clearSettings();
  useSession.setState(
    {
      kind: "signed-out",
      setup: "done",
      returnProjectId: returnProjectId(),
    },
    true,
  );
});

export async function bootSession(): Promise<void> {
  useSession.setState({ kind: "loading" }, true);
  try {
    const user = await api.me();
    useSession.setState({ kind: "signed-in", user }, true);
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error;
    const { setup } = await api.authStatus();
    useSession.setState(
      {
        kind: "signed-out",
        setup,
        returnProjectId: returnProjectId(),
      },
      true,
    );
  }
}

async function totpScreen(step: SignInStep["step"]): Promise<TotpScreen> {
  return step === "code"
    ? { kind: "code" }
    : { kind: "enrol", enrolment: await api.totpEnrol() };
}

async function finishSignIn(user: User): Promise<void> {
  const id = returnProjectId();
  useSession.setState({ kind: "signed-in", user }, true);
  if (id !== null) await useStore.getState().openProject(id);
}

export async function signIn(
  username: string,
  password: string,
): Promise<void> {
  const result = await api.login(username, password);
  if (!("step" in result)) return finishSignIn(result);
  const returnTo = returnProjectId();
  const screen = await totpScreen(result.step);
  useSession.setState(
    { kind: "signing-in", screen, returnProjectId: returnTo },
    true,
  );
}

export async function submitTotpCode(code: string): Promise<void> {
  const session = useSession.getState();
  if (session.kind === "signing-in")
    return finishSignIn(
      await api.totpCode(
        session.screen.kind === "code" ? "totp" : "totpConfirm",
        code,
      ),
    );
  if (session.kind !== "signed-in" || !session.screen) return;
  const user = await api.totpCode(
    session.screen.kind === "code" ? "totpOff" : "totpConfirm",
    code,
  );
  useSession.setState({ kind: "signed-in", user }, true);
}

export async function openTotpScreen(): Promise<void> {
  const session = useSession.getState();
  if (session.kind !== "signed-in") return;
  const screen = await totpScreen(session.user.totp ? "code" : "enrol");
  if (useSession.getState() === session)
    useSession.setState({ ...session, screen }, true);
}

export async function cancelTotp(): Promise<void> {
  const session = useSession.getState();
  if (session.kind === "signed-in")
    return useSession.setState({ kind: "signed-in", user: session.user }, true);
  if (session.kind !== "signing-in") return;
  await logout();
  useSession.setState(
    {
      kind: "signed-out",
      setup: "done",
      returnProjectId: session.returnProjectId,
    },
    true,
  );
}

export async function completeSetup(
  token: string,
  username: string,
  displayName: string,
  password: string,
): Promise<void> {
  await api.setup(token, username, displayName, password);
  await signIn(username, password);
}

export async function confirmSignOut(): Promise<boolean> {
  const { notSaved, recovery } = useStore.getState();
  return (
    (!notSaved && !recovery) ||
    confirm("Your unsaved change will be lost. Sign out?")
  );
}

export function endSession(): void {
  leaveBrowserProject();
  dropCameraSave();
  useStore.getState().closeProject();
  useStore.setState(useStore.getInitialState(), true);
  clearSettings();
  showPath("/");
  useSession.setState(
    { kind: "signed-out", setup: "done", returnProjectId: null },
    true,
  );
}

async function logout(): Promise<void> {
  try {
    await api.logout();
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error;
  }
}

export async function signOut(): Promise<void> {
  if (!(await confirmSignOut())) return;
  await logout();
  endSession();
}
